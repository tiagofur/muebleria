"""DB-free contract checks for the temporary #839 diagnostic branch."""

import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest
import zipfile


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('ptx_sanitize', ROOT / 'scripts/ptx-diagnostic-sanitize.py')
assert SPEC and SPEC.loader
sanitize_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sanitize_module)


class PtxDiagnosticContractTest(unittest.TestCase):
    def test_manual_dispatch_has_only_one_executable_job(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        jobs = workflow.split('\njobs:\n', 1)[1]
        blocks = re.split(r'(?m)^  ([a-z][a-z0-9-]+):\n', jobs)[1:]
        job_map = dict(zip(blocks[::2], blocks[1::2]))
        self.assertEqual(set(job_map), {
            'ptx-diagnostic', 'impact', 'validate-catalog', 'typescript',
            'proyectar-visual', 'foundation-postgres', 'organization-browser',
            'sketchup-extension', 'backend-go', 'foundation-gate-a',
        })
        diagnostic = job_map['ptx-diagnostic']
        self.assertIn("github.ref == 'refs/heads/codex/839-ptx-diagnostic'", diagnostic)
        self.assertIn('permissions:\n      contents: read', diagnostic)
        self.assertNotIn('    needs:', diagnostic)
        self.assertNotIn('secrets.', diagnostic)
        self.assertNotIn('environment:', diagnostic)
        self.assertNotIn('cache: pnpm', diagnostic)
        self.assertIn('--workers=1', diagnostic)
        self.assertIn("--grep-invert 'Completar Ingeniería → Completa final'", diagnostic)
        for name, block in job_map.items():
            if name != 'ptx-diagnostic':
                self.assertRegex(block, r'(?m)^    if: \$\{\{ .*github\.event_name != \'workflow_dispatch\'')

    def test_sanitizer_drops_network_and_rejects_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / 'raw'
            raw.mkdir()
            (raw / 'launcher.log').write_text('Running 32 tests using 1 worker\n')
            (raw / 'ptx-events.json').write_text(json.dumps([{'stage': 'ptx-click-start', 'elapsedMs': 1}]))
            with zipfile.ZipFile(raw / 'ptx-raw-trace.zip', 'w') as trace:
                trace.writestr('trace.trace', '{"type":"before","method":"click"}\n')
                trace.writestr('trace.network', 'Authorization: Bearer forbidden')
                trace.writestr('resources/ptx.bin', b'private PTX bytes')
            safe = root / 'safe'
            sanitize_module.sanitize(raw, safe, 0, 'candidate')
            with zipfile.ZipFile(safe / 'ptx-trace-sanitized.zip') as trace:
                self.assertEqual(trace.namelist(), ['trace.trace'])
            self.assertNotIn('Bearer', (safe / 'sanitized-log.txt').read_text())
            (raw / 'ptx-events.json').write_text(json.dumps([{'stage': 'Authorization: Bearer unsafe'}]))
            with self.assertRaisesRegex(ValueError, 'privacy boundary'):
                sanitize_module.sanitize(raw, root / 'unsafe', 1, 'candidate')

    def test_base_overlay_never_replaces_base_launcher(self):
        workflow = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('git checkout --detach 6184b4d2d36c5c73e3fbcabde2c2785e5335e565', workflow)
        self.assertIn('python3 scripts/ptx-diagnostic-launcher.py scripts/organization-browser-gate.sh', workflow)
        self.assertNotIn('git show 24b014906e4fdd0963d4017df4865fc6527d9bca:scripts/organization-browser-gate.sh', workflow)

    def test_preclick_snapshot_and_native_signal_are_independent_of_handler(self):
        panel = (ROOT / 'packages/ui/src/production/ProductionOrderOptimizationPanel.tsx').read_text()
        spec = (ROOT / 'tests/organization/engineering-state.spec.ts').read_text()
        self.assertIn('data-ptx-diagnostic-state', panel)
        self.assertIn('__PTX_DIAG_SELECTION__', spec)
        self.assertIn("Page.downloadWillBegin", spec)
        self.assertIn("Page.enable", spec)
        self.assertNotIn('setDownloadBehavior', spec)

    def test_missing_trace_and_events_still_yield_safe_failure_context(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / 'raw'
            raw.mkdir()
            (raw / 'launcher.log').write_text('Running 32 tests using 1 worker\n')
            safe = root / 'safe'
            sanitize_module.summarize_failure(raw, safe, 1, 'candidate')
            sanitize_module.sanitize(raw, safe, 1, 'candidate')
            context = (safe / 'sanitized-failure-context.txt').read_text()
            self.assertIn('events=missing', context)
            self.assertIn('trace=missing', context)
            self.assertNotIn('Authorization', context)
            with self.assertRaisesRegex(ValueError, 'missing expected PTX evidence'):
                sanitize_module.sanitize(raw, root / 'false_success', 0, 'candidate')

    def test_failure_context_does_not_echo_raw_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            raw = root / 'raw'
            raw.mkdir()
            (raw / 'launcher.log').write_text(
                'Running 32 tests using 1 worker\n'
                '✘ engineering-state.spec.ts:308 raw Authorization: Bearer forbidden\n'
                'Timed out 20000ms exceeded\n'
            )
            safe = root / 'safe'
            sanitize_module.summarize_failure(raw, safe, 1, 'candidate')
            context = (safe / 'sanitized-failure-context.txt').read_text()
            self.assertIn('failed_spec=engineering-state.spec.ts', context)
            self.assertIn('failure_codes=timeout', context)
            self.assertNotIn('Bearer', context)


if __name__ == '__main__':
    unittest.main()
