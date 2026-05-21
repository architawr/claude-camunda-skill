# camunda7 — test-coverage expansion plan (unit + evals)

Goal: turn today's "happy-path + a few edge cases" suite into a **systematic safety
net** where every lint rule, every layout path, and every supported use case has a
named, deterministic test. The lint engine is both the skill's safety net *and* the
backbone of the eval grader, so a silent regression there leaks broken processes —
that is the coverage we most need to close.

## 1. Where we are today

| Layer | Count | Status |
|---|---|---|
| Unit (`test/camunda.test.mjs`) | 18 tests, 1 file | all pass |
| Evals (`evals/evals.json`) | 6 evals | with_skill 100% (opus/sonnet); haiku 96% |
| CLI (`camunda-tool.mjs`) | 0 tests | exit codes / arg handling untested |

The 18 unit tests cover: extension-preservation through layout, resync, collaboration
layout, ~9 of ~30 lint rules, A4 stub recursion, summarizeJson, diff.implChanged, find,
empty-fails-loudly. Solid spine; large untested margin.

## 2. Gap analysis

### 2a. Lint rules — the biggest gap (≈9 of ~30 covered)

`lintModel` is the core asset and the grader's backbone, yet most rules are untested.
A regression in any of these silently passes a process that won't deploy or will
deadlock. Untested rules:

- **Control flow:** `DEADLOCK` (XOR-split → AND-join), `NO DEFAULT`, `IGNORED CONDITION`
  (parallel gw + conditions), `DEFAULT WITH CONDITION`, `CONDITIONAL FLOW STUCK` (A5).
  *(Only `TOKEN DUPLICATION` is tested.)*
- **Execution readiness:** ScriptTask no `scriptFormat`, CallActivity no `calledElement`,
  ReceiveTask no `messageRef`, multi-instance with neither cardinality nor collection,
  timer with **no** spec, timer `timeDate`/`timeCycle`/cron variants (only a malformed
  `timeDuration` is tested), BusinessRuleTask DMN path.
- **Events:** message catch/throw no `messageRef`, signal no `signalRef`, error-throw no
  `errorRef`, error with no `errorCode`, escalation not declared, conditional event no
  condition.
- **Structural:** `UNREACHABLE`, `IMPLICIT SPLIT`, `MISDIRECTED EVENT`, `BAD BOUNDARY`,
  `UNASSIGNED NODE` (lane). *(Only `NO START` + `DEAD END` tested.)*
- **Process-level / advisory:** no `isExecutable` process, collaboration `INTERNAL
  MESSAGE FLOW`, form-stub INFO listing (only stub INFO tested), async-advice INFO.

### 2b. Layout & validate — contracts asserted weakly

The two named contracts (extension-preservation, non-destructive resync) have happy-path
tests, but the *interesting* paths aren't exercised:

- **Resync mutations:** the current resync test re-runs layout on a file whose DI is
  already complete, so `pruneDI` (delete a node → its shape leaves), `addDI` (add a node
  → it gets placed, existing geometry untouched), and `rerouteStaleEdges` (move a node →
  stale edge re-routes) are never actually triggered.
- **Laned layout** (`generateLanedLayout`) — untested.
- **placeExtras** — data objects, text annotations, associations, data
  input/output associations — untested.
- **Sub-process drill-down planes** — "never collapse-and-delete" is a stated contract;
  no test asserts a child plane survives a layout round-trip.
- **validateModel** — overlap detection, missing-DI detection, and plane-awareness
  (sub-process children need DI only when expanded) are all untested; we only assert
  `ok:true` on good input.

### 2c. Pure helpers — cheap, underpin everything

`implOf` has ~12 branches (delegate / external / class / expression / connector /
DMN decisionRef / script / callActivity / userTask) feeding summarize, diff, and the
grader — almost none asserted directly. `isStub`/`isFormStub` via the **documentation
"STUB"/"FORM STUB"** convention (not the property) untested. `cam` reading from the
`$attrs` bag vs a typed property untested. `diffModels` added/removed/renamed/retyped/
rewired (only implChanged tested). `summarizeText` (collaboration block, declared root
elements, parse-warning footer) untested.

### 2d. CLI — zero tests

The skill's reliable loop and the grader both depend on `lint` **exiting 1** on
ERROR/WARN and `validate` exiting 1 when invalid. Nothing tests exit codes, the
`--json`/`--rebuild` flags, layout writing in-place vs to `out`, or the usage/exit-2
path. A change to the dispatcher could break the loop without any test noticing.

### 2e. Evals — use cases the skill claims but never demonstrates

The 6 evals cover assemble-from-text, make-executable, extend (error+timer), validate+fix,
and the two reconciliation cases. Supported-but-undemonstrated use cases:

- **DMN business rule** assembly (BusinessRuleTask + `decisionRef` + a `.dmn`) — a headline
  feature with a bundled template, zero eval coverage.
- **Multi-instance** ("for each line item …") — lint rule + reference section exist; no eval.
- **Collaboration / multi-pool** with message flows — layout supports it; no eval.
- **Lanes / roles** — catalog has `roles`; no eval assigns user tasks to lanes.
- **Signal / real escalation** events — only a timer-escalation appears today.
- **Sub-process / call activity** (`calledElement` to another process) — no eval.
- **Convention inference with NO catalog** — the skill's "establish conventions first"
  promise (infer from existing `.bpmn` / `application.yaml` / CLAUDE.md) is never tested.
- **Flexible catalog form** (YAML / markdown / inline prose, not canonical JSON) — claimed
  in SKILL.md, never exercised.
- **Explain** (`/camunda7:explain`) — no eval grades a read-only explanation.
- **Scale** — a realistic 12–15-node process; today's are all small.
- **Idempotency** — running the skill twice shouldn't churn the diagram or wiring.

## 3. The plan

Five phases, ordered by risk-reduction per hour. Phases 1–3 are deterministic Node tests
(fast, run in CI on every change); phases 4–5 are eval/corpus work.

### Phase 1 — close the lint-rule gap  *(highest ROI)*

One focused test per untested rule, asserting **severity + the rule's signature phrase**
(e.g. `/ERROR DEADLOCK/`, `/WARN NO DEFAULT/`). Target: **≥1 test per lint rule**, taking
lint coverage from ~9/30 to 30/30. Split the growing file into
`test/lint.test.mjs` (rules) and keep `test/camunda.test.mjs` for layout/summarize/diff.
Add a tiny **negative companion** for the rules most prone to false positives — assert the
CLEAN baseline does *not* emit them (e.g. a sound XOR-split/XOR-join must not raise
DEADLOCK; a single unconditioned flow must not raise CONDITIONAL FLOW STUCK). Group:

1. `lint.controlflow.test.mjs` — DEADLOCK, NO DEFAULT, IGNORED CONDITION, DEFAULT WITH
   CONDITION, CONDITIONAL FLOW STUCK (+ negatives).
2. `lint.execution.test.mjs` — script/callActivity/receiveTask/multi-instance/BRT-DMN,
   timer (no-spec, timeDate, timeCycle R-interval, cron, expression-passes).
3. `lint.events.test.mjs` — message catch+throw, signal, error-throw, error-no-code,
   escalation, conditional.
4. `lint.structural.test.mjs` — UNREACHABLE, IMPLICIT SPLIT, MISDIRECTED (start+end),
   BAD BOUNDARY, UNASSIGNED NODE; collaboration INTERNAL MESSAGE FLOW; no-executable;
   form-stub INFO; async-advice INFO + its suppression on a 1-service flow.

### Phase 2 — layout & validate edge cases

`test/layout.test.mjs`:
- **Resync mutations** (the core non-destructive contract): start from a laid-out CLEAN,
  then (a) delete a node in the semantics → assert its `_di` shape is gone, others keep
  exact x/y; (b) add a node mid-flow → assert it gets a shape and neighbours keep
  geometry; (c) move a node's bounds → assert the touching edge re-routes (`rerouteStaleEdges`).
- **Laned layout** — a 2-lane process → assert lane shapes, band assignment, all nodes
  have DI, validate ok.
- **placeExtras** — DataObjectReference + TextAnnotation + Association → assert each gets DI.
- **Sub-process drill-down** — expanded sub-process round-trips through layout with its
  child plane intact (anti-collapse contract).
- **validateModel negatives** — hand-built overlap → `overlaps` non-empty, `ok:false`;
  a node missing its shape → `missing` non-empty; collapsed sub-process children **not**
  flagged missing (plane-awareness).
- **Idempotency (property test)** — `layout(layout(x)) ≈ layout(x)`: identical shape
  bounds and identical camunda extensions on the second pass (guards against churn).

### Phase 3 — helpers + CLI

`test/helpers.test.mjs` — table-driven over `implOf` (one row per branch), `isStub`/
`isFormStub` via documentation convention, `cam` from `$attrs` vs typed prop, `diffModels`
added/removed/renamed/retyped/rewired, `summarizeText` (collaboration + declared
elements + parse-warning footer).

`test/cli.test.mjs` — spawn `node scripts/camunda-tool.mjs …` against fixtures and assert
**exit codes** (lint=1 on ERROR/WARN, 0 on INFO-only; validate=1 when invalid; unknown
cmd=2), `--json` emits parseable JSON, `layout … out.bpmn` writes the new file and leaves
the input untouched, `layout` in-place rewrites, and stdout contains the expected
human-readable line. This locks the contract the skill's loop and the grader rely on.

### Phase 4 — eval expansion (6 → ~14)

Add evals + catalogs/fixtures + grader cases (extend `grade.py`'s `EVAL_ORDER`/`PREFER`
and add a `grade_run` branch each). Keep them assembly-shaped (catalog + stub + spec) so
they share the existing scaffolding:

1. **assemble-dmn** — a decision step → BusinessRuleTask `decisionRef` from the catalog +
   a deployable `.dmn`; grade decisionRef wiring, `decisionResult`/mapped result, DMNDI
   present.
2. **multi-instance-lineitems** — "for each line item, reserve stock" → multi-instance with
   `camunda:collection` + `elementVariable`; grade cardinality/collection present, lint clean.
3. **collaboration-two-pools** — customer↔system pools with a message flow → grade both
   pools laid out, message flow crosses pools, extensions survive.
4. **lanes-and-roles** — assign user tasks to lanes from catalog `roles` → grade lane
   membership + per-task candidateGroups, no UNASSIGNED NODE.
5. **infer-conventions-no-catalog** — repo has an existing `.bpmn` + `application.yaml` but
   **no catalog block**; grade that httl/retry/naming are *inferred* (not asked) and the
   follow-up states what it inferred and from where.
6. **flexible-catalog-yaml** — same as an existing eval but the catalog is YAML/inline prose;
   grade identical wiring to confirm the parser-agnostic claim.
7. **explain-readonly** — `/explain` on a wired process; grade that it describes each step's
   runtime impl (delegate/topic/DMN), changes **nothing** on disk, and flags risks.
8. **scale-15-nodes** — a realistic order-to-cash (~15 nodes, gateways, boundary, DMN,
   user tasks) → grade validate+lint clean and every user task formed/form-stubbed. Doubles
   as a layout stress test (no overlaps).

For each new eval also run the **without_skill baseline** so the benchmark keeps showing
the skill's lift, not just an absolute score.

### Phase 5 — fixtures, corpus & CI hygiene

- **Fixture corpus** — promote the inline XML in tests to `test/fixtures/*.bpmn` (+ a small
  builder helper) once the file grows; keeps tests readable.
- **Golden-corpus invariant test** — glob `evals/files/*.bpmn` + every with_skill output and
  assert blanket invariants: parses with no warnings, `layout` is a no-op-shaped round-trip
  (extensions preserved, validate ok), and the *intended-broken* inputs lint with the
  expected ERROR. This catches engine regressions against real files for free.
- **Cross-model eval matrix** — keep the opus/sonnet/haiku run (`iteration-models`) as the
  release gate; document the target (opus/sonnet 100%, haiku ≥95%) in the workspace README.
- **CI** — a `make test` / GitHub Action running `npm ci && npm test` on Node 18/20/22 so
  the deterministic suite gates every change; evals stay manual (they need a model).
- **Coverage signal** — wire `node --test --experimental-test-coverage` (or `c8`) and record
  a baseline so we can see lib.mjs line/branch coverage move as phases 1–3 land.

## 4. Targets

| Metric | Now | Target |
|---|---|---|
| Lint rules with a test | ~9/30 | 30/30 (+ negatives for FP-prone rules) |
| Layout paths with a test | 3 (single/resync-noop/collab) | + laned, mutations, extras, drill-down, idempotency |
| validate paths | 1 (ok) | + overlap, missing, plane-aware |
| CLI exit-code tests | 0 | all 4 commands |
| Evals | 6 | ~14 (+ baselines) |
| lib.mjs branch coverage | unmeasured | measured + tracked |

## 5. Suggested order of execution

Phase 1 first (most risk retired per hour, all deterministic), then 3 (helpers/CLI are
cheap and high-leverage), then 2 (layout mutations need the most care), then 4 (evals,
model time), then 5 (corpus + CI as the durable gate). Phases 1–3 can land in a single
sweep since they're all `node --test` and share fixtures.

---

## 6. Status — implemented (all phases)

| Phase | Delivered | Result |
|---|---|---|
| 1 — lint rules | `lint.controlflow/execution/events/structural.test.mjs` (35 tests) + negatives | every lint rule has a test |
| 2 — layout/validate | `layout.test.mjs` (10): resync add/prune/reroute, laned, placeExtras, drill-down, validate overlap/missing/plane-aware, idempotency | done |
| 3 — helpers + CLI | `helpers.test.mjs` (6: implOf table, doc-stubs, cam, all diff kinds, summarizeText) + `cli.test.mjs` (10: exit codes, flags, write-to-out, diff/find) | done |
| 5 — fixtures/corpus/CI | `builders.mjs` shared fixtures; `corpus.test.mjs` (7) over shipped `.bpmn`; `.github/workflows/test.yml` (Node 18/20/22); `npm run test:coverage` | done |
| 4 — evals 6→14 | +8 evals (assemble-dmn, multi-instance, collaboration, lanes-and-roles, infer-conventions, flexible-catalog-yaml, explain, scale) with catalogs/fixtures + grader branches; with_skill + baseline runs in `iteration-7` | run + graded |

**Unit suite:** 86 tests (was 18), all green. **Coverage baseline** (`node --test --experimental-test-coverage`): lib.mjs 97.15% line / 80% branch / 94% funcs; camunda-tool.mjs 97% line / 100% funcs; all files **98.6% line**. Re-measure after future engine changes; aim to hold ≥97% line and grow branch.

A finding the corpus test surfaced: the shipped `assets/process.template.bpmn` is semantics-only (no DI by design — the skill runs `layout`); the corpus invariant for it is "lints clean + validates after layout," now asserted.
