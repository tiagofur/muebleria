#!/usr/bin/env python3
"""One-shot ledger reconciliation after PR #484 was merged.

The merge contained the implementation but intentionally left F197 active while
an independent correction review was pending. That review completed before the
merge, so main must record the completed state before another feature starts.
"""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

FEATURE_ID = "F197"
TODAY = date.today().isoformat()

feature_path = Path("feature_list.json")
data = json.loads(feature_path.read_text(encoding="utf-8"))
features = data.get("features")
if not isinstance(features, list):
    raise SystemExit("feature_list.json does not contain a features array")

matches = [feature for feature in features if feature.get("id") == FEATURE_ID]
if len(matches) != 1:
    raise SystemExit(f"expected exactly one {FEATURE_ID}, found {len(matches)}")

feature = matches[0]
if feature.get("status") not in {"in_progress", "done"}:
    raise SystemExit(f"unexpected {FEATURE_ID} status: {feature.get('status')!r}")
feature["status"] = "done"
feature["completedAt"] = feature.get("completedAt") or TODAY
notes = feature.setdefault("review_notes", [])
final_note = (
    "PR #484 merged as 5f4eb3112e7cc967425fef413e6c543e82ebcd15 "
    "after the corrected support-session/lifecycle head completed independent "
    "review and CI; F197 is closed before starting #458."
)
if final_note not in notes:
    notes.append(final_note)

in_progress = [item.get("id") for item in features if item.get("status") == "in_progress"]
if in_progress:
    raise SystemExit(f"cannot close ledger: other active features remain: {in_progress}")

feature_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

Path("progress/current.md").write_text("# Sin feature activa\n", encoding="utf-8")

history_path = Path("progress/history.md")
history = history_path.read_text(encoding="utf-8") if history_path.exists() else "# Historial\n"
entry = f"""
## {TODAY} — F197 / #452 cerrado después del merge de PR #484

- `main` incorporó el lifecycle explícito y provisioning atómico de organizaciones mediante PR #484.
- La corrección final serializa support sessions con suspensión/offboarding y mantiene el credential epoch organizacional.
- F197 pasa de `in_progress` a `done`; `progress/current.md` vuelve a no tener feature activa.
- El PR #486 debe rebasarse sobre `main` y usar un feature ID/migrations disponibles antes de cualquier merge posterior.
"""
if "F197 / #452 cerrado después del merge de PR #484" not in history:
    history_path.write_text(history.rstrip() + "\n\n" + entry.rstrip() + "\n", encoding="utf-8")
