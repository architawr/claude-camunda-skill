# evals — regression & triggering test suite

Test assets for developing the `camunda7` skill further. They are **not** part of
the shipped skill (`skills/camunda7/`) — they live here so they're versioned
alongside it. Eval *runs* (iterations, transcripts, grader, reports) live in
`dev/`, not here.

These LLM-graded evals test the *model's* behaviour. The script's own mechanics
are covered separately by a deterministic unit suite — run `npm test` in
`skills/camunda7/` (node `--test`, including `test/corpus.test.mjs`, which lints
and validates these same fixtures).

## Files

- `evals.json` — 14 assembly/execution cases with assertions. They exercise the
  skill's core promise: **wire executable Camunda 7 from a project catalog**, stub
  what's missing, and never write activity code. Coverage spans
  **create** (text→executable loan, plain BPMN→executable expense),
  **edit** (add error+non-interrupting timer, infer conventions with no catalog),
  **fix** (validate & repair a non-deploying order process),
  **catalog reconciliation** (prompt extends the catalog; prompt conflicts with it;
  YAML catalog), and **modelling breadth** (DMN business rule task, multi-instance,
  two-pool collaboration, lanes & roles, read-only explain, a ~15-node
  order-to-cash that doubles as a layout stress test).
- `files/` — input fixtures referenced by the cases (create cases that produce
  output from a catalog need only the catalog):
  - `*-catalog.json` (11) — project catalogs the runs assemble from: each carries a
    `conventions` block (historyTimeToLive, retries, async/service-task style) and
    the activities/forms/decisions/messages/lanes to reuse by exact name.
  - `notify-catalog.yaml` — the same catalog shape in YAML, proving the parser is
    format-agnostic (`flexible-catalog-yaml`).
  - `expense.bpmn` — a plain, pre-engine BPMN the run must make executable.
  - `invoice.bpmn` — a valid executable process, base for `extend-error-…` and the
    read-only `explain` case.
  - `infer-base.bpmn` — a valid process with its own conventions (P120D, async,
    retries) to be inferred and extended, no catalog given.
  - `order-process.bpmn` — deliberately broken (XOR-join after a parallel split,
    a `2 days` timer, missing historyTimeToLive) for the validate-&-fix case.
- `trigger-eval.json` — should/shouldn't-trigger queries for tuning the SKILL.md
  `description`, including near-miss false triggers.
- `check-fixtures.mjs` — deterministic pre-grader. Asserts the *input* fixtures are
  what their cases assume (valid bases stay healthy, the broken input still lints
  with an ERROR, every catalog parses with its conventions, every referenced
  fixture resolves) using the skill's own tools, so a broken input is caught
  without an LLM run:
  ```bash
  node evals/check-fixtures.mjs   # needs `npm install` in skills/camunda7/
  ```

## How to re-run

With the [skill-creator](https://github.com/anthropics/claude-code) workflow:
spawn with-skill + baseline runs over `evals.json`, grade each output with
`dev/grade.py` (which drives the skill's own `validate` + `lint` + `summarize`),
then aggregate into a `dev/<iteration>/benchmark.json`. For triggering, run the
description optimizer over `trigger-eval.json`.

Baseline note: a personal/installed copy of this skill auto-triggers in
subagents, which contaminates "without skill" baselines — temporarily move the
skill out of the skills path while running baselines.
