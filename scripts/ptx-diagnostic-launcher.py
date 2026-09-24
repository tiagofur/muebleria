#!/usr/bin/env python3
"""Temporary #839 laboratory overlay; apply only to a disposable checkout."""

from pathlib import Path
import sys


def patch_launcher(path: Path) -> None:
    source = path.read_text()
    cleanup_anchor = '  rm -rf "${TMP_ROOT}"'
    if 'ptx-events.json' not in source:
        if source.count(cleanup_anchor) != 1:
            raise SystemExit('launcher cleanup anchor is not unique')
        source = source.replace(cleanup_anchor, '''  if [ -n "${PTX_DIAGNOSTIC_DIR:-}" ]; then
    mkdir -p "${PTX_DIAGNOSTIC_DIR}"
    find "${TMP_ROOT}/playwright-output" -type f \\
      \\( -name 'ptx-events.json' -o -name 'ptx-raw-trace.zip' -o -name 'ptx-screenshot.png' \\) \\
      -exec cp '{}' "${PTX_DIAGNOSTIC_DIR}/" \\; 2>/dev/null || true
  fi
''' + cleanup_anchor)
    if 'VITE_PTX_DIAGNOSTIC=1' not in source:
        if 'GATE_BROWSER_ENV=(' in source:
            anchor = '  VITE_API_BASE="http://127.0.0.1:${BACKEND_PORT}/api"'
            replacement = anchor + '\n  VITE_PTX_DIAGNOSTIC=1'
        else:
            anchor = 'cd "${ROOT}"\npnpm exec playwright test'
            replacement = 'export VITE_PTX_DIAGNOSTIC=1\n' + anchor
        if source.count(anchor) != 1:
            raise SystemExit('launcher browser environment anchor is not unique')
        source = source.replace(anchor, replacement)
    path.write_text(source)


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: ptx-diagnostic-launcher.py LAUNCHER')
    patch_launcher(Path(sys.argv[1]))
