import unittest
import io
from flask_backend.app import app, store
from flask_backend.tests.test_features import CampusHubTestClient


class FullCampusHubIntegrationTests(unittest.TestCase):
    def setUp(self):
        app.config.update(TESTING=True)
        app.test_client_class = CampusHubTestClient
        self.app_context = app.app_context()
        self.app_context.push()

    def tearDown(self):
        self.app_context.pop()

    def test_complete_workflow(self):
        # 1. Test Home, Login, Register pages
        client = app.test_client()
        r = client.get("/")
        self.assertEqual(r.status_code, 200)
        self.assertIn("One place for every", r.get_data(as_text=True))

        r = client.get("/login.html")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Login to CampusHub", r.get_data(as_text=True))

        r = client.get("/register.html")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Create your account", r.get_data(as_text=True))

        # 2. Test Registration for Student & Faculty
        stud_email = "test_student_conv@example.edu"
        fac_email = "test_faculty_conv@example.edu"
        # Clean existing test users if any
        store.users.delete_many({"email": {"$in": [stud_email, fac_email]}})

        r = client.post("/api/auth/register", json={
            "fullName": "Student Tester", "email": stud_email, "password": "Password123",
            "confirmPassword": "Password123", "role": "student", "branch": "Information Technology",
            "rollNumber": "IT-2026-99"
        })
        self.assertEqual(r.status_code, 201)

        r = client.post("/api/auth/register", json={
            "fullName": "Professor Tester", "email": fac_email, "password": "Password123",
            "confirmPassword": "Password123", "role": "faculty", "branch": "Information Technology"
        })
        self.assertEqual(r.status_code, 201)

        # 3. Test Student Login & Dashboard SSR
        client_student = app.test_client()
        r = client_student.post("/api/auth/login", json={"email": stud_email, "password": "Password123"})
        self.assertEqual(r.status_code, 200)

        # Student accesses student dashboard
        r = client_student.get("/student-dashboard.html")
        self.assertEqual(r.status_code, 200)
        html = r.get_data(as_text=True)
        self.assertIn("Student Tester", html)
        self.assertIn("Information Technology", html)
        self.assertIn("Student", html)

        # Student tries to access faculty dashboard -> redirect
        r = client_student.get("/faculty-dashboard.html")
        self.assertEqual(r.status_code, 302)
        self.assertIn("/student-dashboard.html", r.headers["Location"])

        # 4. Test Faculty Login & Dashboard SSR
        client_faculty = app.test_client()
        r = client_faculty.post("/api/auth/login", json={"email": fac_email, "password": "Password123"})
        self.assertEqual(r.status_code, 200)

        r = client_faculty.get("/faculty-dashboard.html")
        self.assertEqual(r.status_code, 200)
        html = r.get_data(as_text=True)
        self.assertIn("Professor Tester", html)
        self.assertIn("Faculty", html)

        # 5. Test Resource Upload by Faculty
        upload_resp = client_faculty.post("/api/resources", data={
            "title": "IT Database System Notes",
            "description": "Comprehensive notes for semester 4 IT database concepts.",
            "category": "Notes",
            "branch": "Information Technology",
            "subject": "DBMS",
            "semester": "4",
            "file": (io.BytesIO(b"Sample DBMS notes content"), "dbms-notes.txt"),
        }, content_type="multipart/form-data")
        self.assertEqual(upload_resp.status_code, 201)
        res_data = upload_resp.get_json()["resource"]
        res_id = res_data["id"]

        # 6. Test Resource View & Download
        view_resp = client_student.get(f"/api/resources/{res_id}/preview")
        self.assertEqual(view_resp.status_code, 200)

        download_resp = client_student.get(f"/api/resources/{res_id}/download")
        self.assertEqual(download_resp.status_code, 200)

        # 7. Test Rating Resource
        rate_resp = client_student.put(f"/api/resources/{res_id}/rating", json={"rating": 5})
        self.assertEqual(rate_resp.status_code, 200)

        # 8. Test Questions & Answers System
        # Student asks question
        q_resp = client_student.post("/api/questions", json={
            "resourceId": res_id, "text": "Can you explain B-trees in DBMS?"
        })
        self.assertEqual(q_resp.status_code, 201)
        q_id = q_resp.get_json()["question"]["id"]

        # Faculty answers question
        ans_resp = client_faculty.post(f"/api/questions/{q_id}/answers", json={
            "text": "B-trees maintain sorted keys and allow balanced logarithmic lookups."
        })
        self.assertEqual(ans_resp.status_code, 200)

        # Faculty edits answer
        edit_ans = client_faculty.put(f"/api/questions/{q_id}/answers", json={
            "text": "B-trees maintain balanced search trees with multiple child nodes per node."
        })
        self.assertEqual(edit_ans.status_code, 200)

        # Student marks answer helpful
        accept_resp = client_student.put(f"/api/questions/{q_id}/accept", json={"accepted": True})
        self.assertEqual(accept_resp.status_code, 200)

        # 9. Test Announcements
        ann_resp = client_faculty.post("/api/announcements", data={
            "title": "DBMS Mid-Term Exam Notice",
            "message": "The exam will be held next Tuesday in Hall B.",
            "audience": "student",
        })
        self.assertEqual(ann_resp.status_code, 201)

        # 10. Test Assignments & Submissions
        assign_resp = client_faculty.post("/api/assignments", data={
            "title": "DBMS Project Report",
            "description": "Submit your ER model and normalized schema presentation.",
            "branch": "Information Technology",
            "file": (io.BytesIO(b"%PDF-1.4 Assignment instructions"), "dbms-assignment.pdf"),
        })
        self.assertEqual(assign_resp.status_code, 201)
        assign_id = assign_resp.get_json()["assignment"]["id"]

        sub_resp = client_student.post(f"/api/assignments/{assign_id}/submission", data={
            "rollNumber": "IT-2026-99",
            "file": (io.BytesIO(b"Student presentation slides"), "it-slides.png"),
        })
        self.assertEqual(sub_resp.status_code, 200)

        # 11. Test Leadership & Rankings
        lead_resp = client_student.get("/api/leadership")
        self.assertEqual(lead_resp.status_code, 200)
        lead_data = lead_resp.get_json()
        self.assertIn("profile", lead_data)
        self.assertIn("leaderboards", lead_data)

        # Verify Student Dashboard shows the newly uploaded resources and answers
        dash_resp = client_student.get("/student-dashboard.html")
        self.assertEqual(dash_resp.status_code, 200)
        dash_html = dash_resp.get_data(as_text=True)
        self.assertIn("IT Database System Notes", dash_html)
        self.assertIn("DBMS Mid-Term Exam Notice", dash_html)
        self.assertIn("DBMS Project Report", dash_html)

        # 12. Cleanup
        del_sub = client_student.delete(f"/api/assignments/{assign_id}/submission")
        self.assertEqual(del_sub.status_code, 200)
        del_q = client_student.delete(f"/api/questions/{q_id}")
        self.assertEqual(del_q.status_code, 200)
        del_res = client_faculty.delete(f"/api/resources/{res_id}")
        self.assertEqual(del_res.status_code, 200)


if __name__ == "__main__":
    unittest.main()
