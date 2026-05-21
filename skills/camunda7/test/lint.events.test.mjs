/** Phase 1 — event-definition lint rules (message/signal/error/escalation/conditional). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proc, procRoots, EXPR, lintMsgs } from './builders.mjs';

// start -> T(the event under test) -> end
const wrap = (mid) => proc(`
  <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
  ${mid}
  <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
  <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/>`);

test('Message catch event without messageRef is a WARN', async () => {
  const xml = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:messageEventDefinition/></bpmn:intermediateCatchEvent>`);
  assert.match(await lintMsgs(xml), /WARN Message catch event.*messageRef/);
});

test('Message throw event without messageRef is an INFO (no-op throw in C7)', async () => {
  const xml = wrap(`<bpmn:intermediateThrowEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:messageEventDefinition/></bpmn:intermediateThrowEvent>`);
  assert.match(await lintMsgs(xml), /INFO Message throw event.*messageRef/);
});

test('Signal event without signalRef is a WARN', async () => {
  const xml = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:signalEventDefinition/></bpmn:intermediateCatchEvent>`);
  assert.match(await lintMsgs(xml), /WARN Signal event.*signalRef/);
});

test('Conditional event without a condition is a WARN', async () => {
  const xml = wrap(`<bpmn:intermediateCatchEvent id="T"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:conditionalEventDefinition/></bpmn:intermediateCatchEvent>`);
  assert.match(await lintMsgs(xml), /WARN Conditional event.*condition/);
});

test('Error throw (end) event without errorRef is an ERROR', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" camunda:delegateExpression="${EXPR('t')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="EE"><bpmn:incoming>b</bpmn:incoming><bpmn:errorEventDefinition/></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="EE"/>`);
  assert.match(await lintMsgs(xml), /ERROR Error throw event.*errorRef/);
});

test('An error referenced without an errorCode is a WARN', async () => {
  const xml = procRoots(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" camunda:delegateExpression="${EXPR('t')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:boundaryEvent id="BE" attachedToRef="T"><bpmn:outgoing>c</bpmn:outgoing><bpmn:errorEventDefinition errorRef="err1"/></bpmn:boundaryEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/><bpmn:sequenceFlow id="c" sourceRef="BE" targetRef="E2"/>`,
    `<bpmn:error id="err1" name="My error"/>`);
  assert.match(await lintMsgs(xml), /WARN Error.*no errorCode/);
});

test('A declared escalation on a non-interrupting boundary is clean (negative)', async () => {
  const xml = procRoots(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="T" name="Approve" camunda:candidateGroups="g" camunda:formRef="f"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:boundaryEvent id="BE" cancelActivity="false" attachedToRef="T"><bpmn:outgoing>c</bpmn:outgoing><bpmn:escalationEventDefinition escalationRef="esc1"/></bpmn:boundaryEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/><bpmn:sequenceFlow id="c" sourceRef="BE" targetRef="E2"/>`,
    `<bpmn:escalation id="esc1" name="Overdue" escalationCode="OVERDUE"/>`);
  assert.doesNotMatch(await lintMsgs(xml), /escalation not declared/);
});
