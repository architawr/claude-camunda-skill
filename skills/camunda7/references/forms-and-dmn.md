# Camunda 7 forms & DMN

How to give a user task a form, and how to back a business rule task with a DMN
decision table. Templates: `assets/form.template.form`, `assets/decision.template.dmn`.

## User-task forms

**Every user task gets a form.** Like activities, forms are assembled from the
catalog's `forms`: wire `camunda:formRef` to an existing form. If no catalog form
fits, **form-stub** it (point `camunda:formRef` at a proposed id, mark
`camunda:property name="formStub" value="true"`, and put the form's id + fields in
the follow-up spec) — see `wiring-and-stubs.md`. This section is the form
**mechanics** for when a form is actually built (the separate task).

Three mechanisms, pick by context:

### 1. Camunda Form (`.form` JSON) — preferred for new work (C7 ≥ 7.15)
A JSON document (form-js schema) deployed alongside the BPMN, referenced via
`camunda:formRef`:

```xml
<bpmn:userTask id="t" name="Approve" camunda:formRef="approveForm" camunda:formRefBinding="latest" />
<!-- binding = latest | deployment | version (+ camunda:formRefVersion="3") -->
```

Minimal `approveForm.form`:
```json
{
  "type": "default",
  "id": "approveForm",
  "schemaVersion": 16,
  "executionPlatform": "Camunda Platform",
  "executionPlatformVersion": "7.23.0",
  "components": [
    { "key": "approved", "label": "I approve", "type": "checkbox" },
    { "key": "comment",  "label": "Comment",   "type": "textarea" },
    { "key": "amount",   "label": "Amount",    "type": "number", "validate": { "min": 0 } },
    { "key": "dept", "label": "Department", "type": "select",
      "values": [ { "label": "Sales", "value": "sales" }, { "label": "Eng", "value": "eng" } ] }
  ]
}
```
- Each field's variable name is its **`key`** (binds to a process variable).
- `executionPlatform` MUST be `"Camunda Platform"` (not `"Camunda Cloud"`, which
  is C8).
- Common `type`s: `textfield`, `textarea`, `number`, `checkbox`, `checklist`,
  `radio`, `select`, `taglist`, `datetime`, `text` (static), `filepicker`.
  `validate`: `required`, `min`/`max`, `minLength`/`maxLength`, `pattern`.
  Dynamic options: `valuesExpression: "${...}"`.

### 2. Generated form data (engine renders fields from the model)
```xml
<bpmn:userTask id="t" name="Apply">
  <bpmn:extensionElements>
    <camunda:formData>
      <camunda:formField id="firstName" label="First name" type="string">
        <camunda:validation><camunda:constraint name="required" config="true" /></camunda:validation>
      </camunda:formField>
      <camunda:formField id="amount" label="Amount" type="long" defaultValue="0">
        <camunda:validation>
          <camunda:constraint name="min" config="0" />
          <camunda:constraint name="max" config="10000" />
        </camunda:validation>
      </camunda:formField>
      <camunda:formField id="decision" label="Decision" type="enum">
        <camunda:value id="approve" name="Approve" />
        <camunda:value id="reject"  name="Reject" />
      </camunda:formField>
    </camunda:formData>
  </bpmn:extensionElements>
</bpmn:userTask>
```
- `type` ∈ `string` | `long` | `boolean` | `date` | `enum` (+ custom).
- Constraint `name`s: `required`, `readonly`, `minlength`, `maxlength`, `min`,
  `max`, `validator` (FQN of a `FormFieldValidator`).

### 3. Form key (HTML or external UI)
```xml
<bpmn:userTask id="t" camunda:formKey="embedded:app:forms/approve.html" />
```
The scheme differs by form type — `.form` (Camunda Form) and `.html` (embedded)
are NOT interchangeable:

- **Camunda Form (`.form` JSON)** — `camunda-forms:` scheme:
  - `camunda-forms:deployment:NAME.form` — deployed alongside the process *(recommended)*.
  - `camunda-forms:app:forms/NAME.form` — served from the webapp's resources.
- **Embedded HTML** — `embedded:` scheme:
  - `embedded:app:forms/NAME.html` — bundled in the Tasklist webapp.
  - `embedded:deployment:forms/NAME.html` — deployed with the process.
- **External** — `app:forms/NAME.html` (or any URL your own UI resolves).

Prefer `camunda-forms:deployment:NAME.form` for a deployed `.form`. (Usually you
reference a `.form` via `camunda:formRef` instead — see §1 — but `formKey` with the
`camunda-forms:` scheme works too.)

---

## DMN decisions (business rule task)

Wire the task (see `camunda-extensions.md` §10):
```xml
<bpmn:businessRuleTask id="decideDiscount"
    camunda:decisionRef="discount" camunda:decisionRefBinding="latest"
    camunda:mapDecisionResult="singleEntry" camunda:resultVariable="discount" />
```

Minimal valid DMN 1.3 decision table (`discount.dmn`). Note the **DMN-specific**
namespaces and that the `<decision>` needs its own `camunda:historyTimeToLive`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"
             xmlns:camunda="http://camunda.org/schema/1.0/dmn"
             xmlns:dmndi="https://www.omg.org/spec/DMN/20191111/DMNDI/"
             xmlns:dc="http://www.omg.org/spec/DMN/20180521/DC/"
             id="defs_discount" name="discount"
             namespace="http://camunda.org/schema/1.0/dmn">
  <decision id="discount" name="Discount" camunda:historyTimeToLive="P180D">
    <decisionTable id="dt" hitPolicy="UNIQUE">
      <input id="in_total" label="Order total">
        <inputExpression id="ie_total" typeRef="number"><text>total</text></inputExpression>
      </input>
      <output id="out_pct" label="Discount %" name="discount" typeRef="number" />
      <rule id="r1">
        <inputEntry id="ie1"><text>&lt; 100</text></inputEntry>
        <outputEntry id="oe1"><text>0</text></outputEntry>
      </rule>
      <rule id="r2">
        <inputEntry id="ie2"><text>&gt;= 100</text></inputEntry>
        <outputEntry id="oe2"><text>10</text></outputEntry>
      </rule>
    </decisionTable>
  </decision>
</definitions>
```
- `hitPolicy` ∈ `UNIQUE` (default) | `FIRST` | `PRIORITY` | `ANY` | `COLLECT`
  (optional aggregation) | `RULE ORDER` | `OUTPUT ORDER`.
- Rule cells are **FEEL**: `< 100`, `>= 100` (XML-escape `<`/`>`), string
  literals quoted (`"low"`), empty cell = "any".
- DMN decisions need HTTL since 7.20, same as processes.

### The `decisionResult` variable
The engine ALWAYS exposes the full decision result in the task's local scope as a
**transient** variable literally named `decisionResult` (a `DmnDecisionResult` ≈
`List<Map>` — one map per matched rule). Because that name is reserved,
`camunda:resultVariable` **MUST NOT** be `decisionResult` — the engine throws.

Map it yourself with output parameters (omit `mapDecisionResult`/`resultVariable`):
```xml
<bpmn:businessRuleTask id="decideDiscount" camunda:decisionRef="discount">
  <bpmn:extensionElements>
    <camunda:inputOutput>
      <camunda:outputParameter name="myResult">${decisionResult.singleEntry}</camunda:outputParameter>
    </camunda:inputOutput>
  </bpmn:extensionElements>
</bpmn:businessRuleTask>
```
Accessors on `decisionResult`: `.getSingleResult().get('col')` (one row → one
column), `.singleEntry` (single row + single column → the bare value),
`.collectEntries` (one column across all rows → a `List`).

> `camunda-tool.mjs` is a BPMN tool — it does not lay out or lint `.dmn` files.
> Generate the `.dmn` directly from the template; verify it opens in the Camunda
> Modeler. Keep the `decisionRef` on the task equal to the `<decision id>`.
