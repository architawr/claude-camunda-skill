package org.acme.delegate;

import org.camunda.bpm.engine.delegate.DelegateExecution;
import org.camunda.bpm.engine.delegate.JavaDelegate;
import org.springframework.stereotype.Component;

/**
 * Wired from BPMN via camunda:delegateExpression="${doWork}".
 * For camunda:class, remove @Component and reference the fully-qualified name.
 */
@Component("doWork")
public class DoWorkDelegate implements JavaDelegate {

    @Override
    public void execute(DelegateExecution execution) {
        // 1. read input variables
        // String orderId = (String) execution.getVariable("orderId");

        // 2. do the work
        // ...

        // 3. write output variables
        // execution.setVariable("result", result);

        // To raise a business error caught by a boundary error event:
        // throw new org.camunda.bpm.engine.delegate.BpmnError("ERROR_CODE", "message");
    }
}
