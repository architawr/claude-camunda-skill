# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this repo is

A Claude Code **plugin** (and one-plugin marketplace, `camunda-tools`) for
building **executable Camunda Platform 7** processes. The shipped artifact is the
**skill** at `skills/camunda7/`; `commands/*.md` are slash-command wrappers that
invoke it. It's the Camunda-7 sibling of the generic `bpmn` plugin: same engine
shape, plus the `camunda:` execution layer. All real mechanics are deterministic
Node code you can run and test directly.

## Commands

Node work happens in `skills/camunda7/` (deps are **not** committed — install first):

```bash
cd skills/camunda7 && npm install   # fetches bpmn-moddle, bpmn-auto-layout, camunda-bpmn-moddle
npm test                            # full suite (node --test test/*.test.mjs)
npm run test:coverage               # same, with lib.mjs line/branch coverage

node scripts/camunda-tool.mjs summarize <file.bpmn> [--json]
node scripts/camunda-tool.mjs layout    <in.bpmn> [out.bpmn] [--rebuild]
node scripts/camunda-tool.mjs validate  <file.bpmn>
node scripts/camunda-tool.mjs lint      <file.bpmn>
node scripts/camunda-tool.mjs diff      <a.bpmn> <b.bpmn>
node scripts/camunda-tool.mjs find      <file.bpmn> <term>
```

## Architecture

**Three layers in every Camunda `.bpmn`.** Semantics (`bpmn:process` —
tasks/gateways/flows), **DI** (`bpmndi:` — x/y coordinates), and **execution**
(the `camunda:` extensions that make it run: delegate/external-task/forms/DMN/
async/historyTimeToLive). The design rests on: **the model edits semantics +
execution; the script owns the DI.** Never hand-write coordinates.

**`scripts/lib.mjs` is the single source of truth.** Every mechanic
(`layoutModel`, `validateModel`, `lintModel`, `summarizeText/Json`, `diffModels`,
`findModel`, plus the camunda helpers `implOf`/`isStub`/`isFormStub`/`cam`) lives
here as a function over data. `scripts/camunda-tool.mjs` is a thin CLI that only
formats output and sets exit codes. Add logic to `lib.mjs`, not the CLI.

**Extension preservation is non-negotiable.** Every parse/serialize goes through
`makeModdle()` (registers `camunda-bpmn-moddle`). Plain `bpmn-moddle` /
`bpmn-auto-layout` silently drop the `camunda:` namespace on the first
round-trip. Layout never serializes the model with a plain moddle: it runs
`bpmn-auto-layout` only to read **coordinates**, then rebuilds DI inside the
camunda-moddle document. Do not introduce a `new BpmnModdle()` without the camunda
descriptor on any path that writes the file.

**The layout safety contract (do not regress).** `layoutModel(xml, {rebuild})`:
- DI present and `rebuild` falsy → **resync**: keep geometry, `pruneDI` (drop
  deleted), `addDI` (place new), `rerouteStaleEdges`, then `placeExtras`.
- no DI, or `rebuild` true → **generate** (`generateLayout`: single /
  `generateCollaborationLayout` / `generateLanedLayout`), then `placeExtras`.
Non-destructive by default; generation rebuilds DI from coordinates into the
camunda document so extensions survive. Sub-process drill-down planes are kept
(never collapse-and-delete).

**`validateModel` is plane-aware** (overlap per plane; sub-process children need
DI only when expanded/drill-down). **`lintModel` returns `[{sev,msg}]`** =
control-flow (gateway family mismatch, no-default), structural (unreachable, dead
end, missing start/end, implicit split, misdirected, bad boundary, lane
membership), **Camunda execution** (no implementation, external-without-topic,
historyTimeToLive, timers, dangling refs, multi-instance, user-task form, zeebe),
plus parse warnings, recursive stub/form-stub listing, and async advice.

**Skill behaviour (model-facing).** It **assembles** processes by wiring existing
activities/forms from a project **catalog**; missing ones become marked **stubs**
+ a follow-up **spec** (it does NOT write activity code). It establishes project
**conventions** first (catalog block → repo → ask), reconciles the prompt with the
catalog (extra → use; conflict → surface, catalog is source of truth), and ends
with a **Done / Needs you / Watch out** follow-up.

## Working in this codebase

- TDD: add a failing test in `skills/camunda7/test/` before changing `lib.mjs`.
- When changing behaviour, update the model-facing docs too: `SKILL.md`
  (workflow/limits) and `references/*.md` (XML recipes). These are instructions to
  the model, not just humans.
- `skills/camunda7-workspace/` holds eval iterations, the audit report, and the
  grader — **not** part of the shipped plugin.
- Don't drop `camunda:` extensions; don't hand-write DI; don't collapse-delete
  sub-process planes; don't emit `zeebe:` (that's Camunda 8).
