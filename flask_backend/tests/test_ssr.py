import os
import unittest
from datetime import datetime, timezone

os.environ["CAMPUSHUB_USE_IN_MEMORY_DB"] = "1"

from flask_backend.app import app, store
from flask_backend.tests.test_features import CampusHubTestClient


class ServerSideRenderingTests(unittest.TestCase):
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

        # Register users
        self.client_anon = app.test_client()
        self.client_student = app.test_client()
        self.client_faculty = app.test_client()
        self.client_admin = app.test_client()

        # Student
        self.client_student.post("/api/auth/register", json={
            "fullName": "Aarav Sharma", "email": "aarav@example.edu", "password": "Password123",
            "confirmPassword": "Password123", "role": "student", "branch": "CSE",
            "rollNumber": "CSE-2026-001"
        })
        self.client_student.post("/api/auth/login", json={
            "email": "aarav@example.edu", "password": "Password123"
        })

        # Faculty
        self.client_faculty.post("/api/auth/register", json={
            "fullName": "Dr. Ramesh Verma", "email": "ramesh@example.edu", "password": "Password123",
            "confirmPassword": "Password123", "role": "faculty", "branch": "CSE"
        })
        self.client_faculty.post("/api/auth/login", json={
            "email": "ramesh@example.edu", "password": "Password123"
        })

        # Admin
        import bcrypt
        admin_hash = bcrypt.hashpw(b"AdminPass123", bcrypt.gensalt()).decode()
        store.users.insert_one({
            "fullName": "Administrator", "normalizedFullName": "administrator",
            "email": "admin@example.edu", "password": admin_hash,
            "role": "admin", "branch": "", "tokenVersion": 0, "isActive": True,
            "createdAt": datetime.now(timezone.utc),
        })
        self.client_admin.post("/api/auth/login", json={
            "email": "admin@example.edu", "password": "AdminPass123"
        })

    def tearDown(self):
        self.app_context.pop()

    def test_anonymous_redirects(self):
        # Unauthenticated users accessing dashboards get redirected to /login.html
        resp = self.client_anon.get("/student-dashboard.html")
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login.html", resp.headers["Location"])

        resp = self.client_anon.get("/faculty-dashboard.html")
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login.html", resp.headers["Location"])

        resp = self.client_anon.get("/admin-dashboard.html")
        self.assertEqual(resp.status_code, 302)
        self.assertIn("/login.html", resp.headers["Location"])

    def test_public_pages_render(self):
        resp = self.client_anon.get("/login.html")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn("Login to CampusHub", html)
        self.assertIn("CSE (Data Science)", html)

        resp = self.client_anon.get("/register.html")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn("Create your account", html)

    def test_student_dashboard_ssr(self):
        # Student accesses student dashboard
        resp = self.client_student.get("/student-dashboard.html")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        # Server rendered student details
        self.assertIn("Aarav Sharma", html)
        self.assertIn("aarav@example.edu", html)
        self.assertIn("CSE-2026-001", html)
        self.assertIn("Student", html)
        # Panel should not be empty, content div visible
        self.assertIn('id="dashContent"', html)
        self.assertNotIn('<div id="dashContent" hidden>', html)

    def test_faculty_dashboard_ssr(self):
        # Faculty accesses faculty dashboard
        resp = self.client_faculty.get("/faculty-dashboard.html")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn("Dr. Ramesh Verma", html)
        self.assertIn("ramesh@example.edu", html)
        self.assertIn("Faculty", html)
        self.assertIn('id="dashContent"', html)

    def test_admin_dashboard_ssr(self):
        # Admin accesses admin dashboard
        resp = self.client_admin.get("/admin-dashboard.html")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn("Administrator", html)
        self.assertIn("Aarav Sharma", html)
        self.assertIn("Dr. Ramesh Verma", html)
        self.assertIn("Statistics", html)


if __name__ == "__main__":
    unittest.main()
