---
description: Validate & fix a Camunda 7 process (structure + engine execution readiness)
argument-hint: <file.bpmn>
---

Use the **camunda7** skill to check why $ARGUMENTS won't deploy or misbehaves,
and fix it.

Run the skill's `summarize`, `validate`, and `lint`. `lint` reports Camunda
execution problems (tasks with no implementation, external tasks with no topic,
missing `historyTimeToLive`, conditions on a parallel gateway, dangling
message/error refs, bad timers, gateway deadlock/duplication, Zeebe-by-mistake)
as ERROR/WARN/INFO. Fix the semantics/execution behind each finding, re-run
`layout` → `validate` → `lint` until both pass, and explain in plain language
what was wrong and what you changed.
