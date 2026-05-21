# Camunda 7 execution checklist & failure diagnosis

Use this when validating/fixing a process, or when the user says "it won't
deploy" / "it hangs" / "this branch runs twice". These are problems that are
**valid BPMN XML** but break or misbehave on the Camunda 7 engine — exactly what
`camunda-tool.mjs lint` checks for. Each item: the symptom, why, and the fix.

The linter labels findings `[ERROR]` (won't deploy / will throw), `[WARN]`
(deploys but misbehaves or is risky), `[INFO]` (advisory). Fix the model, then
re-run `lint` until it exits 0.

## Deploy-time failures (`[ERROR]`)

1. **Task with no implementation.** A `serviceTask`/`sendTask`/`businessRuleTask`
   without `camunda:class` / `delegateExpression` / `expression` /
   `type="external"` / `connector` (rule task: also `decisionRef`). Engine throws
   *"One of the attributes 'class', 'delegateExpression', 'type', or 'expression'
   is mandatory"*. → Add an implementation (see `camunda-extensions.md` §2, and
   `delegates-and-workers.md` for the code side).

2. **External task without topic.** `camunda:type="external"` but no
   `camunda:topic`. → Add `camunda:topic="..."`.

3. **Missing `historyTimeToLive`.** Since 7.20, deployment is **rejected**
   (*"historyTimeToLive cannot be null"*) when enforcement is on (default). →
   Add `camunda:historyTimeToLive="P30D"` (ISO day duration or integer days) to
   every executable `<bpmn:process>` and DMN `<decision>`. Engine-wide default:
   `camunda.bpm.generic-properties.properties.historyTimeToLive`.

4. **Dangling `messageRef`/`signalRef`/`errorRef`/`escalationRef`.** Referencing
   a message/signal/error/escalation that has no root declaration. → Declare the
   root `<bpmn:message id name>` etc. and reference its `id`. Correlation/throw
   matches by **name**/`errorCode`, not `id`.

5. **Malformed timer.** `5m`, `PT1D` (should be `P1D`), a cron in `timeDuration`,
   a missing `R`/`/` in a cycle → the engine can't schedule the job. →
   `timeDuration` = `PT5M`/`P1D`; `timeCycle` = `R3/PT10H`, an unbounded `R/PT1H`,
   or a 6–7 field (seconds-first) cron; `timeDate` = ISO datetime. A `timeDate`
   **without** a timezone still deploys (parsed in the engine's zone) — that's an
   ambiguity worth flagging, **not** a deploy error; add `Z`/an offset to be safe.

6. **Call activity without `calledElement`.** → Set `calledElement` to the target
   process id (+ binding/version), or `caseRef` for CMMN.

7. **Multi-instance without cardinality or collection.** A
   `multiInstanceLoopCharacteristics` with neither `loopCardinality` nor
   `camunda:collection` — the engine can't size the loop. → Add
   `<bpmn:loopCardinality>3</bpmn:loopCardinality>` or
   `camunda:collection="${items}" camunda:elementVariable="item"`.

8. **Script task without `scriptFormat`.** → Set `scriptFormat` (`groovy`,
   `javascript`, `feel`) and a `<bpmn:script>` body or `camunda:resource`.

9. **Error throw event without `errorRef`.** An error end/throw event must name
   the error it throws. → Reference a `<bpmn:error>` that has an `errorCode`.

## Runtime misbehaviour (`[WARN]` — deploys but wrong)

10. **Exclusive/inclusive gateway: all branches conditioned, no default.** If no
    condition matches at runtime: *"No outgoing sequence flow … could be
    selected"* and the token stops. → Mark one flow `default="..."` (and that
    default flow must have **no** condition — a condition on a default flow is
    ignored).

11. **Conditions on a parallel gateway.** A `parallelGateway` always activates
    **all** outgoing flows; `conditionExpression` on them is silently ignored, so
    branches you meant to skip still run. → Use an `inclusiveGateway` (conditional
    parallel) or `exclusiveGateway` (single path).

12. **Gateway split/join family mismatch.**
    - Parallel (AND) join after an exclusive/inclusive split → **deadlock**: only
      one branch gets a token, the AND-join waits forever.
    - Exclusive/inclusive join after a parallel (AND) split → **token
      duplication**: everything after the merge runs more than once.
    → Make the join's gateway family match the split.

13. **Error without `errorCode`.** Camunda matches thrown errors to boundary
    catchers by `errorCode`; an error with none catches *any* error (rarely
    intended). → Give every catchable `<bpmn:error>` a unique `errorCode`.

14. **Receive task / message catch without `messageRef`.** Can't be correlated
    (correlation is by message name). → Reference a `<bpmn:message>`.

15. **No async around long-running / external work.** Without
    `asyncBefore`/`asyncAfter`, everything runs in the caller's transaction: no
    retries, poor failure isolation, big transactions. → Set
    `camunda:asyncBefore="true"` on external/long tasks, looped/multi-instance
    activities, after non-interrupting triggers; add
    `camunda:failedJobRetryTimeCycle`. Keep `camunda:exclusive="true"`.

## Wrong-engine & language traps

16. **Zeebe / Camunda 8 attributes.** `zeebe:taskDefinition`, `xmlns:zeebe`,
    `executionPlatform="Camunda Cloud"` — ignored/invalid on the C7 engine (the
    model deploys but does nothing, or fails). → Use the `camunda:` equivalents
    (table below); `executionPlatform="Camunda Platform"` for forms; in Modeler
    pick "Camunda Platform 7". If the user genuinely wants Zeebe, stop — this
    skill is C7 only.

17. **Expression-language mix-up.** BPMN attributes/conditions expect **JUEL**
    (`${...}`/`#{...}`); DMN cells expect **FEEL** (`< 1000`, `"low"`). Don't put
    FEEL in BPMN or JUEL in DMN, and don't forget the `${}`.

18. **Wrong camunda URI.** `xmlns:camunda="http://activiti.org/bpmn"` works by
    leniency but is non-canonical. → `http://camunda.org/schema/1.0/bpmn`.

19. **Generic BPMN tooling stripped the extensions.** If a file went through
    plain `bpmn-moddle`/`bpmn-js` without `camunda-bpmn-moddle`, all `camunda:`
    data is gone on save. → Re-add it, and only edit/lay-out Camunda files with
    this skill's tool (which registers the camunda moddle).

## Camunda 7 vs Camunda 8 (Zeebe) cheat-sheet

| Concept | **Camunda 7** (`camunda:`) | **Camunda 8 / Zeebe** (`zeebe:`) — do NOT emit |
|---|---|---|
| Service glue | `camunda:class` / `expression` / `delegateExpression` / `type="external"`+`topic` / connector | `zeebe:taskDefinition type="..."` |
| I/O mapping | `camunda:inputOutput` / `inputParameter` / `outputParameter` | `zeebe:ioMapping` / `input` / `output` |
| User assignment | `camunda:assignee` / `candidateGroups` / `candidateUsers` | `zeebe:assignmentDefinition` |
| Forms | `camunda:formRef`+`formRefBinding` / `formKey`; platform `"Camunda Platform"` | `zeebe:formDefinition`; platform `"Camunda Cloud"` |
| DMN | `camunda:decisionRef` on business rule task | `zeebe:calledDecision` |
| Call activity | `calledElement` + `camunda:calledElementBinding`; `camunda:in`/`out` | `zeebe:calledElement processId` |
| Async/tx | `camunda:asyncBefore/After`, `exclusive`, `jobPriority`, `failedJobRetryTimeCycle` | implicit; retries via `zeebe:taskDefinition retries` |
| Listeners | `camunda:executionListener` / `taskListener` (Java/expr/script) | `zeebe:executionListeners` / `taskListeners` |
| History | `camunda:historyTimeToLive` (P…D / int days) | n/a (platform retention) |
| Expressions | **JUEL** `${...}` (FEEL only in DMN) | **FEEL** `=expr` everywhere |

**Rule:** for any Camunda 7 request emit only `camunda:` (URI
`http://camunda.org/schema/1.0/bpmn`) and JUEL `${...}`; never `zeebe:`, never
FEEL in BPMN attributes, never `executionPlatform="Camunda Cloud"`.
