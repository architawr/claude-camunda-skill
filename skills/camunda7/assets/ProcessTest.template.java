package org.acme;

import org.camunda.bpm.engine.test.Deployment;
import org.camunda.bpm.engine.test.junit5.ProcessEngineExtension;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.camunda.bpm.engine.test.assertions.bpmn.BpmnAwareTests.*;

/**
 * JUnit 5 + camunda-bpm-assert. Deps: camunda-bpm-junit5, camunda-bpm-assert,
 * junit-jupiter, H2. @Deployment deploys before each test and cleans up after.
 */
@ExtendWith(ProcessEngineExtension.class)
class MyProcessTest {

    @Test
    @Deployment(resources = "myProcess.bpmn")
    void happyPath() {
        var pi = runtimeService().startProcessInstanceByKey(
                "myProcess", withVariables("amount", 1000));

        assertThat(pi).isWaitingAt("Review");   // a user task id
        complete(task());
        assertThat(pi).isEnded();
    }
}
