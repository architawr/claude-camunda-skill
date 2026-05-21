---
description: Turn a plain BPMN into an executable Camunda 7 process by wiring existing activities
argument-hint: <file.bpmn (+ catalog of available activities)>
---

Use the **camunda7** skill to make $ARGUMENTS executable on Camunda Platform 7.

Run `summarize` to understand the model. **Wire each service/business-rule task to
an existing activity from the catalog** (delegate or external topic + a
`camunda:inputOutput` contract); ask for the catalog if none was given. For any
task with no matching activity, make it a **stub** (marked, with an I/O contract)
and record it in a follow-up `*-activities-spec.md` — do not write the activity's
implementation. Give user tasks assignment, add `isExecutable="true"` +
`camunda:historyTimeToLive`, and set async where failures must be isolated.
Preserve the existing structure. Finish with `layout` → `validate` → `lint` and
report what you wired vs. stubbed.
