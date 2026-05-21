# To build — <process name>

Follow-up spec for the **new** building blocks referenced by `<process>.bpmn`:
stub **activities** (deployable today as external topics / placeholder delegates)
and stub **forms** (referenced by `camunda:formRef` but not created yet). Things
wired from the catalog are NOT listed here.

## Activities to implement

### <Activity name>
- **BPMN node:** `<nodeId>` (<external task, topic `<topic>`> | <delegate `${bean}`>)
- **Purpose:** <one line: what this step does in the process>
- **Inputs:** `<name>` (<Type>), … — sourced from process variables `${…}`
- **Outputs:** `<name>` (<Type>) — written back to the process
- **Errors:** may throw BPMN error `<ERROR_CODE>` when <condition>
- **Implementation:** <external-task worker on topic `<topic>` | JavaDelegate `<bean>`>, per the catalog convention

<!-- repeat per stubbed activity -->

## Forms to create

### <Form name> (`<formId>`)
- **User task:** `<nodeId>` ("<task name>")
- **Referenced by:** `camunda:formRef="<formId>"`
- **Fields:**
  | key | label | type | required |
  |-----|-------|------|----------|
  | `<key>` | <Label> | <textfield/number/checkbox/select/…> | yes/no |
- **Notes:** <which process variables the fields read/write>

<!-- repeat per form-stub -->

## Checklist
- [ ] activity: <name> — `<topic-or-bean>`
- [ ] form: <name> — `<formId>`
