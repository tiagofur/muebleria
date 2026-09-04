# Portal browser QA

Runtime: in-app browser, report served only on127.0.0.1:55463. Product app is separate127.0.0.1:55462.

- PASS desktop1280×720: visible executive NO verdict, scope, evidence constraints, readable editorial hierarchy.
- PASS mobile390×844: screenshot assets/portal-mobile.png; document scrollWidth390 equals innerWidth390, no page-wide overflow on dashboard. Navigation has its own constrained scroll region.
- PASS section navigation: findings and dashboard headings changed on link navigation.
- PASS search: rotated reduces findings to one matching DXF record after debounce; filter retained after navigation/reload.
- PASS severity selection changes results; later version normalizes P1/HIGH and P2/MEDIUM and hides empty MVP selector.
- PASS sort NameA–Z: visible first records Agent..., Backend..., Catalog....
- PASS expand: WEB02 exposes source links, current/expected behavior, business/demo/technical impacts, recommendation and limitations.
- PASS copy feedback in final inspected version: click copy visible WEB02 then readback button Copiado ✓. Clipboard contents were not read.
- PASS source-root report remains separate from product; no remote publication.
- UNKNOWN actual file:// browser execution: blocked by browser URL safety policy. No workaround or alternate browser surface was attempted. Offline architecture validated statically (local script bundle, no remote framework/fetch dependency), not falsely recorded as file:// runtime pass.
- UNKNOWN printer/PDF output and all section×viewport combinations: print styles exist, full print rendering not executed.

Counts are live source records and may change after subsequent data supplements; these checks do not certify product runtime.
