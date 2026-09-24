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


def assert_safe(value: str) -> None:
    if len(value) > TEXT_LIMIT or FORBIDDEN.search(value):
        raise ValueError('diagnostic content failed the privacy boundary')


def sanitize(raw: Path, output: Path, status: int, target: str) -> None:
    output.mkdir(parents=True, exist_ok=True)
    if target not in {'candidate', 'base'}:
        raise ValueError('invalid diagnostic target')
    events_path = raw / 'ptx-events.json'
    if not events_path.exists():
        raise ValueError('PTX event record missing')
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
    if not trace_path.exists():
        raise ValueError('PTX trace missing')
    retained_trace = 0
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

    log = (raw / 'launcher.log').read_text(errors='replace')
    observed_count = re.search(r'Running (\d+) tests? using (\d+) workers?', log)
    if not observed_count or observed_count.group(1, 2) != ('32', '1'):
        raise ValueError('launcher did not report the authorized 32-test, one-worker prefix')
    (output / 'sanitized-log.txt').write_text(
        f'target={target}\nlauncher_exit={status}\n'
        'selected_prefix_tests=32\nworkers=1\n'
        f'frontend_events={len(events)}\ntrace_network=excluded\n'
        'trace_snapshots=excluded\nraw_launcher_log=not_uploaded\n'
    )


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--raw', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--status', type=int, required=True)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    sanitize(args.raw, args.output, args.status, args.target)
