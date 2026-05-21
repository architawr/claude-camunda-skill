# claude-camunda-skill — Claude Code plugin for executable Camunda 7 BPMN

A [Claude Code](https://code.claude.com/docs) plugin (named **`camunda7`**) that
lets Claude **assemble, fix, and review executable Camunda Platform 7** processes
(`.bpmn`) — the kind that actually deploy and run on the engine, with `camunda:`
execution details.

The `camunda7` plugin is the Camunda 7 companion to the generic, engine-agnostic
`bpmn` plugin: where `bpmn` draws the diagram, `camunda7` works the third layer
that makes a process *run* — the `camunda:` extensions (delegate / external-task /
DMN wiring, forms, async, `historyTimeToLive`). A future Camunda 8 plugin would
live here as a sibling.

## The core idea: assemble, don't generate

The main job is **composing a business process out of activities that already
exist** — reusable service tasks implemented as Java delegates or external-task
topics, taken from a catalog you provide. The plugin wires those in and adds the
control flow (gateways, user tasks, DMN, timers, error handling, async).

It does **not** write activity implementations. When the process needs a step
that has no existing activity, Claude draws a deployable **stub** (the step's name
plus its input/output contract, marked as `stub`) and writes a **follow-up
spec** for implementing it separately — instead of inventing the Java/worker code.

## What it can do

- **Assemble** an executable process from a description + a catalog of existing
  activities (wire delegates/topics, add gateways/user tasks/DMN/timers/errors).
- **Make a plain BPMN executable** by wiring its tasks to existing activities and
  stubbing the rest.
- **Edit / extend** a Camunda process without losing its existing `camunda:`
  wiring (layout is regenerated *preserving* extensions — generic BPMN tooling
  silently drops them).
- **Validate & fix**: an execution linter catches what's valid XML but breaks on
  the engine — tasks with no implementation, external tasks with no topic, missing
  `historyTimeToLive`, conditions on a parallel gateway, dangling message/error
  refs, malformed timers, gateway deadlock/duplication, and Zeebe (Camunda 8)
  attributes used by mistake.
- **Stub + spec**: marks placeholder activities and emits the follow-up
  implementation spec.

## Requirements

- [Claude Code](https://code.claude.com/docs/en/quickstart)
- Node.js >= 18 and npm — on first use the skill runs `npm install` in its own
  folder to fetch `bpmn-moddle`, `bpmn-auto-layout`, and `camunda-bpmn-moddle`
  (deps are not committed).

This plugin is for **Camunda Platform 7** (and the API-compatible CIB seven fork).
It is **not** for Camunda 8 / Zeebe.

## Install

```text
/plugin marketplace add architawr/claude-camunda-skill
/plugin install camunda7@camunda-tools
/reload-plugins
```

Or for local development:

```bash
claude --plugin-dir ./claude-camunda-skill
```

The skill is model-invoked: Claude uses it automatically on Camunda 7 work.

## Commands

| Command | What it does |
|---|---|
| `/camunda7:create <description>` | Assemble a new executable process from existing activities |
| `/camunda7:executable <file.bpmn>` | Make a plain BPMN executable by wiring existing activities |
| `/camunda7:edit <file.bpmn> — <change>` | Edit/extend a process, preserving `camunda:` wiring |
| `/camunda7:validate <file.bpmn>` | Validate + execution-lint, then fix |
| `/camunda7:explain <file.bpmn>` | Explain a process incl. how each step runs |

## The bundled tool

A thin CLI (`scripts/camunda-tool.mjs`) over a tested engine (`scripts/lib.mjs`).
Both register `camunda-bpmn-moddle`, so `camunda:` data is never dropped — and
layout rebuilds the diagram from coordinates inside the camunda document, so
extensions survive on every path.

```bash
cd skills/camunda7 && npm install && npm test    # set up + run the test suite

node scripts/camunda-tool.mjs summarize <file.bpmn> [--json]
node scripts/camunda-tool.mjs layout    <in.bpmn> [out.bpmn] [--rebuild]   # non-destructive; --rebuild regenerates
node scripts/camunda-tool.mjs validate  <file.bpmn>
node scripts/camunda-tool.mjs lint      <file.bpmn>
node scripts/camunda-tool.mjs diff      <a.bpmn> <b.bpmn>
node scripts/camunda-tool.mjs find      <file.bpmn> <term>
```

Layout is **non-destructive** (re-syncs existing DI; `--rebuild` regenerates) and
handles single processes, collaborations (stacked pools, including black-box
participant pools), lanes, and data/annotations. The engine ships with a
`node --test` suite (run `npm test`; `npm run test:coverage` for line/branch
coverage). Full workflow and the exact `camunda:` XML recipes are in
[`skills/camunda7/SKILL.md`](skills/camunda7/SKILL.md) and its `references/`.

## License

[MIT](LICENSE) © 2026 Artur Karapetyan
