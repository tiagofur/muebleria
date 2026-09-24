#!/usr/bin/env python3
"""Fail-closed artifact filter for the temporary #839 synthetic PTX lab."""

import argparse
import json
from pathlib import Path
import re
import zipfile


FORBIDDEN = re.compile(
    r"(?i)(bearer\s|authorization|cookie|password|secret|token|postgres(?:ql)?://|"
    r"database_url|migration_database_url|\bdsn\b|api[_-]?key)"
)
TEXT_LIMIT = 500_000
SAFE_ENV_NAMES = (
    'CI', 'GITHUB_ACTIONS', 'RUNNER_OS', 'RUNNER_ARCH', 'LANG', 'LC_ALL',
    'LC_CTYPE', 'LANGUAGE', 'USER', 'LOGNAME', 'SHELL',
    'XDG_SESSION_TYPE', 'XDG_CURRENT_DESKTOP',
)
ENV_VARIANTS = {'isolated', 'inherited-safe', 'ci+locale', 'ci', 'locale', 'linux'}
KNOWN_FAILURE_CODES = {
    'PostgreSQL did not become ready': 'postgres_not_ready',
    'backend exited before health readiness': 'backend_exited',
    'disposable database preflight rejected targets': 'database_preflight_rejected',
    'backend health endpoint did not become ready': 'backend_health_failed',
    'Timed out': 'timeout',
    'Timeout': 'timeout',
    'Target page, context or browser has been closed': 'browser_target_closed',
}
KNOWN_TEST_FILES = (
    'bootstrap.spec.ts',
    'demo-flow-happy-path.spec.ts',
    'demo-golden-path.spec.ts',
    'design-working-materials-reconcile.spec.ts',
    'engineering-cutting-demand.spec.ts',
    'engineering-entry.spec.ts',
    'engineering-physical-gate.spec.ts',
    'engineering-state.spec.ts',
)


def assert_safe(value: str) -> None:
    if len(value) > TEXT_LIMIT or FORBIDDEN.search(value):
        raise ValueError('diagnostic content failed the privacy boundary')


def screen_browser_env_names(raw: Path, output: Path, status: int, target: str) -> bool:
    """Retain only known harmless variable names and dropped-class counts."""
    source = raw / 'browser-env-safe-names.txt'
    if not source.exists():
        if target == 'candidate' and status == 0:
            raise ValueError('successful candidate is missing browser environment names')
        return False
    content = source.read_text()
    if len(content) > 4096 or not content.endswith('\n'):
        raise ValueError('invalid browser environment name report')
    lines = content.splitlines()
    expected_fields = (
        'variant', 'available_safe_names', 'forwarded_safe_names',
        'ambient_db_pg_count', 'ambient_credential_count', 'ambient_proxy_count',
        'ambient_unclassified_key_count',
    )
    if len(lines) != len(expected_fields):
        raise ValueError('invalid browser environment name report')
    fields = {}
    for line, expected in zip(lines, expected_fields):
        key, separator, value = line.partition('=')
        if key != expected or separator != '=':
            raise ValueError('invalid browser environment name report')
        fields[key] = value
    if fields['variant'] not in ENV_VARIANTS:
        raise ValueError('invalid browser environment variant')
    for field in ('available_safe_names', 'forwarded_safe_names'):
        names = fields[field].split(',') if fields[field] else []
        if len(names) != len(set(names)) or any(name not in SAFE_ENV_NAMES for name in names):
            raise ValueError('browser environment report contains unsafe names')
        if names != [name for name in SAFE_ENV_NAMES if name in names]:
            raise ValueError('browser environment report names are out of order')
    available = set(fields['available_safe_names'].split(',')) if fields['available_safe_names'] else set()
    forwarded = set(fields['forwarded_safe_names'].split(',')) if fields['forwarded_safe_names'] else set()
    if not forwarded <= available:
        raise ValueError('browser environment report claims absent keys forwarded')
    for field in expected_fields[3:]:
        if not re.fullmatch(r'0|[1-9][0-9]{0,4}', fields[field]):
            raise ValueError('invalid browser environment class count')
    assert_safe(content)
    (output / 'browser-env-safe-names.txt').write_text(content)
    return True


def summarize_failure(raw: Path, output: Path, status: int, target: str) -> None:
    """Extract only fixed codes and booleans; never echo a raw failure line."""
    if target not in {'candidate', 'base'}:
        raise ValueError('invalid diagnostic target')
    output.mkdir(parents=True, exist_ok=True)
    log_path = raw / 'launcher.log'
    log = log_path.read_text(errors='replace') if log_path.exists() else ''
    count = re.search(r'Running (\d+) tests? using (\d+) workers?', log)
    count_text = f'{count.group(1)}/{count.group(2)}' if count else 'not_reported'
    codes = sorted({code for needle, code in KNOWN_FAILURE_CODES.items() if needle in log})
    failed_spec = next(
        (name for line in log.splitlines() if '✘' in line or 'failed' in line.lower()
         for name in KNOWN_TEST_FILES if name in line),
        'not_identified',
    )
    last_stage = 'not_reported'
    events = raw / 'ptx-events.json'
    if events.exists():
        try:
            parsed = json.loads(events.read_text())
            if isinstance(parsed, list):
                for event in reversed(parsed):
                    candidate = event.get('stage') if isinstance(event, dict) else None
                    if isinstance(candidate, str) and re.fullmatch(r'[a-z][a-z0-9-]{0,50}', candidate):
                        last_stage = candidate
                        break
        except (OSError, ValueError):
            last_stage = 'unreadable'
    (output / 'sanitized-failure-context.txt').write_text(
        f'target={target}\nlauncher_exit={status}\n'
        f'prefix_tests_and_workers={count_text}\n'
        f'events={"present" if events.exists() else "missing"}\n'
        f'trace={"present" if (raw / "ptx-raw-trace.zip").exists() else "missing"}\n'
        f'screenshot={"present" if (raw / "ptx-screenshot.png").exists() else "missing"}\n'
        f'last_allowlisted_stage={last_stage}\n'
        f'failed_spec={failed_spec}\n'
        f'failure_codes={",".join(codes) if codes else "unclassified"}\n'
        'raw_error_text=not_uploaded\n'
    )


def sanitize(raw: Path, output: Path, status: int, target: str) -> None:
    output.mkdir(parents=True, exist_ok=True)
    if target not in {'candidate', 'base'}:
        raise ValueError('invalid diagnostic target')
    has_browser_env_names = screen_browser_env_names(raw, output, status, target)
    events_path = raw / 'ptx-events.json'
    events = []
    if events_path.exists():
        events = json.loads(events_path.read_text())
        if not isinstance(events, list) or not events:
            raise ValueError('PTX event record is empty or invalid')
        for event in events:
            if not isinstance(event, dict) or not isinstance(event.get('stage'), str):
                raise ValueError('PTX event shape is invalid')
        event_text = json.dumps(events, indent=2, ensure_ascii=False)
        assert_safe(event_text)
        (output / 'ptx-events.json').write_text(event_text + '\n')

    trace_path = raw / 'ptx-raw-trace.zip'
    retained_trace = 0
    if trace_path.exists():
        with zipfile.ZipFile(trace_path) as source, zipfile.ZipFile(output / 'ptx-trace-sanitized.zip', 'w', zipfile.ZIP_DEFLATED) as destination:
            for info in source.infolist():
                name = info.filename
                if '..' in Path(name).parts or name.startswith('/'):
                    raise ValueError('unsafe trace member path')
                if name.endswith('.network') or name.endswith('.stacks'):
                    continue
                if name.startswith('resources/'):
                    if not name.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                        continue
                    destination.writestr(name, source.read(info))
                    continue
                if not name.endswith('.trace'):
                    continue
                kept = []
                for line in source.read(info).decode('utf-8').splitlines():
                    event = json.loads(line)
                    if event.get('type') in {'frame-snapshot', 'resource-snapshot'}:
                        continue
                    # Trace begins only after login. Still reject any credential- or
                    # connection-bearing action rather than trying to redact it.
                    clean = json.dumps(event, ensure_ascii=False, separators=(',', ':'))
                    assert_safe(clean)
                    kept.append(clean)
                if not kept:
                    raise ValueError('trace has no retained events')
                destination.writestr(name, '\n'.join(kept) + '\n')
                retained_trace += 1
        if retained_trace != 1:
            raise ValueError('expected exactly one PTX action trace')

    screenshot = raw / 'ptx-screenshot.png'
    if screenshot.exists():
        if screenshot.read_bytes()[:8] != b'\x89PNG\r\n\x1a\n':
            raise ValueError('screenshot is not PNG')
        (output / 'ptx-screenshot.png').write_bytes(screenshot.read_bytes())

    log_path = raw / 'launcher.log'
    log = log_path.read_text(errors='replace') if log_path.exists() else ''
    observed_count = re.search(r'Running (\d+) tests? using (\d+) workers?', log)
    if observed_count and observed_count.group(1, 2) != ('32', '1'):
        raise ValueError('launcher did not report the authorized 32-test, one-worker prefix')
    if status == 0 and (not observed_count or not events or retained_trace != 1):
        raise ValueError('successful prefix is missing expected PTX evidence')
    (output / 'sanitized-log.txt').write_text(
        f'target={target}\nlauncher_exit={status}\n'
        f'selected_prefix_tests={observed_count.group(1) if observed_count else "not_reported"}\n'
        f'workers={observed_count.group(2) if observed_count else "not_reported"}\n'
        f'frontend_events={len(events)}\n'
        f'trace={"sanitized" if retained_trace else "missing"}\ntrace_network=excluded\n'
        f'browser_env_names={"screened" if has_browser_env_names else "missing"}\n'
        'trace_snapshots=excluded\nraw_launcher_log=not_uploaded\n'
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--status', type=int, required=True)
    parser.add_argument('--target', required=True)
    parser.add_argument('--context-only', action='store_true')
    args = parser.parse_args()
    if args.context_only:
        summarize_failure(args.raw, args.output, args.status, args.target)
    else:
        sanitize(args.raw, args.output, args.status, args.target)
