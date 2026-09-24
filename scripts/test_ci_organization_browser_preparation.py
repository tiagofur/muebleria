"""Exercise the real browser launcher with non-connecting child-process doubles."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GATE = ROOT / "scripts/organization-browser-gate.sh"


class BrowserPreparationLauncherTest(unittest.TestCase):
    def run_gate_with_doubles(self, preflight_exit, *, real_preflight=False, poison=None):
        with tempfile.TemporaryDirectory(prefix="browser-preparation-double-") as tmp:
            tmpdir = Path(tmp)
            capture = tmpdir / "children.jsonl"
            bindir = tmpdir / "bin"
            bindir.mkdir()
            shim = bindir / "shim"
            shim.write_text(
                "#!" + sys.executable + "\n"
                + "import json, os, pathlib, sys, urllib.parse\n"
                + "import subprocess\n"
                + f"capture = pathlib.Path({str(capture)!r})\n"
                + f"preflight_exit = {preflight_exit}\n"
                + f"real_preflight = {real_preflight!r}\n"
                + f"real_go = {shutil.which('go')!r}\n"
                + f"poison = {poison or {}!r}\n"
                + "name = pathlib.Path(sys.argv[0]).name\n"
                + "args = sys.argv[1:]\n"
                + "if name == 'docker':\n"
                + "    if args[0] == 'logs': print('PostgreSQL init process complete; ready for start up.')\n"
                + "    elif args[0] == 'inspect': print('127.0.0.1:56321' if 'HostIp' in ' '.join(args) else '56321')\n"
                + "    elif args[0] == 'port': print('127.0.0.1:56321')\n"
                + "    elif args[0] == 'exec' and 'rolcanlogin' in ' '.join(args): print('t|f|f')\n"
                + "    elif args[0] == 'exec' and 'current_database()' in ' '.join(args): print('granete_gate|2|2')\n"
                + "    elif args[0] == 'exec' and 'psql' in args: print('11111111-1111-4111-8111-111111111111')\n"
                + "    elif args[0] == 'run': print('synthetic-container')\n"
                + "    sys.exit(0)\n"
                + "if name == 'curl': sys.exit(0)\n"
                + "if name in ('go', 'pnpm'):\n"
                + "    def target(key):\n"
                + "        raw = os.environ.get(key)\n"
                + "        if not raw: return None\n"
                + "        u = urllib.parse.urlparse(raw)\n"
                + "        return [u.hostname, u.port, u.path, u.username]\n"
                + "    record = {'command': name + ' ' + ' '.join(args[:3]),\n"
                + "        'runtime': target('DATABASE_URL'), 'migration': target('MIGRATION_DATABASE_URL'),\n"
                + "        'fixture': target('ORGANIZATION_TEST_DATABASE_URL'),\n"
                + "        'isolated': os.environ.get('ORGANIZATION_TEST_ISOLATED'),\n"
                + "        'testdb': os.environ.get('GRANETE_TEST_DATABASE'),\n"
                + "        'pg_keys': sorted(key for key in os.environ if key.startswith('PG'))}\n"
                + "    with capture.open('a') as stream: stream.write(json.dumps(record) + '\\n')\n"
                + "    if name == 'go' and args[:2] == ['run', './cmd/testdb-preflight']:\n"
                + "        if real_preflight:\n"
                + "            prepared = os.environ.copy()\n"
                + "            for key, value in poison.items():\n"
                + "                if value is None: prepared.pop(key, None)\n"
                + "                else: prepared[key] = value\n"
                + "            sys.exit(subprocess.run([real_go] + args, env=prepared, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode)\n"
                + "        sys.exit(preflight_exit)\n"
                + "    sys.exit(0)\n"
                + "sys.exit(1)\n",
                encoding="utf-8",
            )
            shim.chmod(0o755)
            for name in ("docker", "go", "curl", "pnpm"):
                (bindir / name).symlink_to(shim)
            env = os.environ.copy()
            env.update({
                "PATH": str(bindir) + os.pathsep + env.get("PATH", ""),
                "TMPDIR": str(tmpdir),
                "DATABASE_URL": "postgres://ambient:secret@127.0.0.1:5445/muebles",
                "MIGRATION_DATABASE_URL": "postgres://ambient:secret@127.0.0.1:5445/muebles",
                "PGHOST": "persistent.example.invalid",
                "PGDATABASE": "muebles",
                "PGPORT": "5445",
                "PGSERVICE": "habitual",
                "PGPASSWORD": "ambient-secret",
            })
            gate = Path(os.environ.get("ORGANIZATION_GATE_TEST_SCRIPT", DEFAULT_GATE))
            result = subprocess.run(
                ["bash", str(gate), "tests/organization/prequote-design.spec.ts"],
                cwd=ROOT, env=env, capture_output=True, text=True, timeout=90,
            )
            records = [json.loads(line) for line in capture.read_text().splitlines()] if capture.exists() else []
            return result, records

    def test_rejected_preflight_stops_before_writable_children(self):
        result, records = self.run_gate_with_doubles(preflight_exit=1)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([r for r in records if './cmd/server' in r['command'] or './cmd/admin' in r['command'] or r['command'].startswith('pnpm ')], [])
        self.assertEqual(len([r for r in records if './cmd/testdb-preflight' in r['command']]), 1)

    def test_real_launcher_passes_only_prepared_targets_to_every_child(self):
        result, records = self.run_gate_with_doubles(preflight_exit=0)
        self.assertEqual(result.returncode, 0, result.stderr[-800:])
        self.assertEqual(len(records), 8)  # preflight, server, five admin commands, Playwright
        self.assertEqual(len([r for r in records if './cmd/admin' in r['command']]), 5)
        runtime = ["127.0.0.1", 56321, "/granete_gate", "granete_app"]
        migration = ["127.0.0.1", 56321, "/granete_gate", "postgres"]
        for record in records:
            self.assertEqual(record['runtime'], runtime, record['command'])
            self.assertEqual(record['migration'], migration, record['command'])
            self.assertEqual(record['isolated'], '1', record['command'])
            self.assertEqual(record['testdb'], '1', record['command'])
            self.assertEqual(record['pg_keys'], [], record['command'])
        browser = [r for r in records if r['command'].startswith('pnpm ')]
        self.assertEqual(browser[0]['fixture'], migration)

    @unittest.skipUnless(os.environ.get('GRANETE_TEST_REAL_GO_PREFLIGHT') == '1',
                         'opt-in local real Go preflight; DB-free and no Docker')
    def test_each_rejected_target_stops_the_real_launcher_before_writers(self):
        if not shutil.which('go'):
            self.skipTest('Go unavailable')
        cases = {
            'organization marker absent': {'ORGANIZATION_TEST_ISOLATED': None},
            'database marker absent': {'GRANETE_TEST_DATABASE': None},
            'runtime missing': {'DATABASE_URL': None},
            'migration missing': {'MIGRATION_DATABASE_URL': None},
            'runtime persistent': {'DATABASE_URL': 'postgres://granete_app:synthetic@127.0.0.1:56321/muebles'},
            'migration persistent': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56321/muebles'},
            'different instance': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56322/granete_gate'},
            'different database': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56321/granete_test_other'},
            'runtime target override': {'DATABASE_URL': 'postgres://granete_app:synthetic@127.0.0.1:56321/granete_gate?dbname=muebles'},
            'migration target override': {'MIGRATION_DATABASE_URL': 'postgres://postgres:synthetic@127.0.0.1:56321/granete_gate?host=example.invalid'},
        }
        for name, poison in cases.items():
            with self.subTest(name=name):
                result, records = self.run_gate_with_doubles(0, real_preflight=True, poison=poison)
                self.assertNotEqual(result.returncode, 0)
                self.assertEqual(len(records), 1, 'writable child launched after rejected target')
                self.assertIn('./cmd/testdb-preflight', records[0]['command'])


if __name__ == '__main__':
    unittest.main()
