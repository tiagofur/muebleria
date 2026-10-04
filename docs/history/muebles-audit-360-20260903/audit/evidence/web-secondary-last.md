# Final secondary/inline component review

Static only; no product changes or runtime execution. Reused patterns do not certify consumer behavior.

## apps/web/src/components/BoardEditor.tsx
Resolves BOM into editorStore scratch state on module ID/composition fingerprint/preset changes; optionChoices/catalog are read through latest refs but are not effect dependencies. Resolution errors load an empty editor. Original resolved parts underpin override derivation; pose/dimension/duplicate/remove controls call editorStore and optional onOverridesChange bridges edits to parent draft. Cleanup clears editor.

Reused: Existing editorStore + BoardCanvas/BoardPropertiesPanel/Furniture3DViewer composition; reusing child names does not certify their full behavior.

UNKNOWN: Whether compositionKey includes all relevant option/catalog changes, parent override persistence and exact occurrence identity require caller/store review and tests; no inference that duplicate/remove persist merely because scratch changes. 3D/2D interaction/undo and resolution error distinction remain UNKNOWN.

Evidence: apps/web/src/components/BoardEditor.tsx:79–96, apps/web/src/components/BoardEditor.tsx:104–136, apps/web/src/components/BoardEditor.tsx:172–210

## packages/ui/src/optionGroups/PricePreviewGate.tsx
Calls canShowPricePreview using required group codes and chosen options. Missing groups become polite live-status list with label-or-code fallback; children render only when gate.ok. No price calculation, role check or persistent mutation.

Reused: Reused presentation gate; readiness is not authoritative price/release validation.

UNKNOWN: Helper validity versus retired choices, caller required-group completeness, stale prices and assistive announcements remain UNKNOWN.

Evidence: packages/ui/src/optionGroups/PricePreviewGate.tsx:20–50

## packages/ui/src/placeholder.tsx
Placeholder returns provided children or null; contains no route, workflow, data loading or feature implementation.

Reused: Passthrough React wrapper only.

UNKNOWN: Consumer routing and any business capability inferred from this export are UNKNOWN; no functional feature coverage follows from placeholder existence.

Evidence: packages/ui/src/placeholder.tsx:1–6

## packages/ui/src/purchasing/MaterialPlanningPanel.tsx
Displays derived material coverage and estimated board counts; released state short-circuits to badge. Capability defaults true and must be set by shell. Derive/reserve/shortage PO dispatch supplied callbacks. Regular release button is not disabled by releaseReady; incomplete checks display separate reason-required override action whose draft clears immediately after callback dispatch.

Reused: Reused callback-owned mutation boundary; draft reset/absence of busy is same pattern as InstallationJobPanel, not a new global finding.

UNKNOWN: Authoritative release/override rejection and durable audit, callback pending/error behavior, shell canManage assignment and unit/label completeness remain UNKNOWN. No bypass claim: regular command may be rejected server-side.

Evidence: packages/ui/src/purchasing/MaterialPlanningPanel.tsx:19–33, packages/ui/src/purchasing/MaterialPlanningPanel.tsx:46–88, packages/ui/src/purchasing/MaterialPlanningPanel.tsx:104–135, packages/ui/src/purchasing/MaterialPlanningPanel.tsx:143–175, packages/ui/src/purchasing/MaterialPlanningPanel.tsx:179–230, packages/ui/src/purchasing/MaterialPlanningPanel.tsx:239–248

## packages/ui/src/security/SecurityScreen.tsx
Inline enrollment/management actions use shared stepUp.run security_admin; await API result before clearing enrollment/showing recovery codes or reloading factors. Verify distinguishes invalid/expired errors; loading and management errors render alerts. Copy recovery codes catches clipboard failures and leaves codes readable; acknowledgment clears local codes. QR cancellation ignores late generation, manual secret derives from in-memory enrollment URI; failed QR generation stays null and UI presents generating placeholder.

Reused: Existing shared useStepUp/MFAEnrollmentHint and primary SecurityScreen fragment reused; inline source does not certify server MFA enforcement.

UNKNOWN: This supplements existing primary-screen review only: shared step-up modal behavior, cross-session unmount/reset, clipboard denial feedback and concurrent commands remain UNKNOWN here. No MFA/security probing or new security finding; existing backend/API evidence applies only to its named scope.

Evidence: packages/ui/src/security/SecurityScreen.tsx:55–98, packages/ui/src/security/SecurityScreen.tsx:100–181, packages/ui/src/security/SecurityScreen.tsx:185–194, packages/ui/src/security/SecurityScreen.tsx:215–264, packages/ui/src/security/SecurityScreen.tsx:293–328, packages/ui/src/security/SecurityScreen.tsx:339–372, packages/ui/src/security/SecurityScreen.tsx:416–425

## packages/ui/src/usability/UsabilityBenchmarkPanel.tsx
Flag is captured on mount; disabled returns null and no refresh interval runs. Enabled panel refreshes every500ms with cleanup, derives latest open task from event history and provides facilitator start/complete/abandon/help/error/session-close/reset actions. Export downloads JSON; clipboard path awaits result and provides fallback. These are facilitator annotations, not automatic proof participants completed workflows.

Reused: Existing usabilityBenchmark recorder helpers; panel is local facilitator control and must not inflate product UX acceptance metrics.

UNKNOWN: Recorder storage/telemetry privacy, interaction capture coverage, real-participant observation and performance/benchmark validity remain UNKNOWN; the real label on beginUsabilitySession is caller metadata, not evidence a study happened.

Evidence: packages/ui/src/usability/UsabilityBenchmarkPanel.tsx:39–77, packages/ui/src/usability/UsabilityBenchmarkPanel.tsx:80–120, packages/ui/src/usability/UsabilityBenchmarkPanel.tsx:122–147, packages/ui/src/usability/UsabilityBenchmarkPanel.tsx:197–220, packages/ui/src/usability/UsabilityBenchmarkPanel.tsx:249–316, packages/ui/src/usability/UsabilityBenchmarkPanel.tsx:349–359, packages/ui/src/usability/UsabilityBenchmarkPanel.tsx:362–405
