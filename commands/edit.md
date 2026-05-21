---
description: Edit or extend an executable Camunda 7 process, preserving camunda: extensions
argument-hint: <file.bpmn> — <change>
---

Use the **camunda7** skill to apply this change to a Camunda 7 process: $ARGUMENTS

Run `summarize` to understand the current model and its existing `camunda:`
implementation, then make the change (keeping all existing execution wiring
intact). Wire any new service step to an existing activity from the catalog; if
none fits, add a **stub** (marked, with an I/O contract) and a follow-up
`*-activities-spec.md` entry — don't write activity code. Run `layout` →
`validate` → `lint`. Because the skill's tool preserves the `camunda:` namespace
through layout, the existing delegate/topic/form/async details survive. Report
what changed (and what you stubbed) plus the validate/lint result.
