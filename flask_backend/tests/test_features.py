import io
import os
import unittest
from datetime import datetime, timezone

from bson import ObjectId
from flask.testing import FlaskClient

os.environ["CAMPUSHUB_USE_IN_MEMORY_DB"] = "1"

from flask_backend.app import UPLOADS, app, store
from flask_backend.leadership import backfill_existing_activity, user_statistics


class CampusHubTestClient(FlaskClient):
    def open(self, *args, **kwargs):
        method = str(kwargs.get("method", "GET")).upper()
        if method in {"POST", "PUT", "PATCH", "DELETE"}:
            if self.get_cookie("campushub_csrf") is None:
                response = super().open("/", method="GET")
                response.close()
            cookie = self.get_cookie("campushub_csrf")
            headers = dict(kwargs.get("headers") or {})
            headers.setdefault("X-CSRF-Token", cookie.value)
            kwargs["headers"] = headers
        return super().open(*args, **kwargs)


class CampusHubFeatureTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        app.test_client_class = CampusHubTestClient
        self.app_context = app.app_context()
        self.app_context.push()
        for name in (
            "users", "announcements", "resources", "questions", "notifications",
            "contributions", "resource_ratings", "badge_achievements",
            "leadership_audit", "assignments", "assignment_submissions",
        ):
            getattr(store, name).delete_many({})
        self.files_before = {path.name for path in UPLOADS.iterdir() if path.is_file()}
        self.clients = {}
        self.student = self.register("CSE Student", "student@example.edu", "student", "CSE", "CSE-001")
        self.other_student = self.register(
            "Data Student", "data@example.edu", "student", "CSE (Data Science)", "DS-002"
        )
        self.faculty = self.register("Faculty One", "faculty@example.edu", "faculty", "CSE")
        self.other_faculty = self.register("Faculty Two", "faculty2@example.edu", "faculty", "ECE")
        self.admin = app.test_client()
        store.users.insert_one({
            "fullName": "CampusHub Admin", "normalizedFullName": "campushub admin",
            "email": "admin@example.edu", "password": "$2b$12$invalid",
            "role": "admin", "branch": "", "tokenVersion": 0,
            "createdAt": datetime.now(timezone.utc),
        })
        import bcrypt
        admin_hash = bcrypt.hashpw(b"AdminPass123", bcrypt.gensalt()).decode()
        store.users.update_one({"email": "admin@example.edu"}, {"$set": {"password": admin_hash}})
        self.login(self.admin, "admin@example.edu", "AdminPass123")

    def tearDown(self):
        for path in UPLOADS.iterdir():
            if path.is_file() and path.name not in self.files_before:
                path.unlink()
        self.app_context.pop()

    def register(self, name, email, role, branch, roll_number=""):
        client = app.test_client()
        response = client.post("/api/auth/register", json={
            "fullName": name, "email": email, "password": "Secret123",
            "confirmPassword": "Secret123", "role": role,
            "branch": branch, "rollNumber": roll_number,
        })
        self.assertEqual(response.status_code, 201, response.get_json())
        self.clients[email] = client
        return client

    def login(self, client, email, password):
        response = client.post("/api/auth/login", json={"email": email, "password": password})
        self.assertEqual(response.status_code, 200, response.get_json())

    def upload_resource(self, client, title="Algorithms notes", subject="", semester=""):
        response = client.post("/api/resources", data={
            "title": title,
            "description": "A useful resource for learning core algorithms.",
            "category": "Notes",
            "branch": "CSE",
            "subject": subject,
            "semester": semester,
            "file": (io.BytesIO(b"resource document"), title.replace(" ", "-") + ".txt"),
        }, content_type="multipart/form-data")
        self.assertEqual(response.status_code, 201, response.get_json())
        return response.get_json()["resource"]

    def test_authentication_and_role_protection(self):
        registered = store.users.find_one({"email": "student@example.edu"})
        self.assertNotEqual(registered["password"], "Secret123")
        self.assertTrue(":" in registered["password"])
        self.assertFalse(store.users.find_one({"email": "fake@example.edu"}))
        migrated_admin = store.users.find_one({"email": "admin@example.edu"})
        self.assertTrue(migrated_admin["password"].startswith(("scrypt:", "pbkdf2:")))
        unknown = app.test_client().post("/api/auth/login", json={
            "email": "missing@example.edu", "password": "Secret123",
        })
        self.assertEqual(unknown.status_code, 404)
        self.assertEqual(unknown.get_json()["code"], "EMAIL_NOT_REGISTERED")
        duplicate = app.test_client().post("/api/auth/register", json={
            "fullName": "Different Name", "email": "STUDENT@example.edu",
            "password": "Secret123", "confirmPassword": "Secret123",
            "role": "student", "branch": "CSE",
        })
        self.assertEqual(duplicate.status_code, 409)
        wrong_password = app.test_client().post("/api/auth/login", json={
            "email": "student@example.edu", "password": "wrong",
        })
        self.assertEqual(wrong_password.status_code, 401)
        branch_mismatch = app.test_client().post("/api/auth/login", json={
            "email": "student@example.edu", "password": "Secret123", "branch": "ECE",
        })
        self.assertEqual(branch_mismatch.status_code, 401)
        self.assertEqual(branch_mismatch.get_json()["code"], "BRANCH_MISMATCH")
        admin_registration = app.test_client().post("/api/auth/register", json={
            "fullName": "Fake Admin", "email": "fake@example.edu",
            "password": "Secret123", "confirmPassword": "Secret123",
            "role": "admin", "branch": "CSE",
        })
        self.assertEqual(admin_registration.status_code, 403)
        self.assertEqual(admin_registration.get_json()["code"], "ADMIN_REGISTRATION_DISABLED")
        unauthorized = app.test_client().get("/api/admin/leadership")
        self.assertEqual(unauthorized.status_code, 401)
        self.login(self.student, "student@example.edu", "Secret123")
        student_admin_view = self.student.get("/api/admin/leadership")
        self.assertEqual(student_admin_view.status_code, 403)
        self.assertEqual(self.student.get("/admin-dashboard.html").status_code, 302)
        logout = self.student.post("/api/auth/logout")
        self.assertEqual(logout.status_code, 200)
        self.assertFalse(self.student.get("/api/auth/me").get_json()["authenticated"])
        self.assertEqual(self.student.get("/student-dashboard.html").status_code, 302)

    def test_leadership_points_feedback_ratings_badges_and_branch_rankings(self):
        self.login(self.faculty, "faculty@example.edu", "Secret123")
        resource = self.upload_resource(self.faculty)
        for index in range(3):
            self.upload_resource(self.faculty, f"Extra study resource {index}")

        self.login(self.student, "student@example.edu", "Secret123")
        question_response = self.student.post("/api/questions", json={
            "resourceId": resource["id"], "text": "How does this algorithm work?",
        })
        self.assertEqual(question_response.status_code, 201)
        question_id = question_response.get_json()["question"]["id"]

        own_rating = self.faculty.put(
            f"/api/resources/{resource['id']}/rating", json={"rating": 5}
        )
        self.assertEqual(own_rating.status_code, 403)

        self.login(self.faculty, "faculty@example.edu", "Secret123")
        answer = self.faculty.post(
            f"/api/questions/{question_id}/answers",
            json={"text": "It runs in O(n log n) time."},
        )
        self.assertEqual(answer.status_code, 200)
        self.login(self.other_student, "data@example.edu", "Secret123")
        forbidden_accept = self.other_student.put(
            f"/api/questions/{question_id}/accept", json={"accepted": True}
        )
        self.assertEqual(forbidden_accept.status_code, 403)

        self.login(self.other_student, "data@example.edu", "Secret123")
        helpful = self.other_student.post(f"/api/questions/{question_id}/helpful", json={})
        self.assertEqual(helpful.status_code, 200)
        duplicate_helpful = self.other_student.post(
            f"/api/questions/{question_id}/helpful", json={}
        )
        self.assertEqual(duplicate_helpful.status_code, 409)
        rating = self.other_student.put(
            f"/api/resources/{resource['id']}/rating", json={"rating": 5}
        )
        self.assertEqual(rating.status_code, 200)
        self.assertEqual(
            self.other_student.put(
                f"/api/resources/{resource['id']}/rating", json={"rating": 4}
            ).status_code,
            200,
        )

        self.login(self.student, "student@example.edu", "Secret123")
        accepted = self.student.put(
            f"/api/questions/{question_id}/accept", json={"accepted": True}
        )
        self.assertEqual(accepted.status_code, 200)

        faculty_leadership = self.faculty.get("/api/leadership").get_json()
        stats = faculty_leadership["profile"]["stats"]
        self.assertEqual(stats["points"], 62)
        self.assertEqual(stats["resourcesUploaded"], 4)
        self.assertEqual(stats["questionsAnswered"], 1)
        self.assertEqual(stats["helpfulAnswers"], 1)
        self.assertEqual(stats["acceptedAnswers"], 1)
        self.assertEqual(stats["rating"], 4.7)
        self.assertIn("Contributor", [badge["name"] for badge in stats["badges"]])
        self.assertGreaterEqual(faculty_leadership["leaderboards"]["students"][0]["points"], 1)
        self.assertTrue(all(
            row["role"] == "student"
            for row in faculty_leadership["leaderboards"]["students"]
        ))
        self.assertTrue(all(
            row["role"] == "faculty"
            for row in faculty_leadership["leaderboards"]["faculty"]
        ))

        admin_data = self.admin.get("/api/admin/leadership?branch=CSE").get_json()
        branch_group = admin_data["branchRankings"][0]
        self.assertEqual(branch_group["branch"], "CSE")
        self.assertEqual(branch_group["students"][0]["name"], "CSE Student")
        self.assertIn("CSE (Data Science)", admin_data["branches"])
        review = self.admin.get("/api/admin/leadership/review").get_json()
        self.assertEqual(review["resourceRatings"][0]["rating"], 4)
        self.assertTrue(any(event["active"] for event in review["recentContributions"]))

        resource_event = store.contributions.find_one({
            "type": "resource_uploaded", "referenceId": ObjectId(resource["id"]),
        })
        removed = self.admin.delete(
            f"/api/admin/leadership/contributions/{resource_event['_id']}",
            json={"reason": "Invalid resource upload"},
        )
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(store.leadership_audit.count_documents({}), 1)
        revised = self.faculty.get("/api/leadership").get_json()["profile"]["stats"]
        self.assertEqual(revised["points"], 52)
        self.assertEqual(revised["resourcesUploaded"], 3)

    def test_existing_resource_and_question_backfill_is_idempotent(self):
        student = store.users.find_one({"email": "student@example.edu"})
        faculty = store.users.find_one({"email": "faculty@example.edu"})
        resource_id = store.resources.insert_one({
            "title": "Legacy material", "description": "Existing material from before leadership.",
            "category": "Notes", "branch": "CSE", "uploadedBy": faculty["_id"],
            "isActive": True, "createdAt": datetime.now(timezone.utc),
        }).inserted_id
        question_id = store.questions.insert_one({
            "resource": resource_id, "askedBy": student["_id"],
            "question": "Legacy question?", "answer": "Legacy answer.",
            "answeredBy": faculty["_id"], "acceptedByAsker": True,
            "createdAt": datetime.now(timezone.utc),
        }).inserted_id

        backfill_existing_activity(store)
        backfill_existing_activity(store)
        self.assertEqual(store.contributions.count_documents({"referenceId": resource_id}), 1)
        self.assertEqual(store.contributions.count_documents({"referenceId": question_id}), 3)
        faculty_stats = user_statistics(store, faculty)
        self.assertEqual(faculty_stats["points"], 25)
        self.assertEqual(faculty_stats["questionsAnswered"], 1)
        self.assertEqual(faculty_stats["acceptedAnswers"], 1)

    def test_question_and_resource_removal_retracts_related_active_points(self):
        self.login(self.faculty, "faculty@example.edu", "Secret123")
        resource = self.upload_resource(self.faculty)
        self.login(self.student, "student@example.edu", "Secret123")
        question = self.student.post("/api/questions", json={
            "resourceId": resource["id"], "text": "A question that will be removed?",
        }).get_json()["question"]
        question_id = question["id"]
        self.login(self.other_student, "data@example.edu", "Secret123")
        unauthorized_delete = self.other_student.delete(f"/api/questions/{question_id}")
        self.assertEqual(unauthorized_delete.status_code, 403)

        self.login(self.faculty, "faculty@example.edu", "Secret123")
        self.faculty.post(
            f"/api/questions/{question_id}/answers", json={"text": "An answer."}
        )
        self.login(self.student, "student@example.edu", "Secret123")
        other_question = self.other_student.delete(f"/api/questions/{question_id}")
        self.assertEqual(other_question.status_code, 403)
        deleted = self.student.delete(f"/api/questions/{question_id}")
        self.assertEqual(deleted.status_code, 200)
        self.assertEqual(
            self.student.get("/api/leadership").get_json()["profile"]["stats"]["points"],
            0,
        )
        faculty_stats = self.faculty.get("/api/leadership").get_json()["profile"]["stats"]
        self.assertEqual(faculty_stats["points"], 10)
        self.assertEqual(faculty_stats["questionsAnswered"], 0)

        removed_resource = self.faculty.delete(f"/api/resources/{resource['id']}")
        self.assertEqual(removed_resource.status_code, 200)
        final_stats = self.faculty.get("/api/leadership").get_json()["profile"]["stats"]
        self.assertEqual(final_stats["points"], 0)
        self.assertEqual(final_stats["resourcesUploaded"], 0)

    def test_answer_owner_permissions_and_contribution_retraction(self):
        self.login(self.faculty, "faculty@example.edu", "Secret123")
        resource = self.upload_resource(self.faculty)
        self.login(self.student, "student@example.edu", "Secret123")
        question = self.student.post("/api/questions", json={
            "resourceId": resource["id"], "text": "Who may update the answer?",
        }).get_json()["question"]
        question_id = question["id"]

        self.login(self.faculty, "faculty@example.edu", "Secret123")
        answer = self.faculty.post(
            f"/api/questions/{question_id}/answers", json={"text": "The answer author."}
        )
        self.assertEqual(answer.status_code, 200)
        self.login(self.student, "student@example.edu", "Secret123")
        accepted = self.student.put(
            f"/api/questions/{question_id}/accept", json={"accepted": True}
        )
        self.assertEqual(accepted.status_code, 200)
        self.login(self.other_student, "data@example.edu", "Secret123")
        self.assertEqual(
            self.other_student.put(
                f"/api/questions/{question_id}/answers", json={"text": "Take over."}
            ).status_code,
            403,
        )
        self.assertEqual(
            self.other_student.delete(f"/api/questions/{question_id}/answers").status_code,
            403,
        )

        self.login(self.faculty, "faculty@example.edu", "Secret123")
        edited = self.faculty.put(
            f"/api/questions/{question_id}/answers", json={"text": "Corrected answer."}
        )
        self.assertEqual(edited.status_code, 200)
        self.assertFalse(edited.get_json()["question"]["accepted"])
        faculty_stats = self.faculty.get("/api/leadership").get_json()["profile"]["stats"]
        self.assertEqual(faculty_stats["points"], 15)
        deleted = self.faculty.delete(f"/api/questions/{question_id}/answers")
        self.assertEqual(deleted.status_code, 200)
        faculty_stats = self.faculty.get("/api/leadership").get_json()["profile"]["stats"]
        self.assertEqual(faculty_stats["points"], 10)

    def test_faculty_announcements_persist_and_reject_non_image_attachments(self):
        self.login(self.faculty, "faculty@example.edu", "Secret123")
        announcement = self.faculty.post("/api/announcements", data={
            "title": "Exam schedule",
            "message": "The midterm schedule is now available.",
            "audience": "student",
        })
        self.assertEqual(announcement.status_code, 201, announcement.get_json())
        saved = announcement.get_json()["announcement"]
        self.assertEqual(saved["title"], "Exam schedule")
        visible = self.student.get("/api/announcements").get_json()["announcements"]
        self.assertTrue(any(item["id"] == saved["id"] for item in visible))

        invalid_attachment = self.faculty.post("/api/announcements", data={
            "title": "Invalid file notice",
            "message": "This should not accept a script as an image.",
            "audience": "all",
            "file": (io.BytesIO(b"not an image"), "payload.html"),
        }, content_type="multipart/form-data")
        self.assertEqual(invalid_attachment.status_code, 400)
        self.assertEqual(store.announcements.count_documents({}), 1)

    def test_csrf_resource_metadata_filters_and_admin_management(self):
        invalid_csrf = app.test_client().post(
            "/api/auth/login",
            json={"email": "student@example.edu", "password": "Secret123"},
            headers={"X-CSRF-Token": "not-the-cookie-token"},
        )
        self.assertEqual(invalid_csrf.status_code, 400)
        self.assertEqual(invalid_csrf.get_json()["code"], "CSRF_FAILED")

        self.login(self.faculty, "faculty@example.edu", "Secret123")
        resource = self.upload_resource(
            self.faculty, "Calculus lecture notes", "Calculus", "3"
        )
        invalid_resource_file = self.faculty.post("/api/resources", data={
            "title": "Unsafe upload",
            "description": "This upload extension must be blocked.",
            "branch": "CSE",
            "file": (io.BytesIO(b"not html"), "unsafe.html"),
        }, content_type="multipart/form-data")
        self.assertEqual(invalid_resource_file.status_code, 400)
        lower_rated = self.upload_resource(
            self.faculty, "Physics reference", "Physics", "4"
        )
        self.assertEqual(resource["subject"], "Calculus")
        self.assertEqual(resource["semester"], "3")
        self.login(self.other_student, "data@example.edu", "Secret123")
        self.assertEqual(
            self.other_student.put(
                f"/api/resources/{lower_rated['id']}/rating", json={"rating": 2}
            ).status_code,
            200,
        )
        self.login(self.student, "student@example.edu", "Secret123")
        self.assertEqual(
            self.student.put(
                f"/api/resources/{resource['id']}/rating", json={"rating": 5}
            ).status_code,
            200,
        )
        search = self.student.get(
            "/api/resources?subject=calculus&semester=3&category=Notes&branch=CSE"
        )
        self.assertEqual(search.status_code, 200)
        self.assertEqual([item["id"] for item in search.get_json()["resources"]], [resource["id"]])
        self.assertEqual(
            self.other_faculty.get(f"/api/resources/{resource['id']}").status_code,
            401,
        )
        self.login(self.student, "student@example.edu", "Secret123")
        detail = self.student.get(f"/api/resources/{resource['id']}")
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.get_json()["resource"]["subject"], "Calculus")
        self.assertNotIn("email", detail.get_json()["resource"]["uploadedBy"])
        sorted_resources = self.student.get("/api/resources?sort=rating").get_json()["resources"]
        self.assertEqual(sorted_resources[0]["id"], resource["id"])
        download = self.student.get(detail.get_json()["resource"]["file"]["downloadUrl"])
        self.assertEqual(download.status_code, 200)
        download.close()

        overview = self.admin.get("/api/admin/overview")
        self.assertEqual(overview.status_code, 200)
        data = overview.get_json()
        self.assertEqual(data["stats"]["students"], 2)
        self.assertEqual(data["stats"]["faculty"], 2)
        self.assertTrue(any(item["id"] == resource["id"] for item in data["resources"]))
        self.assertEqual(self.admin.get("/api/admin/categories").get_json()["categories"], ["Notes"])

        student_record = next(user for user in data["users"] if user["email"] == "student@example.edu")
        disable = self.admin.patch(f"/api/admin/users/{student_record['id']}", json={"active": False})
        self.assertEqual(disable.status_code, 200)
        self.assertFalse(self.student.get("/api/auth/me").get_json()["authenticated"])
        disabled_login = app.test_client().post(
            "/api/auth/login",
            json={"email": "student@example.edu", "password": "Secret123"},
        )
        self.assertEqual(disabled_login.status_code, 403)
        self.assertEqual(disabled_login.get_json()["code"], "ACCOUNT_DISABLED")
        enabled = self.admin.patch(f"/api/admin/users/{student_record['id']}", json={"active": True})
        self.assertEqual(enabled.status_code, 200)

    def test_branch_assignments_submission_updates_and_faculty_review(self):
        self.login(self.faculty, "faculty@example.edu", "Secret123")
        create_response = self.faculty.post("/api/assignments", data={
            "title": "Algorithms presentation",
            "description": "Prepare a short presentation about sorting.",
            "branch": "CSE",
            "file": (io.BytesIO(b"assignment"), "instructions.pdf"),
        }, content_type="multipart/form-data")
        self.assertEqual(create_response.status_code, 201, create_response.get_json())
        assignment_id = create_response.get_json()["assignment"]["id"]

        self.login(self.student, "student@example.edu", "Secret123")
        available = self.student.get("/api/assignments").get_json()["assignments"]
        self.assertEqual(len(available), 1)
        first = self.student.put(
            f"/api/assignments/{assignment_id}/submission",
            data={"rollNumber": "CSE-001", "file": (io.BytesIO(b"presentation v1"), "work.pptx")},
            content_type="multipart/form-data",
        )
        self.assertEqual(first.status_code, 200, first.get_json())
        second = self.student.put(
            f"/api/assignments/{assignment_id}/submission",
            data={"rollNumber": "CSE-001", "file": (io.BytesIO(b"presentation v2"), "work.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.get_json()["submission"]["version"], 2)
        mismatched_roll = self.student.put(
            f"/api/assignments/{assignment_id}/submission",
            data={"rollNumber": "SOMEONE-ELSE", "file": (io.BytesIO(b"bad"), "work.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(mismatched_roll.status_code, 403)

        self.login(self.other_student, "data@example.edu", "Secret123")
        self.assertEqual(self.other_student.get("/api/assignments").get_json()["assignments"], [])
        wrong_branch = self.other_student.put(
            f"/api/assignments/{assignment_id}/submission",
            data={"rollNumber": "DS-002", "file": (io.BytesIO(b"bad"), "work.png")},
            content_type="multipart/form-data",
        )
        self.assertEqual(wrong_branch.status_code, 403)

        self.login(self.faculty, "faculty@example.edu", "Secret123")
        assignments = self.faculty.get("/api/assignments").get_json()["assignments"]
        self.assertEqual(assignments[0]["submissionCount"], 1)
        submission = assignments[0]["submissions"][0]
        self.assertEqual(submission["rollNumber"], "CSE-001")
        download = self.faculty.get(submission["downloadUrl"])
        self.assertEqual(download.status_code, 200)
        download.close()

        self.login(self.other_faculty, "faculty2@example.edu", "Secret123")
        unauthorized_download = self.other_faculty.get(submission["downloadUrl"])
        self.assertEqual(unauthorized_download.status_code, 403)


if __name__ == "__main__":
    unittest.main()
