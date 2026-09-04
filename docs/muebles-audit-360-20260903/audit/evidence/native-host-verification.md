# Native host verification boundary

Baseline: main `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`.

CONFIRMED via native accessibility inspection: SketchUp 2026 is running; Extensions menu exposes Abrir Granete, migration, analysis, and TestUp. An existing user-owned model is active. No model contents, customer data, coordinates or screenshots are included in this report. No geometry, metadata, selection, model file or installed extension was changed. Only the menu was inspected.

UNKNOWN / NEEDS VERIFICATION: exact SHA of installed extension; disposable test model under the pinned extension; insertion/edit/undo/rollback/save-reopen; Web/Backend pairing on an isolated test organization. Existing standalone Ruby passing tests do not substitute for those proofs. The live user model was not used for destructive or mutation-dependent tests.

Next safe verification: launch a controlled disposable host session/model with the exact audited extension and isolated backend; run the declared TestUp matrix and preserve sanitized artifacts. This is a verification prerequisite, not evidence that the installed plugin is broken.
