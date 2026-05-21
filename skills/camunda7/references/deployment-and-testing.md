# Deploying & testing a Camunda 7 process

## Deploy via REST (`/engine-rest`)

Deploy resources (one `-F` part per `.bpmn`/`.dmn`/`.form`/`.html`):
```bash
curl -w "\n" -H "Accept: application/json" \
  -F "deployment-name=my-deployment" \
  -F "enable-duplicate-filtering=true" \
  -F "deploy-changed-only=true" \
  -F "process.bpmn=@process.bpmn" \
  -F "discount.dmn=@discount.dmn" \
  http://localhost:8080/engine-rest/deployment/create
```

Start an instance by process key:
```bash
curl -H "Content-Type: application/json" \
  -d '{"variables":{"amount":{"value":1000,"type":"Integer"}},"businessKey":"ORDER-42"}' \
  http://localhost:8080/engine-rest/process-definition/key/myProcess/start
```

## Spring Boot

- Starter: `org.camunda.bpm.springboot:camunda-bpm-spring-boot-starter`
  (`-rest` adds REST, `-webapp` adds Cockpit/Tasklist/Admin,
  `-external-task-client` for workers).
- **Auto-deployment is on by default**: every `*.bpmn`/`*.dmn`/`*.form`/`*.cmmn`
  under `src/main/resources/**` deploys at startup.
- `application.yaml`:
```yaml
camunda.bpm:
  history-level: full            # none | activity | audit | full
  admin-user: { id: demo, password: demo }
  generic-properties:
    properties:
      historyTimeToLive: P30D            # engine-wide default HTTL (avoids 7.20 deploy error)
      enforceHistoryTimeToLive: true     # false = allow null HTTL (keep history forever)
```

## Camunda Modeler

The desktop **Camunda Modeler** is the authoring/inspection tool — set execution
platform **"Camunda Platform 7"** (so it offers `camunda:` props, not `zeebe:`),
and it can deploy `.bpmn`/`.dmn`/`.form` to a running engine over REST.

## Tests (JUnit 5 + camunda-bpm-assert)

Deps: `camunda-bpm-junit5`, `camunda-bpm-assert`, `junit-jupiter`, an in-memory
DB (H2). Optionally `camunda-process-test-coverage` for coverage reports.

```java
import org.camunda.bpm.engine.test.Deployment;
import org.camunda.bpm.engine.test.junit5.ProcessEngineExtension;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.camunda.bpm.engine.test.assertions.bpmn.BpmnAwareTests.*;

@ExtendWith(ProcessEngineExtension.class)
class MyProcessTest {

  @Test
  @Deployment(resources = "myProcess.bpmn")
  void happyPath() {
    var pi = runtimeService().startProcessInstanceByKey(
        "myProcess", withVariables("amount", 1000));

    assertThat(pi).isWaitingAt("approve");   // a user task
    complete(task());                        // complete it
    assertThat(pi).isWaitingAt("registerLeave");
    complete(task());
    assertThat(pi).isEnded();
  }
}
```

Useful assertions/helpers: `assertThat(pi).isWaitingAt("id")`, `.hasPassed("id")`,
`.isEnded()`, `.hasVariables(...)`; `task()`, `complete(task())`,
`job()`, `execute(job())` (fire async/timer jobs), `runtimeService()`,
`taskService()`. `@Deployment` deploys before the test and cleans up after.

> Version note: `camunda-bpm-assert` (~12.x/15.x) and `camunda-bpm-junit5` (~1.x)
> drift — pin against current Maven Central. The API shape above is stable.
