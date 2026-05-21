---
description: Assemble a new executable Camunda 7 process from existing activities
argument-hint: <process description (+ catalog of available activities)>
---

Use the **camunda7** skill to assemble an **executable** Camunda Platform 7
process for: $ARGUMENTS

Pin down trigger, participants, happy path, decisions (and the gateway that fits),
exceptions, and end states. Then **wire each service step to an existing activity
from the catalog** (delegate bean or external-task topic, with a
`camunda:inputOutput` contract). If no catalog was provided, ask for it. For any
step with no existing activity, draw a **stub** (marked, with an input/output
contract) and add it to a follow-up `*-activities-spec.md` — do **not** write the
activity's code. Always set `isExecutable="true"` and `camunda:historyTimeToLive`.
Author semantics + `camunda:`, then run `layout` → `validate` → `lint`. Save the
`.bpmn` (+ spec if there are stubs), and report what you wired vs. stubbed plus
the validate/lint result.
