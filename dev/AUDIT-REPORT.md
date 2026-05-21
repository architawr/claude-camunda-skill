# camunda7 skill — audit report

Date: 2026-05-21. Scope: the whole skill (SKILL.md, 5 references, `camunda-tool.mjs`,
8 templates, plugin wrapper, evals). Goal: find errors, omissions, and unaccounted-for
cases — *before* shipping.

**Method.** Re-read SKILL.md and the tool in full; ran two targeted edge-case probes;
ran two independent reviewers — one fact-checking every reference/template against the
official Camunda 7 docs (via context7 + web), one stress-testing the tool by writing and
running ~20 test `.bpmn` files. Findings below are **confirmed by execution or by a cited
doc** unless marked "theoretical".

## Verdict

The **happy path is solid** — single-pool assemble / make-executable / extend / fix all
pass 100% (Opus, Sonnet) / 96% (Haiku), `camunda:` extensions survive layout, and the
core validate→lint loop catches the deploy-blockers it targets. The gaps are at the
**edges**: collaborations/pools, structural (connectivity) linting, a few advanced BPMN
patterns absent from the references, and two real defects shipped in artifacts (the DMN
template and one mis-classified timer rule). None of these broke the evals because the
evals are single-pool and don't exercise those edges — which is itself a finding (eval
coverage gap). Nothing here is a security/safety issue; it's correctness & completeness.

Counts: **6 tool bugs** (2 high), **10 reference/template issues** (4 high), **6
skill/coverage/ops** items.

---

## A. Tool — `scripts/camunda-tool.mjs`

### A1 [HIGH] `layout` silently corrupts collaborations (2+ pools)
On a collaboration, `bpmn-auto-layout` lays out only the **first** process, and
`extractDiagramBlock` (only grabs the first `<BPMNDiagram>`) compounds it. The tool prints
"Layout regenerated … preserved" (success), but the second pool, its process, the pool
shapes and message flows get **no DI** — and a follow-up `validate` then fails
("Missing layout for N elements"), with no way to fix via `layout`. Also `validate` only
walks `Process` roots, so it never checks pool/participant or message-flow DI.
*Impact:* multi-pool models look done but aren't; confusing success-then-fail.
*Note:* the SKILL documents "first pool only" as a limit, but the tool doesn't enforce it.
*Fix:* in `layout`, detect a collaboration and either lay out per-participant + stitch, or
**fail loudly** ("collaboration layout unsupported; model pools as separate files");
have `validate` report missing pool/message-flow DI.

### A2 [HIGH] `lint` ignores parse warnings → duplicate IDs / dropped elements pass silently
`lint()` destructures only `{ rootElement }` and never reads `warnings`. A file with two
elements sharing an `id` parses with a "duplicate ID" warning and moddle **drops** the
second element, leaving a dangling flow — `lint` says "No problems found" (exit 0).
`validate` and `summarize` both surface warnings; `lint` should too.
*Fix:* read `warnings` in `lint`, emit each as ERROR/WARN (one line each).

### A3 [MED] No structural/connectivity checks
`lint` has no check for: **no start event** (process can't be instantiated), **no end
event**, **unreachable nodes** (no incoming), or **dead ends** (no path to an end). All
confirmed silent. These are common modeling mistakes that deploy but are broken.
*Fix:* add start/end presence checks and a reachability + co-reachability pass over the
`inc`/`out` graph `buildGraph` already builds.

### A4 [MED] Stub / form-stub INFO listing isn't recursive
The "Stub activities" / "Form stub(s)" INFO lines scan only top-level `proc.flowElements`,
so a stub **inside a sub-process** is omitted (confirmed) — the model may forget its spec
entry. (Per-node deploy checks *do* recurse, so deploy-safety is intact; only the reminder
is incomplete.)
*Fix:* recurse into sub-processes when collecting stubs (mirror `summarize`).

### A5 [MED] No warning for a `conditionExpression` on a non-gateway flow
A condition on a flow leaving a **task** (conditional flow) is valid in C7 but a token gets
stuck if it's false and there's no alternative — a common mistake. `lint` only checks
conditions on flows leaving gateways.
*Fix:* warn on a conditioned outgoing flow whose source isn't a gateway and that has no
sibling/default.

### A6 [MED] `layout` gives a cryptic error on an empty process / collaboration-only file
Empty process → `Cannot read properties of undefined (reading 'filter')`; collaboration
with a participant lacking `processRef` → `…(reading 'flowElements')`. Caught by the outer
try/catch (exit 1, no stack), but the message is internal/unactionable.
*Fix:* pre-check for "no flow elements" / "no process" and print a clear message.

### A7 [LOW] Overlapping boundary events not detected
`validate`'s overlap check excludes `BoundaryEvent`; auto-layout actually places two
boundary events on one task ~2.7px overlapping. Cosmetic.

### A8 [LOW] Throwing **message** event with no implementation isn't flagged (asymmetric)
A throwing **signal** event with no `signalRef` is flagged; a throwing **message** event
with no `messageRef`/implementation isn't (the `!isThrow` guard). In C7 a message throw is
a send and usually needs an implementation or it's a silent no-op.
*Fix:* flag throwing message/signal events lacking ref+implementation, consistently.

### A9 [LOW–MED] `validate` fails on *any* parse warning → version-coupling risk
Strictness is good, but a `camunda:` attribute newer than the **bundled**
`camunda-bpmn-moddle` descriptor would warn → false `INVALID`. Pin/refresh the dep, or
downgrade unknown-attribute warnings to a notice.

---

## B. References & templates — Camunda 7 correctness

### B1 [HIGH] DMN template ships with **no DMNDI** → blank in Camunda Modeler
`assets/decision.template.dmn` declares the `dmndi` namespace but contains no
`<dmndi:DMNDI>` diagram, and the `di` namespace is absent. A DMN 1.3 file with no DMNDI
opens **blank** in Modeler — yet the template comment says "verify it opens in the Modeler",
and unlike BPMN there's no layout tool for DMN.
*Fix:* ship a minimal `<dmndi:DMNDI><dmndi:DMNDiagram><dmndi:DMNShape dmnElementRef=…>` +
`xmlns:di="http://www.omg.org/spec/DMN/20180521/DI/"`, or state plainly the file must be
opened+saved in Modeler to get DI.

### B2 [HIGH] Message correlation documented as "by name" only
References repeatedly say correlation is "by message name", omitting **business key** and
**correlation keys** (variable match). Name-only is ambiguous when multiple instances wait
on the same message — a classic "correlated to the wrong/too many instances" bug.
*Fix:* add business key + correlation-key correlation; note message-start vs intermediate
semantics.

### B3 [HIGH] Multi-instance / loops never shown as buildable XML
Only the *error* case is in the checklist. No reference shows
`<multiInstanceLoopCharacteristics isSequential camunda:collection camunda:elementVariable>`,
`loopCardinality`, `completionCondition`, the `nrOfInstances/nrOfActiveInstances/loopCounter`
built-ins, or MI-body-vs-inner async.
*Fix:* add a multi-instance section to `camunda-extensions.md`.

### B4 [HIGH] Event subprocess / compensation / transaction-cancel entirely absent
No coverage of `<subProcess triggeredByEvent="true">`, compensation
(`isForCompensation`, compensate boundary + association + throw), or transaction subprocess
+ `cancelEventDefinition` — all standard C7 and needed for error-handling-via-subprocess
and saga/compensation.
*Fix:* add these patterns.

### B5 [MED] Conditional event missing `camunda:variableName` / `camunda:variableEvents`
Without them the condition re-evaluates on **every** variable change (perf/correctness
trap). `camunda-extensions.md` shows only the bare condition.

### B6 [MED] DMN `resultVariable` collision with implicit `decisionResult` not warned
The full result is always exposed as a variable literally named `decisionResult`; setting
`camunda:resultVariable="decisionResult"` makes the engine throw. The reference even uses
`${decisionResult…}` without explaining where it comes from.
*Fix:* document the implicit `decisionResult` (a `List<Map>`), the naming collision, and the
custom output-mapping pattern.

### B7 [MED] `formKey` scheme list mixes `.form` and `.html` confusingly
`forms-and-dmn.md` lists `camunda-forms:app:forms/approve.form` next to embedded HTML keys
under one "Schemes:" block. Recommend `camunda-forms:deployment:` for deployed `.form`;
separate the embedded-HTML keys.

### B8 [MED] Timer rule: "timeDate without timezone" is wrongly an ERROR
`execution-checklist.md` lists a missing-timezone `timeDate` under **deploy-time
[ERROR]**; C7 actually parses local-zone ISO datetimes — it's a warning-level ambiguity,
not a deploy failure. Also unbounded cycles `R/PT1H` aren't mentioned.
*Fix:* downgrade to WARN/notice; add unbounded `R/…` cycle.
(The **tool's** timer regex is fine; this is the doc.)

### B9 [LOW] `camunda:exclusive` "default true" — note it's only effective when async.

### B10 [LOW] Field injection — note `stringValue=`/`<camunda:string>` (and
`expression=`/`<camunda:expression>`) are mutually exclusive forms.

---

## C. Skill workflow / coverage / expectations

### C1 [MED] "Deployable stub" oversells runtime — a stubbed skeleton will **hang/blank at
runtime**. An external-task stub waits forever for a non-existent worker; a stub `formRef`
shows "form not found" in Tasklist. The skill correctly says stubs deploy, but should state
plainly (in the stub guidance and the "Watch out" follow-up) that the process **won't run
end-to-end until stubs are built** — it's a deployable *skeleton*, not a runnable process.

### C2 [MED] No DMN validation at all. The skill generates `.dmn` (and business rule tasks
reference them) but the tool is BPMN-only — a missing `<decision>` HTTL, a `decisionRef`
that doesn't match the `.dmn`, or a malformed table is never caught. Acknowledged in the
skill, but it's a real coverage hole given DMN is in scope. Consider a tiny DMN check
(decision id present, HTTL present, decisionRef↔decision id match) or say DMN must be
verified in Modeler.

### C3 [LOW] Eval coverage gap. All 6 evals are single-pool, no collaboration, no
multi-instance, no event-subprocess/compensation, no DMN actually executed. That's why the
A1/A3/B3/B4 gaps scored 100%. If these areas matter, add evals for them.

### C4 [LOW] Cosmetic SKILL.md: the "Three layers" section is numbered only "3."; the
"follow-up spec for new activities" heading also covers forms (say "activities & forms").

### C5 [INFO] `lint` makes a form-less user task a hard WARN (blocks "done"). Intended per
your request, but it means a deliberately form-less task always fails lint — by design;
just flagging the rigidity.

---

## D. Packaging / ops

### D1 [LOW] `node_modules` isn't committed (correct), so a packaged `.skill` / fresh clone
needs `npm install` before the tool runs — the SKILL documents this, but packaging/install
instructions should repeat it. The `camunda-bpmn-moddle/resources/camunda.json` require
path is version-coupled (low risk).

---

## Verified correct (don't worry about these)
Namespace URIs (`camunda` BPMN + DMN); `historyTimeToLive` formats (P…D / int days,
sub-day rejected); `formRef`/`formRefBinding`; `failedJobRetryTimeCycle` element + `R<n>/…`;
`mapDecisionResult` values + `resultList` default; external-task client annotation/package;
`.form` `executionPlatform`/`schemaVersion`; service-task implementation mutual-exclusivity;
extension preservation through `layout`; malformed-XML/DMN handling (graceful, clear errors);
gateway deadlock/duplication detection (no false positives on legit diamonds); multi-instance
`collection`-only (no false positive); the timer ISO regexes in the tool.

---

## Recommended remediation order
1. **Ship-blockers (do first):** B1 (DMN template DMNDI), A2 (lint reads warnings),
   A1 (collaboration: fail loudly or support), B8 (timer ERROR→WARN).
2. **Correctness/completeness (soon):** A3 (start/end/reachability), C1 (stub-runtime
   wording), B2/B3/B4 (correlation, multi-instance, event-subprocess/compensation refs),
   B6 (decisionResult), C2 (DMN check or disclaimer).
3. **Polish (nice-to-have):** A4, A5, A6, A8, B5, B7, B9, B10, C3 (edge-case evals), C4.

---

## Resolution — actualization round (plugin v1.1.0)

The tool was re-architected to match the sibling `bpmn` skill's current engine
(thin CLI over a tested `lib.mjs`), threading the camunda moddle through every
path so extensions survive natively (the fragile regex-graft is gone). A
`node --test` suite (18 tests) now guards it.

| Finding | Status | How |
|---|---|---|
| A1 collaboration layout | **Fixed** | Ported full collaboration (stacked pools + message flows) + lanes + data/annotations; rebuilds DI in the camunda doc. Test. |
| A2 lint ignores parse warnings | **Fixed** | `lintModel` emits each parse warning as `[ERROR] PARSE`. Test (duplicate id). |
| A3 no structural lint | **Fixed** | Ported structural rules: no-start/end, unreachable, dead-end, implicit split, misdirected event, bad boundary, lane membership. Test. |
| A4 nested stubs not listed | **Fixed** | Stub/form-stub collection now recurses all containers. Test. |
| A5 condition on non-gateway flow | **Fixed** | New `CONDITIONAL FLOW STUCK` WARN. |
| A6 cryptic error on empty/collab-only | **Fixed** | `layout` fails loudly: "nothing to lay out". Test. |
| A8 throwing message symmetry | **Fixed** | Throwing message w/o ref now flagged (INFO, no-op note). |
| B1 DMN template no DMNDI | **Fixed** | Template ships a DMNDI block (+ `di` ns); renders in Modeler. |
| B2 message correlation | **Fixed** | New "Message correlation" section (business key + correlation keys). |
| B3 multi-instance XML | **Fixed** | New "Multi-instance & loops" section. |
| B4 event subprocess/compensation/transaction | **Fixed** | New section with all three. |
| B5 conditional `variableName` | **Fixed** | Added `camunda:variableName`/`variableEvents`. |
| B6 `decisionResult` collision | **Fixed** | New subsection + custom output-mapping example. |
| B7 formKey schemes | **Fixed** | `.form` vs `.html` schemes grouped/separated. |
| B8 timer "no timezone" as ERROR | **Fixed** | Downgraded; added unbounded `R/…` cycle. |
| C1 stub oversells runtime | **Fixed** | SKILL stub guidance + lint INFO state the skeleton hangs at a stub until built. |
| C4 cosmetics | **Fixed** | Tools table (+diff/find), layout section, heading. |
| **Bonus (actualization)** | **Added** | Non-destructive resync layout (`--rebuild`), plane-aware validate, `diff`/`find`, `npm test`, `CLAUDE.md`, v1.1.0. |

**Deferred (low, by choice):** A7 (boundary-event overlap detection — cosmetic,
inherited from bpmn), A9 (validate strict-on-warnings — intentional; version drift
risk noted), B9/B10 (small `camunda:exclusive`/field-injection notes), and a
dedicated DMN linter for C2 (the DMN template is fixed and the disclaimer
strengthened, but `.dmn` files still aren't linted by the tool — verify DMN in
Modeler). C3 (edge-case evals) is partly addressed by the new unit tests, which
now cover collaboration, structural, stub-recursion, and execution-lint paths.
