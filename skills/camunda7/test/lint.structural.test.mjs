/** Phase 1 — structural, collaboration, and advisory lint rules. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defs, proc, EXPR, lintMsgs } from './builders.mjs';

const D = EXPR('t');

test('UNREACHABLE: a node with no path from a start event (WARN)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${D}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:serviceTask id="Orphan" camunda:delegateExpression="${EXPR('o')}"><bpmn:outgoing>c</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E2"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="A"/><bpmn:sequenceFlow id="b" sourceRef="A" targetRef="E"/>
    <bpmn:sequenceFlow id="c" sourceRef="Orphan" targetRef="E2"/>`);
  assert.match(await lintMsgs(xml), /UNREACHABLE/);
});

test('IMPLICIT SPLIT: a non-gateway node with two outgoing flows (WARN)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" camunda:delegateExpression="${D}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>x</bpmn:outgoing><bpmn:outgoing>y</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E1"><bpmn:incoming>x</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>y</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="x" sourceRef="T" targetRef="E1"/><bpmn:sequenceFlow id="y" sourceRef="T" targetRef="E2"/>`);
  assert.match(await lintMsgs(xml), /IMPLICIT SPLIT/);
});

test('MISDIRECTED EVENT: an end event with an outgoing flow (WARN)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:endEvent id="E"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:endEvent>
    <bpmn:serviceTask id="T" camunda:delegateExpression="${D}"><bpmn:incoming>b</bpmn:incoming><bpmn:outgoing>c</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E2"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="E"/><bpmn:sequenceFlow id="b" sourceRef="E" targetRef="T"/><bpmn:sequenceFlow id="c" sourceRef="T" targetRef="E2"/>`);
  assert.match(await lintMsgs(xml), /MISDIRECTED EVENT/);
});

test('BAD BOUNDARY: a boundary event attached to a gateway, not an activity (WARN)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="G" default="x"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>x</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:boundaryEvent id="BE" attachedToRef="G"><bpmn:outgoing>y</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeDuration>PT1H</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:boundaryEvent>
    <bpmn:endEvent id="E"><bpmn:incoming>x</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>y</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="G"/><bpmn:sequenceFlow id="x" sourceRef="G" targetRef="E"/><bpmn:sequenceFlow id="y" sourceRef="BE" targetRef="E2"/>`);
  assert.match(await lintMsgs(xml), /BAD BOUNDARY/);
});

test('UNASSIGNED NODE: a node in no lane when the process uses lanes (WARN)', async () => {
  const xml = proc(`
    <bpmn:laneSet id="ls"><bpmn:lane id="L1" name="Lane 1"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane></bpmn:laneSet>
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" camunda:delegateExpression="${D}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /UNASSIGNED NODE/);
});

test('INTERNAL MESSAGE FLOW: a message flow within one pool (WARN)', async () => {
  const xml = defs(
    `<bpmn:collaboration id="C">
       <bpmn:participant id="PA" name="A" processRef="PrA"/>
       <bpmn:messageFlow id="mf" sourceRef="TA" targetRef="TA2"/>
     </bpmn:collaboration>
     <bpmn:process id="PrA" isExecutable="true" camunda:historyTimeToLive="P30D">
       <bpmn:startEvent id="SA"><bpmn:outgoing>a1</bpmn:outgoing></bpmn:startEvent>
       <bpmn:serviceTask id="TA" camunda:delegateExpression="${EXPR('x')}"><bpmn:incoming>a1</bpmn:incoming><bpmn:outgoing>a2</bpmn:outgoing></bpmn:serviceTask>
       <bpmn:serviceTask id="TA2" camunda:delegateExpression="${EXPR('y')}"><bpmn:incoming>a2</bpmn:incoming><bpmn:outgoing>a3</bpmn:outgoing></bpmn:serviceTask>
       <bpmn:endEvent id="EA"><bpmn:incoming>a3</bpmn:incoming></bpmn:endEvent>
       <bpmn:sequenceFlow id="a1" sourceRef="SA" targetRef="TA"/><bpmn:sequenceFlow id="a2" sourceRef="TA" targetRef="TA2"/><bpmn:sequenceFlow id="a3" sourceRef="TA2" targetRef="EA"/>
     </bpmn:process>`);
  assert.match(await lintMsgs(xml), /INTERNAL MESSAGE FLOW/);
});

test('No process is isExecutable is a WARN', async () => {
  const xml = proc(`<bpmn:startEvent id="S"/>`, 'isExecutable="false"');
  assert.match(await lintMsgs(xml), /No process has isExecutable/);
});

test('Form-stub user task is listed as INFO', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="U" name="Approve" camunda:candidateGroups="g" camunda:formRef="missingForm">
      <bpmn:extensionElements><camunda:properties><camunda:property name="formStub" value="true"/></camunda:properties></bpmn:extensionElements>
      <bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="U"/><bpmn:sequenceFlow id="b" sourceRef="U" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /INFO Form stub/);
});

test('async advice: two service tasks with no async boundary is an INFO; one task is silent', async () => {
  const two = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${EXPR('a')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="B" camunda:delegateExpression="${EXPR('b')}"><bpmn:incoming>b</bpmn:incoming><bpmn:outgoing>c</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="A"/><bpmn:sequenceFlow id="b" sourceRef="A" targetRef="B"/><bpmn:sequenceFlow id="c" sourceRef="B" targetRef="E"/>`);
  assert.match(await lintMsgs(two), /INFO No async boundaries/);
  const one = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${EXPR('a')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="A"/><bpmn:sequenceFlow id="b" sourceRef="A" targetRef="E"/>`);
  assert.doesNotMatch(await lintMsgs(one), /No async boundaries/);
});
