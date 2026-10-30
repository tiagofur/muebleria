---
name: ux-brief
description: "Trigger: an issue labeled `ux:shape`, or a request for the UX brief of a screen or flow. Publishes the brief as an issue comment BEFORE implementation; never writes product code."
---

# UX brief

Read [the portable G-ODD contract](../../../docs/demo/software-factory-human-start.md),
`AGENTS.md`, and the design truth sources named below. You are a cognitive step of
the explorer role on `ux:shape` issues: shape the experience before any writer
starts. The single deliverable is one issue comment; a brief that lives only in
chat does not exist.

## Hard rules

- Unattended: never ask the user questions. Every judgment call is an explicit
  marked assumption.
- Zero code: no implementation and no mockup files.
- Publish with `gh issue comment <N> --body-file <file>` under the heading
  `## UX Brief`, ending with an `### Assumptions` list.
- Respect the hierarchy of truth and the project's design sources: the
  applicable sections of `docs/design.md` (its §8 in full when closing UI),
  `docs/operational-ux.md` for operational screens, and the UI invariant:
  design tokens, copy en español, one contextual primary action, distinct
  loading/error/stale/offline/blocked states, demonstrated a11y.
- If the issue contradicts an ADR, a domain invariant, or the design docs: do
  NOT design. Comment the contradiction, propose `status:blocked` +
  `needs-human`, and stop.

## Decision gates

| Condition | Action |
| --- | --- |
| A current brief exists for the surface | Extend it; additions inherit the established visual world |
| New surface inside an established world | Full shape; the world is inherited and fixed |
| No visual world exists yet | Deliver the brief with assumptions and flag that an attended design session is required |
| Missing context for a material decision | Marked assumption, never silent invention |

## Execution steps

1. Read the issue and its comments, the design docs above, any existing brief,
   and the current screen code for the affected surface.
2. Produce a minimal brief: user goal, composition thesis, the required states
   (empty/loading/error/stale/offline/blocked), key interactions, accessibility
   notes, and copy direction in español.
3. Publish it as the `## UX Brief` issue comment.
4. Return to the orchestrator: comment URL, a 3-line summary, the assumption
   list, and whether an attended design session is required.

## Downstream contract

- The implementer honors the brief; divergence is a scope change, not a styling
  choice, and goes back through the issue.
- The PR carries `## Visual Evidence`: screenshots naming which file proves
  what, linking the brief being honored.
- The reviewer checks fidelity to the brief and presence of visual evidence;
  missing evidence on a `ux:shape` PR is at least P1.
