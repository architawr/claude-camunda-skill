# Camunda 7 `camunda:` extension reference

Copy-paste-correct XML for the Camunda Platform 7 extension vocabulary. This is
the third layer ("execution") that makes a BPMN file deployable. All of it lives
under the namespace `camunda` = `http://camunda.org/schema/1.0/bpmn`.

> Source of truth: official Camunda 7 manual (`docs.camunda.org/manual/latest/`).
> This file targets the 7.20–7.24 line (also valid for the CIB seven fork).

## Contents
1. [Namespaces & file header](#1-namespaces--file-header)
2. [Service task implementations](#2-service-task-implementations)
3. [Field injection](#3-field-injection)
4. [Input/output mappings](#4-inputoutput-mappings)
5. [Listeners](#5-listeners)
6. [User tasks (assignment & forms)](#6-user-tasks)
7. [Async & transactions](#7-async--transactions)
8. [Process-level attributes](#8-process-level-attributes)
9. [Errors, messages, signals, timers, escalations, conditions](#9-events)
10. [Business rule task (DMN call)](#10-business-rule-task)
11. [Call activity](#11-call-activity)
12. [Multi-instance & loops](#12-multi-instance--loops)
13. [Event sub-process, compensation & transaction](#13-event-sub-process-compensation--transaction)
14. [Message correlation](#14-message-correlation)

---

## 1. Namespaces & file header

| Purpose | Prefix | URI |
|---|---|---|
| Camunda extensions | `camunda` | `http://camunda.org/schema/1.0/bpmn` |
| BPMN 2.0 model | `bpmn` (or default) | `http://www.omg.org/spec/BPMN/20100524/MODEL` |
| BPMN DI | `bpmndi` | `http://www.omg.org/spec/BPMN/20100524/DI` |
| OMG DC | `dc` | `http://www.omg.org/spec/DD/20100524/DC` |
| OMG DI | `di` | `http://www.omg.org/spec/DD/20100524/DI` |
| XSI | `xsi` | `http://www.w3.org/2001/XMLSchema-instance` |

Canonical header for an executable process (the `layout` command adds the DI
namespaces automatically if you omit them, but include `camunda` and `xsi`):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
                  id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn">
  <!-- root <bpmn:message>/<bpmn:signal>/<bpmn:error>/<bpmn:escalation> here -->
  <bpmn:process id="myProcess" name="My Process" isExecutable="true"
                camunda:historyTimeToLive="P180D">
    ...
  </bpmn:process>
</bpmn:definitions>
```

> ⚠️ Legacy snippets sometimes use `xmlns:camunda="http://activiti.org/bpmn"`.
> Wrong for Camunda 7 — always use `http://camunda.org/schema/1.0/bpmn`.

---

## 2. Service task implementations

A `serviceTask` / `sendTask` / `businessRuleTask` MUST declare exactly one
implementation, or the engine throws on deploy. (`messageEventDefinition` on a
throwing message event also takes one.)

**Java class** (implements `JavaDelegate`):
```xml
<bpmn:serviceTask id="t" name="Do work" camunda:class="org.acme.MyDelegate" />
```

**Delegate expression** (resolves a Spring/CDI bean implementing `JavaDelegate` — most common in Spring Boot):
```xml
<bpmn:serviceTask id="t" name="Do work" camunda:delegateExpression="${myBean}" />
```

**Expression** (call a bean method; capture the return with `resultVariable`):
```xml
<bpmn:serviceTask id="t" name="Score"
                  camunda:expression="${scoringBean.score(execution)}"
                  camunda:resultVariable="score" />
```

**External task** (worker pattern; `camunda:topic` is mandatory):
```xml
<bpmn:serviceTask id="t" name="Ship"
                  camunda:type="external"
                  camunda:topic="shipment"
                  camunda:taskPriority="50" />
```

**Connector** (needs the `camunda-connect` plugin; has its OWN inputOutput):
```xml
<bpmn:serviceTask id="t" name="Call REST">
  <bpmn:extensionElements>
    <camunda:connector>
      <camunda:connectorId>http-connector</camunda:connectorId>
      <camunda:inputOutput>
        <camunda:inputParameter name="url">https://api.example.com/x</camunda:inputParameter>
        <camunda:inputParameter name="method">POST</camunda:inputParameter>
        <camunda:inputParameter name="payload">${payload}</camunda:inputParameter>
        <camunda:outputParameter name="response">${response}</camunda:outputParameter>
      </camunda:inputOutput>
    </camunda:connector>
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

> `resultVariable` is only valid with `expression`. `topic`/`taskPriority` only
> with `type="external"`.

---

## 3. Field injection

Injects values into a `class`/`delegateExpression` delegate (needs a matching
setter). Child-element or attribute-shorthand form:

```xml
<bpmn:serviceTask id="t" camunda:class="org.acme.MyDelegate">
  <bpmn:extensionElements>
    <camunda:field name="text"><camunda:string>Hello</camunda:string></camunda:field>
    <camunda:field name="to"><camunda:expression>${customer.email}</camunda:expression></camunda:field>
    <camunda:field name="greeting" stringValue="Hi" />
    <camunda:field name="dyn" expression="${someVar}" />
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

---

## 4. Input/output mappings

Applies to any activity. Input params create **local** variables before the
activity; output params write to the **enclosing** scope after it.

```xml
<bpmn:extensionElements>
  <camunda:inputOutput>
    <camunda:inputParameter name="x">foo</camunda:inputParameter>
    <camunda:inputParameter name="y">${execution.processBusinessKey}</camunda:inputParameter>
    <camunda:inputParameter name="myList">
      <camunda:list>
        <camunda:value>a</camunda:value>
        <camunda:value>${1 + 1}</camunda:value>
      </camunda:list>
    </camunda:inputParameter>
    <camunda:outputParameter name="myMap">
      <camunda:map>
        <camunda:entry key="foo">bar</camunda:entry>
      </camunda:map>
    </camunda:outputParameter>
    <camunda:outputParameter name="scripted">
      <camunda:script scriptFormat="groovy"><![CDATA[ a + b ]]></camunda:script>
    </camunda:outputParameter>
  </camunda:inputOutput>
</bpmn:extensionElements>
```

`<camunda:script>` takes `scriptFormat` (`groovy`, `javascript`, `feel`, …) and
an inline body or `resource="..."`; its last expression is the value.

---

## 5. Listeners

**Execution listeners** — `event` ∈ `start` | `end` (and `take` on a sequence flow):
```xml
<bpmn:extensionElements>
  <camunda:executionListener event="start" class="org.acme.StartListener" />
  <camunda:executionListener event="end" expression="${audit.log(execution)}" />
  <camunda:executionListener event="start" delegateExpression="${listenerBean}" />
  <camunda:executionListener event="end">
    <camunda:script scriptFormat="groovy">println execution.eventName</camunda:script>
  </camunda:executionListener>
</bpmn:extensionElements>
```

**Task listeners** (user tasks only) — `event` ∈ `create` | `assignment` |
`complete` | `delete` | `update` | `timeout`. A `timeout` listener REQUIRES a
nested `timerEventDefinition` and an `id`:
```xml
<bpmn:extensionElements>
  <camunda:taskListener event="create" class="org.acme.OnCreate" />
  <camunda:taskListener event="assignment" expression="${notifier.notify(task)}" />
  <camunda:taskListener event="timeout" id="escalate" delegateExpression="${escalator}">
    <bpmn:timerEventDefinition>
      <bpmn:timeDuration xsi:type="bpmn:tFormalExpression">PT1H</bpmn:timeDuration>
    </bpmn:timerEventDefinition>
  </camunda:taskListener>
</bpmn:extensionElements>
```

---

## 6. User tasks

Assignment and metadata are **attributes**; generated forms are a child element.

```xml
<bpmn:userTask id="approve" name="Approve Invoice"
               camunda:assignee="${initiator}"
               camunda:candidateUsers="john,mary,${dynamicUser}"
               camunda:candidateGroups="management,accounting"
               camunda:dueDate="2026-06-01T12:00:00"
               camunda:followUpDate="${dateTime().plusDays(2).toDate()}"
               camunda:priority="50" />
```

Forms: see `forms-and-dmn.md`. In short — prefer `camunda:formRef` +
`camunda:formRefBinding` to a deployed `.form`, or generated `camunda:formData`.

---

## 7. Async & transactions

The engine commits at each wait state and each async boundary.

```xml
<bpmn:serviceTask id="t" camunda:delegateExpression="${myBean}"
                  camunda:asyncBefore="true"
                  camunda:asyncAfter="false"
                  camunda:exclusive="true"
                  camunda:jobPriority="100">
  <bpmn:extensionElements>
    <camunda:failedJobRetryTimeCycle>R3/PT10M</camunda:failedJobRetryTimeCycle>
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

- `asyncBefore`/`asyncAfter` (default `false`): create a transaction/save point;
  a job-executor thread continues in a new transaction.
- `exclusive` (default **`true`**): jobs of the same instance don't run
  concurrently — keep `true` to avoid `OptimisticLockingException`.
- `jobPriority`: int or `${...}`; higher runs first.
- `failedJobRetryTimeCycle`: `R<n>/<duration>` (e.g. `R5/PT5M`) or a
  comma-separated duration list (`PT5M,PT30M,PT1H`). **Only honored when the
  activity runs asynchronously.** Default without it: 3 retries, no delay.

**Set async** on tasks calling external systems, on looped/multi-instance
activities, before wait states, and wherever a step should retry independently.

---

## 8. Process-level attributes

```xml
<bpmn:process id="invoice" name="Invoice" isExecutable="true"
              camunda:historyTimeToLive="P180D"
              camunda:versionTag="1.2.0"
              camunda:isStartableInTasklist="true"
              camunda:candidateStarterGroups="accounting"
              camunda:candidateStarterUsers="john,mary">
```

- **`historyTimeToLive` (HTTL)** — retention of finished-instance history.
  Format: ISO-8601 **day** duration (`P180D`, `P30D`, `P1D`) or a bare integer =
  days (`180`). Sub-day units (`PT1H`) are **rejected**. **Required since 7.20**
  (default `enforceHistoryTimeToLive=true`): deploying without it throws
  `historyTimeToLive cannot be null`. Always set it on executable processes and
  DMN decisions.
- `versionTag` — free-text version label.
- `isStartableInTasklist` (default `true`), `candidateStarterGroups/Users`.

---

## 9. Events

### Errors (root `<bpmn:error>`, matched by `errorCode`)
```xml
<bpmn:error id="myError" name="My Error" errorCode="ORDER_INVALID"
            camunda:errorMessage="Bad order: ${cause}" />
<!-- inside the process: -->
<bpmn:boundaryEvent id="catch" attachedToRef="sub">
  <bpmn:errorEventDefinition errorRef="myError"
                             camunda:errorCodeVariable="errCode"
                             camunda:errorMessageVariable="errMsg" />
</bpmn:boundaryEvent>
```
Throw from Java: `throw new BpmnError("ORDER_INVALID", "msg")`. An error **end
event** with `errorEventDefinition errorRef="..."` throws it.

### Messages (root `<bpmn:message>`; correlate by **name**)
```xml
<bpmn:message id="payment" name="paymentReceived" />
<bpmn:intermediateCatchEvent id="wait">
  <bpmn:messageEventDefinition messageRef="payment" />
</bpmn:intermediateCatchEvent>
```

### Signals (root `<bpmn:signal>`; broadcast)
```xml
<bpmn:signal id="alert" name="alert" />
<bpmn:intermediateThrowEvent id="raise">
  <bpmn:signalEventDefinition signalRef="alert" />
</bpmn:intermediateThrowEvent>
```

### Timers (ISO-8601 / cron)
```xml
<bpmn:timerEventDefinition><bpmn:timeDate>2026-12-31T23:59:00Z</bpmn:timeDate></bpmn:timerEventDefinition>
<bpmn:timerEventDefinition><bpmn:timeDuration>PT15M</bpmn:timeDuration></bpmn:timerEventDefinition>
<bpmn:timerEventDefinition><bpmn:timeCycle>R3/PT10H</bpmn:timeCycle></bpmn:timerEventDefinition>
<bpmn:timerEventDefinition><bpmn:timeCycle>0 0/5 * * * ?</bpmn:timeCycle></bpmn:timerEventDefinition>
```
`timeDate` = ISO datetime (use a `Z`/offset); `timeDuration` = ISO duration
(`PT5M`, `P1D`); `timeCycle` = `R<n>/<dur>`, `R<n>/<start>/<dur>`, or a **cron**
(cron only on `timeCycle`; first field is seconds). Expressions `${...}` allowed.

### Escalations (root `<bpmn:escalation>`; non-interrupting-capable)
```xml
<bpmn:escalation id="late" name="late" escalationCode="LATE_SHIPMENT" />
<bpmn:intermediateThrowEvent id="esc"><bpmn:escalationEventDefinition escalationRef="late" /></bpmn:intermediateThrowEvent>
```

### Conditional
```xml
<bpmn:conditionalEventDefinition camunda:variableName="var1"
                                 camunda:variableEvents="create,update">
  <bpmn:condition xsi:type="bpmn:tFormalExpression">${var1 == 1}</bpmn:condition>
</bpmn:conditionalEventDefinition>
```
> Without `camunda:variableName` the condition is re-evaluated on EVERY variable
> change (any variable, any event). Scope it with `variableName` (+ optional
> `variableEvents` ∈ `create,update,delete`) — important on non-interrupting events.

---

## 10. Business rule task

```xml
<bpmn:businessRuleTask id="decideRisk"
    camunda:decisionRef="riskDecision"
    camunda:decisionRefBinding="latest"
    camunda:mapDecisionResult="singleEntry"
    camunda:resultVariable="risk" />
```
- `decisionRef` = DMN decision `id`.
- `decisionRefBinding` ∈ `latest` | `deployment` | `version`
  (`camunda:decisionRefVersion`) | `versionTag` (`camunda:decisionRefVersionTag`).
- `mapDecisionResult` ∈ `singleEntry` (one cell → typed value) | `singleResult`
  (one row → map) | `collectEntries` (one column → list) | `resultList` (list of
  maps, the default).
- For custom mapping omit `mapDecisionResult`/`resultVariable` and use
  `camunda:outputParameter` with `${decisionResult.getSingleResult().x}`.

See `forms-and-dmn.md` for the DMN table itself.

---

## 11. Call activity

```xml
<bpmn:callActivity id="callSub" name="Check Credit"
                   calledElement="checkCreditProcess"
                   camunda:calledElementBinding="latest">
  <bpmn:extensionElements>
    <camunda:in variables="all" />
    <camunda:out variables="all" />
    <camunda:in source="customerId" target="customerId" />
    <camunda:out sourceExpression="${total * 1.2}" target="totalWithTax" />
    <camunda:in businessKey="${execution.processBusinessKey}" />
  </bpmn:extensionElements>
</bpmn:callActivity>
```
- `calledElement` = target **process id** (required; missing → deploy/exec error).
- `camunda:calledElementBinding` ∈ `latest` | `deployment` | `version`
  (`camunda:calledElementVersion`) | `versionTag` (`camunda:calledElementVersionTag`).
- `camunda:in`/`out`: `source` (var name) or `sourceExpression` (`${...}`) →
  `target`; `variables="all"`; `businessKey`; `local="true"`.
- Programmatic mapping instead: `camunda:variableMappingClass` /
  `camunda:variableMappingDelegateExpression`.

---

## 12. Multi-instance & loops

Run an activity (any task, subprocess or call activity) multiple times. The marker
is a child of the activity:

```xml
<bpmn:serviceTask id="t" name="Process item" camunda:delegateExpression="${itemBean}">
  <bpmn:multiInstanceLoopCharacteristics isSequential="false"
        camunda:collection="${items}" camunda:elementVariable="item">
    <bpmn:loopCardinality>3</bpmn:loopCardinality>
    <bpmn:completionCondition>${nrOfCompletedInstances >= 2}</bpmn:completionCondition>
  </bpmn:multiInstanceLoopCharacteristics>
</bpmn:serviceTask>
```

- `isSequential="true"` → one instance at a time (next starts when the previous
  ends). `isSequential="false"` → **parallel** (all instances created at once, on
  concurrent executions). Required attribute.
- **Either** `loopCardinality` (fixed count or `${expr}`, evaluated once on entry)
  **or** `camunda:collection` + `camunda:elementVariable` — `collection` is a
  process-variable name *or* an `${expression}` returning a `Collection`, and
  `elementVariable` is the per-instance variable holding the current item.
- Built-in variables on the MI parent execution: `nrOfInstances` (total),
  `nrOfActiveInstances` (currently running; `1` when sequential),
  `nrOfCompletedInstances` (finished). Each instance also has the local
  `loopCounter` (0-based index).
- `completionCondition` (`${...}`) is checked after each instance completes; when
  `true` the remaining instances are cancelled and the activity completes.
- `camunda:asyncBefore`/`asyncAfter` on the MI **activity** apply to the inner
  instances. To make the MI **body** itself async (one save point around the whole
  multi-instance), put async on a nested
  `<camunda:multiInstanceLoopCharacteristics ... camunda:asyncBefore="true">` — i.e.
  async on the loop-characteristics element scopes the body, async on the activity
  scopes each instance.

**Standard loop** (repeat while a condition holds, like a while-loop):
```xml
<bpmn:serviceTask id="t" camunda:delegateExpression="${bean}">
  <bpmn:standardLoopCharacteristics
        loopMaximum="10" testBefore="true">
    <bpmn:loopCondition xsi:type="bpmn:tFormalExpression">${continue}</bpmn:loopCondition>
  </bpmn:standardLoopCharacteristics>
</bpmn:serviceTask>
```

---

## 13. Event sub-process, compensation & transaction

### Event sub-process
An inline subprocess started by its own start event whenever that event fires in
the enclosing scope. Mark `triggeredByEvent="true"`; the start event carries an
event definition (error/message/timer/escalation/conditional/compensation). An
**interrupting** start event (default) cancels the enclosing scope; set
`isInterrupting="false"` for **non-interrupting** (runs alongside).

```xml
<bpmn:subProcess id="onError" triggeredByEvent="true">
  <bpmn:startEvent id="catchErr">
    <bpmn:errorEventDefinition errorRef="myError" />
  </bpmn:startEvent>
  <!-- ...handler flow... -->
</bpmn:subProcess>

<bpmn:subProcess id="onMsg" triggeredByEvent="true">
  <bpmn:startEvent id="catchMsg" isInterrupting="false">  <!-- non-interrupting -->
    <bpmn:messageEventDefinition messageRef="payment" />
  </bpmn:startEvent>
</bpmn:subProcess>
```

### Compensation
Undo a completed activity. A **compensation boundary event** on the activity links
(via an `association`) to a **compensation handler** activity marked
`isForCompensation="true"`; compensation is **thrown** by a throw/end event with a
`compensateEventDefinition`.

```xml
<!-- boundary event on the activity to be compensated -->
<bpmn:boundaryEvent id="undoBookHotelEvt" attachedToRef="bookHotel">
  <bpmn:compensateEventDefinition />
</bpmn:boundaryEvent>

<!-- the handler (only runs during compensation) -->
<bpmn:serviceTask id="undoBookHotel" isForCompensation="true"
                  camunda:class="org.acme.CancelHotel" />

<!-- wire boundary -> handler (direction One, source = boundary, target = handler) -->
<bpmn:association id="a1" associationDirection="One"
                 sourceRef="undoBookHotelEvt" targetRef="undoBookHotel" />

<!-- throw compensation (end event; or an intermediateThrowEvent) -->
<bpmn:endEvent id="doCompensate">
  <bpmn:compensateEventDefinition />
</bpmn:endEvent>
```
An empty `compensateEventDefinition` compensates everything in scope; add
`activityRef="bookHotel"` to compensate one activity.

### Transaction subprocess
A `<bpmn:transaction>` groups activities so they all complete or all compensate.
A **cancel boundary event** triggers compensation of the transaction; the
transaction is cancelled from inside by a cancel **end event**.

```xml
<bpmn:transaction id="booking">
  <!-- ...activities, may have compensation boundary events... -->
  <bpmn:endEvent id="cancelTx">
    <bpmn:cancelEventDefinition />        <!-- cancel end event ends the transaction -->
  </bpmn:endEvent>
</bpmn:transaction>

<bpmn:boundaryEvent id="wasCancelled" attachedToRef="booking">
  <bpmn:cancelEventDefinition />          <!-- only valid on a transaction -->
</bpmn:boundaryEvent>
```
A cancel boundary event is only allowed on a `transaction`, and a cancel end event
only inside one.

---

## 14. Message correlation

A message is delivered to a **single waiting execution** matched by the message
**name** plus, optionally, the process **business key** and/or **correlation keys**
(process-variable equality). Name alone is ambiguous when several instances wait on
the same message — scope it by business key or a correlation variable.

**RuntimeService** (Java):
```java
runtimeService.createMessageCorrelation("paymentReceived")
    .processInstanceBusinessKey("ORDER-42")        // match by business key
    .correlationKeys(Map.of("orderId", "ORDER-42")) // match by process variables
    .processInstanceVariableEquals("region", "EU")  // another variable match
    .setVariable("paidAt", now)                     // injected on delivery
    .correlateWithResult();
// .correlateAllWithResult() to deliver to every match instead of exactly one
```

**REST** — `POST /message`:
```json
{
  "messageName": "paymentReceived",
  "businessKey": "ORDER-42",
  "correlationKeys": {
    "orderId": { "value": "ORDER-42", "type": "String" }
  },
  "processVariables": {
    "paidAt": { "value": "2026-05-21T10:00:00", "type": "Date" }
  }
}
```
Returns 400 if it does not correlate to **exactly one** entity (unless `"all": true`).
