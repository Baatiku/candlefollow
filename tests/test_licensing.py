import unittest
import os
import sqlite3
import datetime
import sys

# Ensure src is in path so we can import licensing
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))
from licensing import LicenseManager

import uuid

class TestLicensing(unittest.TestCase):
    def setUp(self):
        self.db_path = f"test_license_{uuid.uuid4().hex}.db"
        self.lm = LicenseManager(db_path=self.db_path)

    def tearDown(self):
        try:
            os.remove(self.db_path)
        except Exception:
            pass

    def test_admin_create_token(self):
        self.assertTrue(self.lm.admin_create_token("TEST-TOKEN-1", 30))
        # Check it exists and is unclaimed
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("SELECT status, duration_days FROM tokens WHERE token_key='TEST-TOKEN-1'")
        row = c.fetchone()
        conn.close()
        self.assertIsNotNone(row)
        self.assertEqual(row[0], "unclaimed")
        self.assertEqual(row[1], 30)

    def test_duplicate_token_creation(self):
        self.assertTrue(self.lm.admin_create_token("TEST-TOKEN-2", 30))
        self.assertFalse(self.lm.admin_create_token("TEST-TOKEN-2", 30)) # Should fail

    def test_token_activation(self):
        self.lm.admin_create_token("TEST-TOKEN-3", 30)
        
        # Act
        is_valid, msg = self.lm.validate_and_activate("TEST-TOKEN-3")
        
        # Assert
        self.assertTrue(is_valid)
        self.assertIn("Expires", msg)
        
        # DB Check
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("SELECT status, hwid FROM tokens WHERE token_key='TEST-TOKEN-3'")
        row = c.fetchone()
        conn.close()
        self.assertEqual(row[0], "active")
        self.assertIsNotNone(row[1]) # HWID should be bound

    def test_invalid_token(self):
        is_valid, msg = self.lm.validate_and_activate("INVALID-TOKEN")
        self.assertFalse(is_valid)
        self.assertEqual(msg, "Invalid access token.")

    def test_revoked_token(self):
        self.lm.admin_create_token("TEST-TOKEN-REVOKED", 30)
        # Manually revoke
        conn = sqlite3.connect(self.db_path)
        c = conn.cursor()
        c.execute("UPDATE tokens SET status='revoked' WHERE token_key='TEST-TOKEN-REVOKED'")
        conn.commit()
        conn.close()

        is_valid, msg = self.lm.validate_and_activate("TEST-TOKEN-REVOKED")
        self.assertFalse(is_valid)
        self.assertEqual(msg, "This token has been revoked by the administrator.")

if __name__ == "__main__":
    unittest.main()
