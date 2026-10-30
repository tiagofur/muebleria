#!/usr/bin/env bash
# Idempotent GitHub label setup for the Granete Software Factory.
# Only ADDS missing factory labels; never renames or deletes existing ones.
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required to configure labels." >&2
  exit 1
fi

create_label() {
  local name="$1" color="$2" desc="$3"
  # --force updates color/description if the label already exists; names are untouched.
  gh label create "$name" --color "$color" --description "$desc" --force
}

echo "Synchronizing Software Factory labels..."

# Sizing taxonomy (drives the ~400 authored-line review budget and chained-pr)
create_label "size:xs" "C2E0C6" "< 50 authored lines (Inline Direct)"
create_label "size:s"  "BFDADC" "50-150 authored lines (Inline Direct)"
create_label "size:m"  "F9D0C4" "150-400 authored lines (Delegated Direct)"
create_label "size:l"  "E99695" "> 400 authored lines - requires chained-pr slicing"

# Governance and escalation triggers
create_label "ux:shape"      "5319E7" "Requires a published UX brief and visual evidence in the PR"
create_label "needs-human"   "D93F0B" "Requires a human decision (credentials, cost, policy, scope)"
create_label "judgment-day"  "000000" "Requires blind dual review by two independent judges"

echo "Labels synchronized."
