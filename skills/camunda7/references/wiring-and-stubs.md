# Wiring existing activities, stubbing the rest, and the follow-up spec

This skill **assembles** processes out of activities that already exist; it does
**not** write activity implementations. This reference covers: the catalog of
available activities, how to wire one in, how to represent a missing one as a
stub, and the follow-up spec that hands stubs off to the separate implementation
task.

## 1. The project catalog

The catalog is the project's reusable inventory **and** declarations — everything
you assemble from. **Reuse its exact names everywhere** — variables, error codes,
message names, group names — so the steps actually wire together.

**What form it comes in.** The canonical form is **one JSON document** (below;
`assets/catalog.template.json`), and that's what to recommend. But accept the
catalog in whatever form the user provides — inline in the prompt, YAML, or a
Markdown table/list — and **normalize it to this schema** before wiring. If **no
catalog is given**, say so and **infer one from the repo**: search for
`JavaDelegate`/`@Component` bean names, `camunda:topic` strings, `.dmn` decision
ids, `.form` files, existing `<bpmn:message>`/`<bpmn:error>` declarations, group
names, and `application.yaml` (engine defaults). Confirm the inferred catalog with
the user before building.

Canonical JSON format (`assets/catalog.template.json`):
```json
{
  "conventions": {
    "serviceTaskStyle": "external",
    "formType": "camundaForms",
    "expressionLanguage": "juel",
    "historyTimeToLive": "P30D",
    "failedJobRetryTimeCycle": "R3/PT5M",
    "asyncDefault": "asyncBefore on external/long tasks and before waits",
    "naming": "ids PascalCase, topics kebab-case, beans camelCase"
  },
  "activities": [
    { "ref": "creditScoring", "type": "delegate", "name": "Compute credit score",
      "inputs": [{ "name": "applicantId", "type": "String" }],
      "outputs": [{ "name": "creditScore", "type": "Integer" }],
      "description": "Calls the bureau, returns a 0-1000 score." }
  ],
  "forms": [
    { "ref": "loanReviewForm", "name": "Loan review",
      "fields": [{ "key": "approved", "label": "Approve?", "type": "checkbox" }],
      "description": "Analyst decision form." }
  ],
  "variables": [
    { "name": "applicantId", "type": "String",  "description": "Applicant id." },
    { "name": "creditScore", "type": "Integer", "description": "0-1000 bureau score." },
    { "name": "approved",    "type": "Boolean", "description": "Analyst decision." }
  ],
  "messages":    [{ "name": "PaymentReceived", "description": "Bank confirms payment." }],
  "signals":     [{ "name": "BatchClosed", "description": "Daily batch closed." }],
  "errors":      [{ "errorCode": "PAYMENT_FAILED", "name": "Payment failed", "description": "Charge declined." }],
  "escalations": [{ "escalationCode": "SLA_BREACH", "name": "SLA breach" }],
  "decisions":   [{ "ref": "riskDecision", "name": "Risk", "hitPolicy": "UNIQUE",
                    "inputs": [{ "name": "amount", "type": "number" }],
                    "outputs": [{ "name": "risk", "type": "string" }] }],
  "roles":       [{ "ref": "credit-analysts", "type": "group", "description": "Loan analysts." }]
}
```

What each section wires into, and what to do when something is referenced but
missing:

| Section | Wires into | If missing |
|---|---|---|
| `conventions` | defaults for every node (see SKILL.md "Establish conventions first") | infer / ask / propose |
| `activities` | service / send / business-rule tasks (`delegateExpression`, or `type=external`+`topic`) | **stub** + spec |
| `forms` | user tasks (`camunda:formRef`) | **form-stub** + spec |
| `variables` | names used in `camunda:inputOutput` and `${…}` conditions | add to the dictionary + flag |
| `messages` | message events / receive tasks — root `<bpmn:message>`, correlate by name | declare + flag |
| `signals` | signal events — root `<bpmn:signal>` | declare + flag |
| `errors` | error events — root `<bpmn:error errorCode>` | declare + flag |
| `escalations` | escalation events — root `<bpmn:escalation>` | declare + flag |
| `decisions` | business rule tasks (`camunda:decisionRef`) | **stub** (rule task + proposed `decisionRef`) + spec |
| `roles` | user-task `camunda:candidateGroups`/`candidateUsers` | use as given + flag |

Declarations (`messages`/`signals`/`errors`/`escalations`/`variables`) you write
directly — they aren't implementations, so they aren't stubbed. Only things that
need separate **building** — activities, forms, DMN decisions — become stubs with
a spec entry. Activity `ref` = bean name (`delegate`) or topic (`external`);
`inputs`/`outputs` = the `camunda:inputOutput` contract; form `ref` = the id you
put in `camunda:formRef`.

## 2. Wiring an existing activity

Match the catalog entry's `type`. Map the data with `camunda:inputOutput` so the
flow is explicit (use the catalog's input/output names).

Delegate activity:
```xml
<bpmn:serviceTask id="ComputeScore" name="Compute credit score"
                  camunda:delegateExpression="${creditScoring}"
                  camunda:asyncBefore="true">
  <bpmn:extensionElements>
    <camunda:inputOutput>
      <camunda:inputParameter name="applicantId">${applicantId}</camunda:inputParameter>
      <camunda:outputParameter name="creditScore">${creditScore}</camunda:outputParameter>
    </camunda:inputOutput>
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

External-task activity:
```xml
<bpmn:serviceTask id="Disburse" name="Disburse funds"
                  camunda:type="external" camunda:topic="disburse-funds"
                  camunda:asyncBefore="true">
  <bpmn:extensionElements>
    <camunda:inputOutput>
      <camunda:inputParameter name="loanId">${loanId}</camunda:inputParameter>
      <camunda:inputParameter name="amount">${amount}</camunda:inputParameter>
      <camunda:outputParameter name="disbursementId">${disbursementId}</camunda:outputParameter>
    </camunda:inputOutput>
  </bpmn:extensionElements>
</bpmn:serviceTask>
```

Don't change a catalog activity's implementation style. If the inputs an activity
needs aren't available as process variables at that point, that's a real modelling
gap — surface it rather than papering over it.

## 3. Representing a missing activity as a stub

When no catalog activity fits a step, draw a **stub**: a deployable placeholder
the engine accepts, clearly marked, with the input/output contract the future
implementation must honour. This keeps the whole process layout-able, valid, and
deployable as a skeleton while flagging the work that remains.

A stub is a service task that is:
- named for the business step,
- bound as an **external task** with a kebab-case `camunda:topic` (the most
  decoupled "awaiting a worker" placeholder). If the catalog/project is
  delegate-based, use `camunda:delegateExpression="${proposedBeanName}"` instead
  to match the house style,
- given a **`camunda:inputOutput`** contract (the interface), and
- **marked** with `<bpmn:documentation>` (human) + a `camunda:property name="stub"`
  (machine):

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

`summarize` tags such a node `{STUB}`; `lint` lists it under INFO so you don't
forget the spec. Every stub must have an entry in the follow-up spec.

> Stubs are still valid Camunda nodes (external task + topic deploys and waits for
> a worker). The point of the stub is honesty: the process is complete and runnable
> as a skeleton, and the unbuilt work is explicit — not silently invented.

## 3a. User-task forms (wire from the catalog, or form-stub)

Every user task gets assignment **and** a form — same catalog discipline as
activities. Wire to a form from the catalog's `forms`:

```xml
<bpmn:userTask id="AnalystReview" name="Review loan application"
               camunda:candidateGroups="credit-analysts"
               camunda:formRef="loanReviewForm" camunda:formRefBinding="latest" />
```
(`camunda:formKey="camunda-forms:deployment:loanReviewForm.form"` is the
alternative if the project uses form keys.)

If no catalog form fits, **form-stub** it: point `camunda:formRef` at a proposed
form id, mark it, and record the form (id + fields, derived from the task's
decision/data) in the follow-up spec:

```xml
<bpmn:userTask id="ManagerApproval" name="Manager approval"
               camunda:candidateGroups="managers"
               camunda:formRef="managerApprovalForm" camunda:formRefBinding="latest">
  <bpmn:documentation>FORM STUB — to create (see spec). Fields: approved (checkbox), comment (textarea).</bpmn:documentation>
  <bpmn:extensionElements>
    <camunda:properties><camunda:property name="formStub" value="true" /></camunda:properties>
  </bpmn:extensionElements>
</bpmn:userTask>
```

`summarize` tags it `{FORM-STUB}`; `lint` lists it under INFO and WARNs about any
user task left with no form at all. The exact `.form` JSON / `formData` shapes are
in `forms-and-dmn.md` (for when the form is actually built — a separate task).

## 4. The follow-up spec

For every stub, write or append `<process>-activities-spec.md` beside the `.bpmn`
(template: `assets/activity-spec.template.md`). One section per new activity, plus
a checklist. It must let someone implement the activity without re-reading the
diagram. Example entry:

```markdown
### Send rejection notice
- **BPMN node:** `SendRejection` (external task, topic `send-rejection-notice`)
- **Purpose:** notify the applicant that the loan was rejected.
- **Inputs:** `applicantId` (String), `reason` (String)
- **Outputs:** `notificationId` (String)
- **Errors:** may throw BPMN error `NOTIFY_FAILED` if the channel is unavailable.
- **Implementation:** external-task worker on topic `send-rejection-notice`
  (matches the catalog's external-task convention).
```

## 5. Appendix — implementing a stub later (the separate task)

This is **not** part of assembling a process. Only when the user explicitly asks
you to implement an activity, build it from its spec entry. The skeletons:

JavaDelegate (for a `delegateExpression`/`class` activity) — `assets/JavaDelegate.template.java`:
```java
@Component("sendRejection")            // == camunda:delegateExpression="${sendRejection}"
public class SendRejectionDelegate implements JavaDelegate {
    @Override public void execute(DelegateExecution execution) {
        String applicantId = (String) execution.getVariable("applicantId");
        // ... do the work ...
        execution.setVariable("notificationId", id);
    }
}
```

External-task worker (for a `type="external"` activity) — `assets/ExternalWorker.template.java`:
```java
@Bean
@ExternalTaskSubscription("send-rejection-notice")   // == camunda:topic
public ExternalTaskHandler sendRejectionHandler() {
    return (task, service) -> {
        String applicantId = task.getVariable("applicantId");
        // ... do the work ...
        service.complete(task, java.util.Map.of("notificationId", id));
    };
}
```
Wire the input/output names exactly as the stub's `camunda:inputOutput` declared.
Deployment and tests: `references/deployment-and-testing.md`.
