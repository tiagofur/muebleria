# PTX / CADmatic 4 — HPP250/CAD4 lab receiver policy (#790)

> Scope: #790 only. This document defines the lab receiver policy for Client A
> HOLZMA HPP 250 / CADLink → CADmatic 4. It is not a productive r5
> profile, adapter identity, routing rule, field pack, `.RLT` result, customer
> candidate, or compatibility claim.

## 1. Scope and boundaries

This policy records the receiver-aware decisions that #790 may implement in a
lab-only option. It does not publish `ptx-cadmatic-4@r5`, does not bump the
productive adapter, does not select this receiver for ordinary downloads, and
does not authorize sending a PTX to the customer.

Related issue limits:

- #791 owns differential CUTS semantics beyond the receiver-safe trailing shape
  and the `FUNCTION`/`Xn` meaning split.
- #792 owns CADLink execution, `/RESULT`, `.RLT` parsing/readback, field pack
  instructions, and verification of effective `cadlink.ini` behavior.
- #793 owns final r5 integration, productive profile/adapter/catalog wiring,
  field candidate packaging, and any support claim transition.

`supportStatus` remains `NOT_TESTED` and the compatibility claim remains
`notClaimed` until CADLink conversion succeeds and the operator review confirms
semantics.

## 2. Authority classes

| Class | Meaning for #790 |
|---|---|
| `SPEC_REQUIRED` | Required or typed by Pattern Exchange. Enforce before bytes leave Granete. |
| `RECEIVER_EVIDENCED` | Repeated in the sanitized working customer samples `R2201` and `R7301`; strong receiver evidence, not a universal Pattern Exchange rule. |
| `PRODUCT_POLICY` | Granete's explicit lab policy for this receiver candidate. It must be visible/configured, not accidental serializer behavior. |
| `UNKNOWN` | No authority to emit a value. Leave blank/omit/fail closed; never guess. |

## 3. MATERIALS field authority (#790 subset)

The following table covers every `MATERIALS` field owned by #790. Pattern
Exchange defines these as real material/saw parameters; the customer samples
repeat the same values across both sanitized files. The policy is receiver
specific: it must not be hardcoded globally or backported into r2/r3/r4.

| MATERIALS field | Spec semantics | Receiver evidence | Granete authority | Source policy | Emitted value / shape |
|---|---|---|---|---|---|
| `BOOK` | QTY; max sheets per book / cutting-height capacity. Integer long quantity. | `3` in all observed material rows; `PATTERNS.MAX_BOOK=3` also repeats. | `RECEIVER_EVIDENCED` + `PRODUCT_POLICY`. | Lab receiver policy constant; must be coherent with `PATTERNS.MAX_BOOK` when the policy flag is enabled. | Emit integer `3`. Do not derive from stock count, cycles, or total boards. |
| `KERF_RIP` | DIM kerf for rip direction; numeric dimension under file units. | `4.400` in both samples. | `RECEIVER_EVIDENCED`. | Receiver policy value, not board/material metadata. | Emit `4.400` shape-equivalent numeric value (`4.4` semantic value allowed only if serializer policy normalizes consistently). |
| `KERF_XCT` | DIM kerf for crosscut direction. | `4.400` in both samples. | `RECEIVER_EVIDENCED`. | Receiver policy value. | Emit `4.400` / numeric 4.4 under the lab receiver serializer. |
| `TRIM_FRIP` | DIM fixed rip trim. | `10.000` in both samples. | `RECEIVER_EVIDENCED` expected value; Granete emission authority is executed cut-plan geometry. | `FROM_CUTPLAN_GEOMETRY` with expected receiver value `10`; defined executed geometry must match or compilation blocks. | Emit the executed geometry value only. If geometry is absent while expected value is nonzero, block; never fabricate `0` or an override. |
| `TRIM_VRIP` | DIM variable rip trim. | `0` in both samples. | `RECEIVER_EVIDENCED` expected value; Granete emission authority is executed cut-plan geometry. | `FROM_CUTPLAN_GEOMETRY` with expected receiver value `0`; defined executed geometry must match or compilation blocks. | Emit the executed geometry value only. If geometry is absent and expected is `0`, leave absent; do not mirror `TRIM_FRIP` and do not convenience-fill zero. |
| `TRIM_FXCT` | DIM fixed crosscut trim. | `10.000` in both samples. | `RECEIVER_EVIDENCED` expected value; Granete emission authority is executed cut-plan geometry. | `FROM_CUTPLAN_GEOMETRY` with expected receiver value `10`; defined executed geometry must match or compilation blocks. | Emit the executed geometry value only. If geometry is absent while expected value is nonzero, block. |
| `TRIM_VXCT` | DIM variable crosscut trim. | `0` in both samples. | `RECEIVER_EVIDENCED` expected value; Granete emission authority is executed cut-plan geometry. | `FROM_CUTPLAN_GEOMETRY` with expected receiver value `0`; defined executed geometry must match or compilation blocks. | Emit the executed geometry value only. If geometry is absent and expected is `0`, leave absent; do not mirror `TRIM_FXCT` and do not convenience-fill zero. |
| `TRIM_HEAD` | DIM head trim. | `20.000` in both samples. | `RECEIVER_EVIDENCED` observed value, but #790 lacks product/geometry authority to emit it. | `OMIT_NO_OVERRIDE`; accidental value makes the policy invalid. | Omit/leave absent. |
| `TRIM_FRCT` | DIM fixed recut trim. | `20.000` in both samples. | `RECEIVER_EVIDENCED` observed value, but #790 lacks product/geometry authority to emit it. | `OMIT_NO_OVERRIDE`; accidental value makes the policy invalid. | Omit/leave absent. |
| `TRIM_VRCT` | DIM variable recut trim. | `0` in both samples. | `RECEIVER_EVIDENCED` observed value, but #790 lacks product/geometry authority to emit it. | `OMIT_NO_OVERRIDE`; accidental value makes the policy invalid. | Omit/leave absent. |
| `RULE1` | INT `1..9` by Pattern Exchange. Optimization/material rule field. | `6` in both samples. | `SPEC_REQUIRED` range + `RECEIVER_EVIDENCED` value. | Receiver policy value. | Emit integer `6`; block outside `1..9`. |
| `RULE2` | INT `0,1` by Pattern Exchange. | `1` in both samples. | `SPEC_REQUIRED` range + `RECEIVER_EVIDENCED` value. | Receiver policy value. | Emit integer `1`; block outside `{0,1}`. |
| `RULE3` | INT `0,1` by Pattern Exchange. | `1` in both samples. | `SPEC_REQUIRED` range + `RECEIVER_EVIDENCED` value. | Receiver policy value. | Emit integer `1`; block outside `{0,1}`. |
| `RULE4` | INT `0,1` by Pattern Exchange. | `1` in both samples. | `SPEC_REQUIRED` range + `RECEIVER_EVIDENCED` value. | Receiver policy value. | Emit integer `1`; block outside `{0,1}`. |

Non-owned `MATERIALS` notes for #790:

- `CODE` and `DESC` keep their existing material authority and spec text limit.
- `THICK` must come from Granete's material/cut-plan authority. Do not copy the
  customer sample's apparent `+0.29/+0.30` thickness convention; the semantic
  source remains unknown for Granete.
- `MAT_PARAM`, material grain, picture, density, or other later optional fields
  remain `UNKNOWN` unless separately modeled with authority.

## 4. Receiver-aware record order

The lab receiver policy adopts the order observed in both sanitized customer
samples, while explicitly classifying it as receiver-aware evidence rather than
universal Pattern Exchange:

| Order | Family | #790 policy |
|---:|---|---|
| 1 | `HEADER` | First record. |
| 2 | `JOBS` | Explicit row, receiver-shaped; do not rely on implicit job. |
| 3 | `PARTS_REQ` | Before label families. |
| 4 | `PARTS_INF` | Immediately after `PARTS_REQ`; model from #789. |
| 5 | `PARTS_UDI` | Immediately after `PARTS_INF`; structural rows only unless authority exists. |
| 6 | `BOARDS` | Before `MATERIALS`, matching receiver evidence. |
| 7 | `MATERIALS` | After `BOARDS`, with #790 policy fields. |
| — | `NOTES` | Omitted under #790 lab receiver policy. The samples include the family, but Granete has no authoritative note content and no need to invent a blank family. |
| 8 | `OFFCUTS` | Before `PATTERNS`/`CUTS`, matching receiver evidence. |
| 9 | `PATTERNS` / `CUTS` | Pattern row followed by its cuts as the existing serializer model supports. |

This order is a candidate receiver policy. It must not be documented or tested as
a global Pattern Exchange requirement.

## 5. BOARDS shape policy

Current model status: Granete already owns board identity, quantity, dimensions,
material reference, and used quantity semantics. #790 may extend the receiver lab
shape only where authority exists.

| BOARDS decision | Classification | Policy |
|---|---|---|
| `BRD_INDEX`, `CODE`, `QTY_STOCK`, `LENGTH`, `WIDTH`, material/job references | `SPEC_REQUIRED` + existing product model | Keep current authoritative values and spec limits. |
| Receiver order before `MATERIALS` | `RECEIVER_EVIDENCED` | Use only in the #790 lab receiver policy. |
| Additional used/summary numeric fields already modeled by Granete | `PRODUCT_POLICY` | Emit only when the current model has explicit semantics. |
| `COST` | `SPEC_REQUIRED` shape/domain: Pattern Exchange `FLT 0..9.99`; `UNKNOWN` Granete product authority | Receiver samples show values outside the spec range. Preserve that as unresolved receiver dialect evidence, but do not invent, copy, normalize, compute, or emit a cost value by default. Emitted: absent. |
| `STK_FLAG` | `SPEC_REQUIRED` shape/domain: Pattern Exchange `INT 0..9`; `UNKNOWN` Granete product authority | Model the optional trailing field, but do not invent or emit a stock flag value by default. Emitted: absent. |
| Other trailing optional cells | `UNKNOWN` | Preserve empty/omitted trailing discipline; no placeholder values. |

## 6. JOBS, PATTERNS, and CUTS trailing policy

- `JOBS`: emit an explicit receiver row but do not invent dates, customer name,
  `OPT_PARAM`, or `SAW_PARAM`. Use only values Granete already owns; otherwise
  leave cells empty/omit trailing optional fields. Customer samples contain dates
  and customer/text values, but those are not Granete authority.
- `PATTERNS`: keep `QTY_RUN=1` and `QTY_CYCLES=1`. Set `MAX_BOOK=3` only when
  `requireBookMaxBookCoherence` is enabled under the lab receiver policy,
  because it is receiver-evidenced and coherent with `MATERIALS.BOOK=3`. Do
  not multiply run/cycle counts to simulate book size.
- `CUTS`: comments are disabled under receiver policy. Pattern Exchange permits
  comments, but r5 receiver policy should not carry internal `strip-*`/`place-*`
  debug text into CADLink.
- `OPT_PARAM`, `SAW_PARAM`, customer, dates, comments, and any optional trailing
  cell without authority remain blank/omitted. Empty-vs-omitted behavior must be
  intentional and covered by receiver readback, not accidental serializer drift.

## 7. CADLink dependency captured for later verification

#790 documents dependencies but does not verify CADLink execution. #792 must
capture and verify them with `/RESULT` and effective configuration readback.

- CADLink must run in CADmatic 4 mode: `/CAD4`.
- `/INF` and `/UDI` affect how `PARTS_INF` and `PARTS_UDI` are carried into
  information boxes. Their order matters according to CADLink help.
- Default command policy for the r5 field pack should be `/UDI /INF` unless
  #792 evidence proves a different order for this receiver.
- `cadlink.ini` beside `cadlink.exe` overrides command-line options. Therefore
  a command line alone is not sufficient evidence; #792 must capture the
  effective settings or the exact `.rlt`/result context.

## 8. R2201/R7301 differences and explicit UNKNOWNs

The sanitized samples are strong receiver evidence, not a byte template.
#790 must preserve these differences instead of copying unexplained sample data:

- Do not add `+0.3 mm` to `THICK`; Granete emits its authoritative material
  thickness only.
- Do not copy `BOARDS.COST` or any cost-like sample value. Pattern Exchange
  documents `COST` as `FLT 0..9.99`; receiver samples show out-of-range values,
  which remain unresolved receiver dialect evidence. Granete product authority
  is `UNKNOWN`, so the compiler/receiver policy does not invent or emit a value
  by default.
- Do not infer or emit `STK_FLAG`. Pattern Exchange documents `STK_FLAG` as
  `INT 0..9`; Granete product authority remains `UNKNOWN`, so the compiler/
  receiver policy does not invent or emit it by default.
- Do not generate `PARTS_UDI.INFO2` compact edge encodings such as `2WE2LE`;
  their semantics remain `UNKNOWN`.
- Do not copy or invent `NOTES` rows.
- Do not copy sample dates, customer strings, private codes, paths, or barcode
  conventions unless already modeled by #789/#790 product policy.

## 9. Verification notes and limits

#790 verification can demonstrate only offline properties:

- receiver policy is opt-in/lab-only and not selected by productive r4/r5
  routing;
- r2/r3/r4 bytes and digests remain immutable;
- strict spec preflight still owns documented field limits;
- receiver readback checks `MATERIALS`, `BOOK`/`MAX_BOOK`, record order,
  `BOARDS` optional trailing shape, `JOBS`/`PATTERNS`/`CUTS` trailing policy,
  trim coherence for `TRIM_FRIP`/`TRIM_VRIP`/`TRIM_FXCT`/`TRIM_VXCT`, and absence
  of unauthorized values;
- sanitized R2201/R7301 fixtures remain differential evidence, not goldens to
  copy byte-for-byte.

Out of scope for #790 verification:

- CADLink conversion success, `.SAW` generation, `.RLT` success, or effective
  `cadlink.ini` behavior (#792);
- final r5 profile/adapter/catalog publication (#793);
- customer/operator semantic acceptance or controlled physical cut.
