"""Protect automatic demo startup upgrade boundaries without modifying a database."""
import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import prepare_demo_database as demo


class DemoDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name);migrations=root/'database/migrations/mysql';migrations.mkdir(parents=True)
        (migrations/'V001__test.sql').write_text('-- old')
        (migrations/'V002__test.sql').write_text('-- new')
        self.digest=hashlib.sha256(b'-- old').hexdigest()
        self.root=patch.object(demo,'ROOT',root);self.root.start();self.addCleanup(self.root.stop)

    def test_backup_failure_prevents_migration(self):
        with patch.object(demo,'sql',side_effect=['exists','schema_migration\nmigration_checksum','V001','V001\t'+self.digest]),patch.object(demo,'backup',side_effect=OSError('synthetic backup failure')),patch.object(demo,'provision') as provision:
            with self.assertRaises(OSError):demo.prepare('yaoheng_synthetic_test')
            provision.assert_not_called()

    def test_checksum_mismatch_prevents_backup_and_migration(self):
        with patch.object(demo,'sql',side_effect=['exists','schema_migration\nmigration_checksum','V001','V001\tchanged']),patch.object(demo,'backup') as backup,patch.object(demo,'provision') as provision:
            with self.assertRaisesRegex(RuntimeError,'checksum'):demo.prepare('yaoheng_synthetic_test')
            backup.assert_not_called();provision.assert_not_called()

    def test_existing_current_database_has_no_writes(self):
        checks='V001\t'+self.digest+'\nV002\t'+hashlib.sha256(b'-- new').hexdigest()
        with patch.object(demo,'sql',side_effect=['exists','schema_migration\nmigration_checksum','V001\nV002',checks]),patch.object(demo,'backup') as backup,patch.object(demo,'provision') as provision,patch.object(demo,'verify_schema'):
            demo.prepare('yaoheng_synthetic_test');backup.assert_not_called();provision.assert_not_called()

    def test_new_database_and_non_synthetic_boundary(self):
        with patch.object(demo,'sql',return_value='') as sql,patch.object(demo,'backup') as backup,patch.object(demo,'provision') as provision,patch.object(demo,'verify_schema'):
            with self.assertRaises(ValueError):demo.prepare('production')
            sql.assert_not_called()
            demo.prepare('yaoheng_synthetic_test');backup.assert_not_called();provision.assert_called_once_with('yaoheng_synthetic_test')


if __name__=='__main__':unittest.main(verbosity=2)
