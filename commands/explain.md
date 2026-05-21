---
description: Explain a Camunda 7 process in plain language, including its execution wiring
argument-hint: <file.bpmn>
---

Use the **camunda7** skill to explain $ARGUMENTS.

Run `summarize` (it shows each node's Camunda implementation, async flags,
forms/assignment, decisionRef, and historyTTL). Explain the process the way a
person would understand it — the happy path first, then decisions, parallel
work, and exception handling — and also how it actually runs on the engine:
what implements each service task, who gets each user task, which decisions are
DMN, where the transaction boundaries are. Name real business steps, not IDs,
and match the user's language.
