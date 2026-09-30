"""Focused lifecycle checks; no live database or server is started."""
import io
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
import zipfile
from unittest.mock import Mock, patch
from contextlib import ExitStack, redirect_stdout
import r1_local as local


class LauncherTests(unittest.TestCase):
    def test_supplier_key_only_reaches_ai_child(self):
        env={'DEEPSEEK_API_KEY':'synthetic','DB_PASSWORD':'local','VITE_DATA_SOURCE':'backend'}
        self.assertEqual(local.child_environment(env,'ai').get('DEEPSEEK_API_KEY'),'synthetic')
        self.assertNotIn('DB_PASSWORD',local.child_environment(env,'ai'))
        for name in ['backend','mobile','doctor','asr']:
            self.assertNotIn('DEEPSEEK_API_KEY',local.child_environment(env,name))
        for name in ['mobile','doctor','asr']:
            self.assertNotIn('DB_PASSWORD',local.child_environment(env,name))

    def test_schema_rejects_old_database_and_intermediate_gaps_before_start(self):
        with patch.object(local, 'sql', return_value='V009'), patch.object(local.subprocess, 'Popen') as spawn, patch.dict(os.environ, {'DB_PASSWORD':'synthetic-only'}):
            with self.assertRaisesRegex(RuntimeError, 'V010, V011'):
                local.run('yaoheng_synthetic_launcher', auto_ports=True)
            spawn.assert_not_called()
        versions = [p.name.split('__')[0] for p in (local.ROOT/'database/migrations/mysql').glob('V*.sql')]
        with patch.object(local, 'sql', return_value='\n'.join(v for v in versions if v != 'V010')):
            with self.assertRaisesRegex(RuntimeError, 'V010'):
                local.verify_schema('yaoheng_synthetic_launcher')
        with patch.object(local, 'sql', return_value='\n'.join(versions)):
            local.verify_schema('yaoheng_synthetic_launcher')

    def test_occupied_ports_are_skipped_and_distinct(self):
        occupied = {3000, 3001, 8000, 5173}
        with patch.object(local, 'port_available', side_effect=lambda port: port not in occupied):
            self.assertEqual(local.select_ports(True), dict(backend=3002, ai=8001, mobile=5174, doctor=5175))
            with self.assertRaisesRegex(RuntimeError, 'existing processes were not stopped'):
                local.select_ports(False)

    def run_fake(self, *, smoke=False, fail_start=False):
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            root = Path(directory)
            target = root / 'services/backend/target'
            target.mkdir(parents=True)
            (target / 'classpath.txt').write_text('synthetic-library.jar')
            migrations = root / 'database/migrations/mysql'
            migrations.mkdir(parents=True)
            (migrations / 'V009__synthetic.sql').write_text('-- fixture')
            ports = dict(backend=33011, ai=33012, mobile=33013, doctor=33014)
            events, children = [], []
            def spawn(command, **kwargs):
                if fail_start and children:
                    raise OSError('synthetic second-service failure')
                child = Mock()
                child.poll.return_value = None
                children.append((command, kwargs, child))
                return child
            stack.enter_context(patch.object(local, 'ROOT', root))
            stack.enter_context(patch.object(local, 'select_ports', return_value=ports))
            stack.enter_context(patch.object(local, 'sql', return_value='V009'))
            stack.enter_context(patch.object(local.subprocess, 'run', return_value=SimpleNamespace(stderr='java.home = C:/synthetic-jdk')))
            stack.enter_context(patch.object(local.subprocess, 'Popen', side_effect=spawn))
            stack.enter_context(patch.object(local, 'health', side_effect=lambda *_args, **_kwargs: events.append('ready')) )
            stack.enter_context(patch.object(local.webbrowser, 'open', side_effect=lambda url, **_kwargs: events.append(url) or True))
            stack.enter_context(patch.object(local.time, 'sleep', side_effect=KeyboardInterrupt))
            stack.enter_context(patch.dict(os.environ, {'DB_PASSWORD':'synthetic-only', 'VITE_USE_MOCK':'true', 'DASHSCOPE_API_KEY':'synthetic-external-key'}))
            output = stack.enter_context(redirect_stdout(io.StringIO()))
            if fail_start:
                with self.assertRaisesRegex(OSError, 'second-service failure'):
                    local.run('yaoheng_synthetic_launcher', auto_ports=True, open_browser=True)
            else:
                local.run('yaoheng_synthetic_launcher', smoke=smoke, auto_ports=True, open_browser=True)
            for command, kwargs, child in children:
                child.terminate.assert_called_once()
                child.wait.assert_called_once()
                self.assertTrue(Path(kwargs['cwd']).is_relative_to(root))
                self.assertEqual(kwargs['env']['VITE_API_BASE_URL'], 'http://127.0.0.1:33011/api')
                self.assertEqual(kwargs['env']['AI_SERVICE_URL'], 'http://127.0.0.1:33012')
                self.assertNotIn('VITE_USE_MOCK', kwargs['env'])
                self.assertEqual(kwargs['env'].get('DASHSCOPE_API_KEY'), '')
            self.assertNotIn('synthetic-only', output.getvalue())
            self.assertIn('Owned services stopped.', output.getvalue())
            return events, len(children)

    def test_smoke_checks_health_and_stops_without_opening_browser(self):
        events, count = self.run_fake(smoke=True)
        self.assertEqual(count, 4)
        self.assertEqual(events, ['ready'])

    def test_browser_opens_only_after_ready_and_interrupt_cleans_up(self):
        events, count = self.run_fake()
        self.assertEqual(count, 4)
        self.assertEqual(events, ['ready', 'http://127.0.0.1:33013', 'http://127.0.0.1:33014'])

    def test_partial_start_failure_cleans_only_started_children(self):
        events, count = self.run_fake(fail_start=True)
        self.assertEqual(count, 1)
        self.assertEqual(events, [])

    def test_package_preserves_unicode_and_excludes_other_project(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);image='apps/mobile-app/src/static/合成 图片.png'
            excluded='docs/handoff/arkts/other.md'
            for name in [image,excluded,'tsconfig.base.json']:
                path=root/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(b'synthetic')
            def git(command,**kwargs):
                if 'ls-files' in command:
                    self.assertIn('-z',command)
                    return (image+'\0'+excluded+'\0tsconfig.base.json\0').encode('utf-8')
                return 'synthetic-commit\n'
            with patch.object(local,'ROOT',root),patch.object(local.subprocess,'check_output',side_effect=git):
                local.package(root/'release.zip')
            with zipfile.ZipFile(root/'release.zip') as archive:
                self.assertEqual(archive.read(image),b'synthetic')
                self.assertNotIn(excluded,archive.namelist())
                self.assertIn('tsconfig.base.json',archive.namelist())


if __name__ == '__main__':
    unittest.main(verbosity=2)
