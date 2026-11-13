import io, json, os, tempfile, unittest
os.environ["DB_PATH"] = tempfile.mktemp(suffix=".db")
os.environ["UPLOAD_DIR"] = tempfile.mkdtemp()
import app as appmod


class AppTests(unittest.TestCase):
    def setUp(self):
        appmod.app.config.update(TESTING=True)
        self.c = appmod.app.test_client()

    def test_index_loads_and_has_notice_and_collector(self):
        r = self.c.get("/")
        self.assertEqual(r.status_code, 200)
        body = r.get_data(as_text=True)
        self.assertIn("Research notice", body)          # visible disclosure present
        self.assertIn("collect.js", body)               # collector wired
        self.assertIn("PixShare", body)

    def test_collect_stores_row(self):
        payload = {"custom_hash": "abc123", "signals": {"userAgent": "UA", "timezone": "Europe/Budapest"},
                   "creep": {"hash": "CREEP9", "fuzzy": "fz", "lies": "none"}}
        r = self.c.post("/collect", data=json.dumps(payload), content_type="application/json",
                        headers={"User-Agent": "UA", "X-Forwarded-For": "9.9.9.9, 10.0.0.1"})
        self.assertEqual(r.get_json(), {"ok": True})
        rows = appmod.db_rows()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["custom_hash"], "abc123")
        self.assertEqual(rows[0]["creep_hash"], "CREEP9")
        self.assertEqual(rows[0]["ip"], "9.9.9.9")       # first X-Forwarded-For hop

    def test_admin_lists_visit(self):
        r = self.c.get("/admin")
        self.assertEqual(r.status_code, 200)
        self.assertIn("Collected visits", r.get_data(as_text=True))

    def test_upload_sets_display_image_and_index_shows_it(self):
        data = {"image": (io.BytesIO(b"\xff\xd8\xff\xe0 jpeg bytes"), "1.jpg")}
        r = self.c.post("/admin/upload", data=data, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 302)
        idx = self.c.get("/").get_data(as_text=True)
        self.assertIn("/uploads/display.jpg", idx)
        served = self.c.get("/uploads/display.jpg")
        self.assertEqual(served.status_code, 200)

    def test_upload_rejects_non_image(self):
        data = {"image": (io.BytesIO(b"nope"), "evil.exe")}
        r = self.c.post("/admin/upload", data=data, content_type="multipart/form-data")
        self.assertEqual(r.status_code, 400)

    def test_visit_json_endpoint(self):
        self.c.post("/collect", data=json.dumps({"custom_hash": "x"}), content_type="application/json")
        vid = appmod.db_rows()[-1]["id"]  # the row we just inserted
        r = self.c.get(f"/admin/visit/{vid}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.get_json()["custom_hash"], "x")


if __name__ == "__main__":
    unittest.main()
