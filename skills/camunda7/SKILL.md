---
name: camunda7
description: >-
  Use this skill when a Camunda Platform 7 `.bpmn` must actually deploy and run on
  the engine — not just look right as a diagram. Covers the C7 engine, the CIB
  seven fork, and Spring Boot camunda-bpm starters. Reach for it to: assemble an
  executable process by wiring existing service tasks (Java delegates,
  external-task topics) from a catalog and stubbing steps that don't exist yet;
  make a plain diagram deployable; add or edit gateways, user tasks + forms, DMN,
  boundary/timer & escalation events, error handling, async, candidate groups,
  historyTimeToLive; or fix why a process won't deploy or misbehaves at runtime
  (historyTimeToLive cannot be null, a service task with no implementation, broken
  delegateExpression wiring, a gateway running everything twice after a merge).
  Signals: Camunda 7, camunda-bpm, CIB seven, camunda:*, JavaDelegate, external
  task, business rule task. Not for engine-agnostic diagrams (use bpmn) or Camunda
  8 / Zeebe (zeebe:, FEEL).
compatibility: Requires Node.js >= 18 and npm. On first use, run `npm install` in the skill folder to fetch bpmn-moddle, bpmn-auto-layout, and camunda-bpmn-moddle.
---

# Camunda 7: assemble and fix executable BPMN

## What this skill is for

A Camunda 7 `.bpmn` is a program the engine runs. The main job here is to
**assemble a business process by wiring together activities that already exist** —
reusable service tasks implemented as Java delegates or external-task topics — and
add the control flow (gateways, user tasks, DMN, timers, error handling, async)
that makes it deploy and run on Camunda Platform 7 (and the API-compatible CIB
seven fork).

**This skill composes processes; it does not write activity implementations.**
Writing a new activity (a delegate bean, a worker) is a *separate task*. When the
process needs a step that has no existing activity, you draw a deployable **stub**
(its name and input/output contract) and record it in a **follow-up spec** for
that separate task — you do not invent the Java/worker code here.

The four jobs people bring:

- **Assemble a process** (from text or a sketch) out of existing activities.
- **Make a plain BPMN executable** by wiring its tasks to existing activities (and
  stubbing the rest).
- **Edit / extend** a Camunda process — add steps, branches, timers, error
  handling — wiring existing activities and stubbing new ones.
- **Validate & fix** — find why it won't deploy or misbehaves, and repair it.

Division of labour:
- **You** decide the process shape and **map each step to an existing activity
  from the catalog**, or — if none fits — to a stub plus a spec entry.
- **The bundled `camunda-tool.mjs`** parses without losing `camunda:` data,
  regenerates layout, validates structure, and lints execution readiness.

## Inputs & outputs

**What you give the skill:**
- **The task** — a process description (free text) *or* a path to an existing
  `.bpmn` to make executable / extend / fix.
- **The project catalog** — the reusable inventory + declarations to assemble
  from. The **canonical form is one JSON document** (schema + template in
  `references/wiring-and-stubs.md` and `assets/catalog.template.json`), but the
  skill is flexible: it also accepts the catalog **inline in the prompt**, as
  **YAML**, or as a **Markdown table/list**, and normalizes it to that schema.
  All sections are optional. If **no catalog is given**, say so and **infer one
  from the repo** — scan for `JavaDelegate`/`@Component` bean names,
  `camunda:topic` strings, `.dmn` decision ids, `.form` files, existing
  `<bpmn:message>`/`<bpmn:error>` declarations, and group names — then confirm the
  inferred catalog with the user before building.
- **Conventions** — a `conventions` block in the catalog, or inferred from the
  project, or asked (see "Establish project conventions first").

**What the skill returns:**
- the executable **`.bpmn`** (semantics + `camunda:` + regenerated DI), passing
  `validate` and `lint`;
- a **`<process>-activities-spec.md`** whenever anything was stubbed (activities /
  forms / DMN decisions);
- `.form` / `.dmn` files only if you explicitly ask the skill to build them
  (normally those are referenced from the catalog or stubbed).

Whatever form the catalog arrives in, treat the JSON schema as the internal
model: map every entry onto it before wiring.

## Reconciling the prompt with the catalog

The prompt is itself a catalog source — the user often names activities,
variables, messages, errors, roles or conventions inline. Merge those with the
catalog file, with two rules:

- **Extra context in the prompt** (something the prompt describes that the catalog
  doesn't list): treat it as part of the catalog and **use it** — wire the
  activity the user says exists (don't stub what they've already specified),
  declare the message/error, use the variable names. Note in the follow-up that it
  came from the prompt and suggest adding it to the catalog so it's reusable.
- **Conflict** (the prompt and the catalog describe the **same** entry
  differently — different implementation type/ref/topic, variable type, message or
  error code): do **not** silently pick one and move on, and never emit both. Use
  the **catalog as the source of truth** for reusable definitions (it reflects what
  actually exists in the project), keep the model internally consistent, and
  **surface the conflict explicitly** in the follow-up — state both values, say
  which you used and why, and ask the user to confirm (interactive) or flag it for
  them to correct (non-interactive). The exception is when the user is clearly
  overriding on purpose ("our X is actually a delegate now") — then prefer the
  prompt, but still call out that it diverges from the catalog.

## Three layers, and why generic tooling breaks Camunda files

A generic `.bpmn` has **semantics** (`bpmn:process`) and **DI** (`bpmndi:` — the
picture). A Camunda 7 file adds a third, the point of it all:

3. **Execution** — the `camunda:` attributes that bind each node to how it runs:
   `camunda:delegateExpression` / `camunda:type="external"`+`camunda:topic`,
   `camunda:inputOutput`, `camunda:assignee`, `camunda:decisionRef`,
   `camunda:asyncBefore`, `camunda:historyTimeToLive`.

Consequences:
- **Never hand-write DI.** Edit semantics + execution; let `layout` redraw it.
- **Never round-trip a Camunda file through generic BPMN tooling.** Plain
  `bpmn-moddle` / `bpmn-js` / `bpmn-auto-layout` don't know `camunda:` and
  **silently delete every extension on save**, turning an executable process back
  into a picture. The bundled tool registers `camunda-bpmn-moddle` and grafts
  fresh DI onto the extension-preserving XML, so execution data is never touched.

## Setup (once per machine)

```bash
npm install --prefix "<SKILL_DIR>"
```
`<SKILL_DIR>` is the folder containing this SKILL.md. "Cannot find package" later
means the install was skipped — run it and retry.

## Establish project conventions first

Before authoring, pin down the **conventions** that shape every node — the
defaults the whole process must follow. Determine them in this order, preferring
inference over interrogation:

1. **The catalog's `conventions` block**, if present (form mechanism,
   service-task style, expression language, async/HTTL/retry defaults, naming).
2. **Project config & docs** — `CLAUDE.md`/README for house rules; Spring Boot
   `application.yaml` (`camunda.bpm.*`) for the engine's HTTL default and history
   level.
3. **Existing `.bpmn` in the repo** — run `summarize` on one or two and copy the
   house style: `camunda:formRef` or generated `formData`? delegates or external
   tasks? what id/topic/bean naming?

If a convention that materially changes the output still can't be inferred,
**ask** — briefly and batched. The two that matter most:
- **Form mechanism**: Camunda Forms (`.form` via `formRef`, recommended on 7.15+)
  / embedded HTML (`formKey="embedded:…"`) / generated `formData` / external form key.
- **Service-task style for new/stub steps**: external task / delegate / expression
  / connector.
(Also confirm, if unclear: expression conventions, async policy, the
`historyTimeToLive` and `failedJobRetryTimeCycle` defaults, naming.)

If you see a **better approach** than what's implied — e.g. the repo hand-writes
`formData` but Camunda Forms `.form` is cleaner on a 7.15+ engine, or a delegate
is simpler than an external task for in-process logic — say so in one line and
recommend it; let the user decide. In a non-interactive run, state the
conventions you assumed instead of blocking. State the conventions up front, then
apply them consistently to every node (and to stubs).

## The reliable loop

For every job: **establish conventions → get the catalog → map steps to catalog
entries (or stubs) → write semantics + execution → layout → validate → lint →
spec → fix**.

1. **Understand the inputs.** For an existing file, run `summarize` (it shows each
   node's implementation, async flags, forms, decisionRef, historyTTL, **and
   which nodes are stubs**):
   ```bash
   node "<SKILL_DIR>/scripts/camunda-tool.mjs" summarize path/to/file.bpmn
   ```
   **Get the project catalog** — the reusable inventory and declarations to build
   from: `activities` (delegates/topics), `forms`, `variables` (the data
   dictionary), `messages`/`signals`/`errors`/`escalations` (event declarations),
   `decisions` (DMN), `roles` (candidate groups/users), and `conventions`. The
   user provides it (prompt or file); if none is given, ask for it, and only as a
   last resort infer it from the repo. Reuse the catalog's exact names everywhere
   (variable names, error codes, message names, group names) so the model is
   consistent. The full catalog schema is in `references/wiring-and-stubs.md`.

2. **Map each process step to an activity, then write semantics + `camunda:`.**
   For each service step: if the catalog has a matching activity, **wire it
   exactly** (its delegate bean name or external topic, plus a
   `camunda:inputOutput` mapping for the data it consumes/produces). If nothing
   fits, make it a **stub** (next section). Hand-author a semantics-only document
   (no `bpmndi:`) with the extensions inline. Always set `isExecutable="true"` and
   `camunda:historyTimeToLive`. Get exact XML from the references — don't guess.

3. **Regenerate layout** (preserves `camunda:` extensions; non-destructive — it
   re-syncs existing DI and only adds/reroutes what changed). Add `--rebuild` to
   regenerate the whole diagram from scratch after big structural edits:
   ```bash
   node "<SKILL_DIR>/scripts/camunda-tool.mjs" layout in.bpmn [out.bpmn] [--rebuild]
   ```

4. **Validate** structure:
   ```bash
   node "<SKILL_DIR>/scripts/camunda-tool.mjs" validate out.bpmn
   ```

5. **Lint** execution + control flow:
   ```bash
   node "<SKILL_DIR>/scripts/camunda-tool.mjs" lint out.bpmn
   ```
   ERROR = won't deploy / will throw; WARN = deploys but misbehaves; INFO =
   advisory (it also lists any **stub** activities so you remember the spec).

6. **Write the follow-up spec** for every stub (next section but one).

Don't claim done until `validate` and `lint` both pass (exit 0), and every stub
is in the spec.

## Assemble from existing activities; stub the rest

This is the core behaviour, and the thing to get right:

- **Prefer existing activities.** Each service/business-rule step should reuse a
  catalog activity. Wire it with the catalog's exact reference —
  `camunda:delegateExpression="${beanName}"` for a delegate, or
  `camunda:type="external" camunda:topic="the-topic"` for an external task — and
  add a `camunda:inputOutput` mapping for the variables it reads and writes, taken
  from the catalog entry. Match the catalog's implementation style; don't convert
  a delegate activity into an external one or vice-versa.

- **Do NOT write activity implementations.** Building a delegate bean or a worker
  is a separate task. While assembling/fixing a process you produce the `.bpmn`
  (+ DMN/forms if asked) and, for new activities, a spec — never the `.java`/
  worker code. If the user explicitly asks you to also implement an activity,
  treat that as the separate task and only then use the implementation patterns in
  `references/wiring-and-stubs.md`.

- **Stub a missing activity** instead of inventing it. A stub is a real,
  deployable node so the whole process can be laid out, validated and even
  deployed as a skeleton — but it is clearly marked as "to build". Represent it as
  a service task that is:
  - named for the business step,
  - bound as an **external task** with a clear `camunda:topic` (kebab-case of the
    name) — the most decoupled "awaiting a worker" placeholder; *or*, if the
    project's catalog is delegate-based, `camunda:delegateExpression="${proposedBeanName}"`,
  - given a **`camunda:inputOutput` contract** (the inputs it will consume and the
    outputs it will produce — this is the interface the spec is written against),
  - **marked as a stub** so tooling and humans can see it:
    ```xml
    <bpmn:serviceTask id="SendRejection" name="Send rejection notice"
                      camunda:type="external" camunda:topic="send-rejection-notice">
      <bpmn:documentation>STUB — to implement (see activities spec). In: applicantId, reason. Out: notificationId.</bpmn:documentation>
      <bpmn:extensionElements>
        <camunda:properties><camunda:property name="stub" value="true" /></camunda:properties>
        <camunda:inputOutput>
          <camunda:inputParameter name="applicantId">${applicantId}</camunda:inputParameter>
          <camunda:inputParameter name="reason">${rejectionReason}</camunda:inputParameter>
          <camunda:outputParameter name="notificationId">${notificationId}</camunda:outputParameter>
        </camunda:inputOutput>
      </bpmn:extensionElements>
    </bpmn:serviceTask>
    ```
  `summarize` then tags it `{STUB}` and `lint` lists it under INFO. Tell the user,
  in plain language, which steps you wired from the catalog and which you stubbed.
  **Be honest that a stub is a deployable *skeleton*, not a runnable process:** the
  engine will **wait forever** at an external-task stub (no worker subscribed), and
  a stub `formRef` shows "form not found" in Tasklist. It deploys and validates;
  it won't run end-to-end until the stub is built. Say this in the follow-up.

- **Every user task gets assignment AND a form.** Forms work exactly like
  activities: a user task is wired to a form from the catalog's `forms` (set
  `camunda:formRef="<formId>" camunda:formRefBinding="latest"`, or a
  `camunda:formKey`). If no catalog form fits, **form-stub** it — point
  `camunda:formRef` at a proposed form id, mark it
  `<camunda:property name="formStub" value="true">` with a
  `<bpmn:documentation>FORM STUB — fields: …</bpmn:documentation>`, and add the
  form (its id + fields, derived from the task's decision/data) to the follow-up
  spec. `lint` warns about any user task with no form and lists form-stubs under
  INFO. Don't leave a user task formless.

- **Reuse the catalog's declarations and variable names.** Wire user-task
  assignment to catalog `roles` (candidate groups/users); business rule tasks to
  catalog `decisions` (`camunda:decisionRef`); and message/signal/error/escalation
  events to catalog declarations — creating the matching root `<bpmn:message>` /
  `<bpmn:signal>` / `<bpmn:error errorCode>` / `<bpmn:escalation>` from the catalog
  entry (these are declarations you write directly, not implementations to stub).
  Name process variables and every `camunda:inputOutput` parameter from the
  catalog's `variables` dictionary, not invented synonyms — consistent names are
  what make the steps actually wire together. A referenced message/error/role not
  in the catalog: add it and flag it. A missing **DMN decision** is stubbed like
  an activity (business rule task pointing at a proposed `decisionRef` + a spec
  entry).

## The follow-up spec for new activities & forms

For every stub activity **and every form-stub**, write (or append to) a spec — a
Markdown file beside the `.bpmn`, e.g. `<process>-activities-spec.md`. It is the
handoff for the separate implementation task. Use the template
`assets/activity-spec.template.md`. Per **activity** entry: name, the BPMN node
id/topic, business purpose, inputs (name / type / source variable), outputs
(name / type), error outcomes (BPMN error codes), and the suggested
implementation type (delegate vs external worker) consistent with the catalog.
Per **form** entry: the form id (the one you put in `camunda:formRef`), the user
task it belongs to, and its fields (key / label / type, required?). End with a
checklist. Keep it precise enough to build each activity/form from the spec alone
without re-reading the diagram.

## Report back: the follow-up

End every run with a short, skimmable follow-up — a handoff, not a wall of text.
Three sections; **omit any that are empty** (except Done); keep each bullet to one
line; the detail lives in the spec file, not here. Match the user's language.

**Done** — what you assembled/changed and that it's verified: the result file +
`validate`/`lint` pass; which steps you **wired from the catalog**; what you added
(gateways, error handling, timers, forms); the conventions applied.

**Needs you** — concrete asks, highest-impact first: stub activities to implement
and form-stubs to create (→ `<process>-activities-spec.md`); **data gaps** (a
variable a step needs that nothing upstream produces yet); conventions/assumptions
to confirm; deploy steps (e.g. deploy the `.form`/`.dmn` alongside the `.bpmn`). If
there's nothing, say "Deployable as is."

**Watch out** — narrow spots / risks that could bite at runtime: runtime deps
(e.g. a Groovy script engine), interrupting vs non-interrupting choices,
async/transaction trade-offs, anything you assumed rather than knew. Omit if none.

Aim for a handful of bullets total. If you stubbed things, the single most useful
line is the pointer to the spec.

## Reference files — read the one you need, don't guess XML

| When you're… | Read |
|---|---|
| Wiring existing activities and forms, representing stubs/form-stubs, the catalog format, or the spec | `references/wiring-and-stubs.md` |
| Writing the exact XML for service/user/rule tasks, listeners, I/O, async, events, call activity, process attrs | `references/camunda-extensions.md` |
| Diagnosing a deploy/runtime failure, or want the anti-pattern checklist + C7-vs-C8 cheat-sheet | `references/execution-checklist.md` |
| Form mechanics (formRef/.form, formKey, formData) or DMN decision tables | `references/forms-and-dmn.md` |
| Deploying (REST / Spring Boot / Modeler) or writing JUnit 5 + camunda-bpm-assert tests | `references/deployment-and-testing.md` |

`assets/` has templates: an executable process skeleton (a wired activity + a
stub), a DMN table, a Camunda Form, the catalog format, the activities spec, and —
for the *separate* implementation task only — JavaDelegate / external-worker
skeletons.

## Modeling for the engine, not just the picture

- **Always** `isExecutable="true"` + `camunda:historyTimeToLive` (e.g. `P30D`) on
  a runnable process — since 7.20 the engine **rejects deployment** without TTL.
  DMN `<decision>`s need it too.
- **Expressions are JUEL** (`${...}`) in BPMN attributes; **FEEL only in DMN**.
- **Pair and guard gateways.** Give a diverging exclusive/inclusive gateway a
  `default` flow; never put conditions on a parallel gateway's outgoing flows.
- **Transaction boundaries** where failure must be isolated:
  `camunda:asyncBefore="true"` on external/long activities, loops, before waits;
  add `camunda:failedJobRetryTimeCycle`. Keep `camunda:exclusive="true"`.
- **Declare what you reference** (`message`/`signal`/`error` roots; errors need an
  `errorCode`). Correlation is by name, not id.
- **Camunda 7, never 8.** Use `camunda:` (URI `http://camunda.org/schema/1.0/bpmn`),
  never `zeebe:`, never `executionPlatform="Camunda Cloud"`. If the user actually
  wants Zeebe, say so and stop.

## Layout: non-destructive by default

`layout` preserves `camunda:` extensions on every path. It is also
**non-destructive**: if the file already has DI it **re-syncs** — keeps your
existing geometry, drops shapes for deleted elements, auto-places new ones, and
reroutes only stale edges (so hand-tuned diagrams survive an edit). Pass
**`--rebuild`** to discard all DI and regenerate from scratch (use after big
structural changes, or when a diagram is messy). It lays out single processes,
**collaborations** (stacked pools + message flows), **lanes** (swimlane bands),
and data objects / text annotations / associations; sub-processes are kept as
drill-down planes. Only **groups** are not auto-placed. If a request leans on
groups, place them in a modeler or say so.

## Bundled tools

| Command | Purpose |
|---|---|
| `summarize <file> [--json]` | Outline + per-node implementation, **stub markers**, async, forms, decisionRef, historyTTL |
| `layout <in> [out] [--rebuild]` | Safe layout: re-sync existing DI (or generate); always **preserves `camunda:` extensions** |
| `validate <file>` | Parse, flag missing shapes / overlaps / parse warnings (plane-aware) |
| `lint <file>` | Control-flow + structural + Camunda execution problems (ERROR/WARN/INFO); lists stubs |
| `diff <a> <b>` | Semantic + implementation diff (added/removed/renamed/retyped/rewired/impl-changed) |
| `find <file> <term>` | Find flow elements by name/type |

All live in `scripts/camunda-tool.mjs` (engine in `scripts/lib.mjs`; tests:
`npm test`).
