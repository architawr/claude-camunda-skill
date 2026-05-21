/** Phase 1 — Camunda execution-readiness lint rules (impl, timers, multi-instance). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proc, EXPR, lintMsgs } from './builders.mjs';

const wrap = (mid, extraFlows = '') => proc(`
  <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
  ${mid}
  <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
  <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/>${extraFlows}`);

test('ScriptTask without scriptFormat is an ERROR', async () => {
  const xml = wrap(`<bpmn:scriptTask id="T" name="Run"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:scriptTask>`);
  assert.match(await lintMsgs(xml), /ERROR Script task.*scriptFormat/);
});

test('CallActivity without calledElement is an ERROR', async () => {
  const xml = wrap(`<bpmn:callActivity id="T" name="Call"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:callActivity>`);
  assert.match(await lintMsgs(xml), /ERROR Call activity.*calledElement/);
});

test('ReceiveTask without messageRef is a WARN', async () => {
  const xml = wrap(`<bpmn:receiveTask id="T" name="Wait"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:receiveTask>`);
  assert.match(await lintMsgs(xml), /WARN Receive task.*messageRef/);
});

test('BusinessRuleTask with no implementation is an ERROR', async () => {
  const xml = wrap(`<bpmn:businessRuleTask id="T" name="Decide"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:businessRuleTask>`);
  assert.match(await lintMsgs(xml), /ERROR BusinessRuleTask.*no implementation/);
});

test('BusinessRuleTask wired to a DMN decisionRef is clean (negative)', async () => {
  const xml = wrap(`<bpmn:businessRuleTask id="T" name="Decide" camunda:decisionRef="riskDecision" camunda:resultVariable="risk" camunda:mapDecisionResult="singleEntry"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:businessRuleTask>`);
  assert.doesNotMatch(await lintMsgs(xml), /no implementation/);
});

test('Multi-instance with neither cardinality nor collection is an ERROR', async () => {
  const xml = wrap(`<bpmn:serviceTask id="T" camunda:delegateExpression="${EXPR('t')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:multiInstanceLoopCharacteristics/></bpmn:serviceTask>`);
  assert.match(await lintMsgs(xml), /ERROR Multi-instance.*neither loopCardinality nor a collection/);
});

test('Multi-instance with a camunda:collection is clean (negative)', async () => {
  const xml = wrap(`<bpmn:serviceTask id="T" camunda:delegateExpression="${EXPR('t')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:multiInstanceLoopCharacteristics camunda:collection="items" camunda:elementVariable="item"/></bpmn:serviceTask>`);
  assert.doesNotMatch(await lintMsgs(xml), /Multi-instance.*neither/);
});

test('Timer with no time spec is an ERROR', async () => {
  const xml = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:timerEventDefinition/></bpmn:intermediateCatchEvent>`);
  assert.match(await lintMsgs(xml), /ERROR Timer event.*no timeDate\/timeDuration\/timeCycle/);
});

test('Timer timeDate that is not ISO-8601 is an ERROR', async () => {
  const xml = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeDate>tomorrow</bpmn:timeDate></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`);
  assert.match(await lintMsgs(xml), /ERROR Timer event.*not an ISO-8601 datetime/);
});

test('Timer timeCycle that is neither interval nor cron is an ERROR', async () => {
  const xml = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeCycle>every hour</bpmn:timeCycle></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`);
  assert.match(await lintMsgs(xml), /ERROR Timer event.*not a repeating interval/);
});

test('Timer whose value is a JUEL expression passes (negative)', async () => {
  const xml = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeDuration>${EXPR('dur')}</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`);
  assert.doesNotMatch(await lintMsgs(xml), /Timer event/);
});

test('Timer timeCycle as an R-interval or a 6-field cron passes (negative)', async () => {
  const interval = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeCycle>R5/PT10M</bpmn:timeCycle></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`);
  assert.doesNotMatch(await lintMsgs(interval), /Timer event/);
  const cron = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeCycle>0 0 12 * * ?</bpmn:timeCycle></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>`);
  assert.doesNotMatch(await lintMsgs(cron), /Timer event/);
});
