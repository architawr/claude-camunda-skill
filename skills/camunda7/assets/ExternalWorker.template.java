package org.acme.worker;

import org.camunda.bpm.client.spring.annotation.ExternalTaskSubscription;
import org.camunda.bpm.client.task.ExternalTaskHandler;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.Map;

/**
 * Handles a service task with camunda:type="external" camunda:topic="myTopic".
 * Needs camunda-bpm-spring-boot-starter-external-task-client on the classpath.
 */
@Configuration
public class MyTopicWorker {

    @Bean
    @ExternalTaskSubscription("myTopic")          // == camunda:topic
    public ExternalTaskHandler myTopicHandler() {
        return (task, service) -> {
            // 1. read variables
            // String orderId = task.getVariable("orderId");

            // 2. do the work
            // ...

            // 3. complete with output variables
            service.complete(task, Map.of(/* "result", result */));

            // On technical failure (with retries):
            // service.handleFailure(task, "error", "details", 3, 60_000);
            // On business error:
            // service.handleBpmnError(task, "ERROR_CODE", "message");
        };
    }
}
