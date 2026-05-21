/** Phase 1 — control-flow lint rules (gateway families, defaults, conditions). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proc, EXPR, lintMsgs, sev } from './builders.mjs';

const D = EXPR('a'), D2 = EXPR('b');

test('DEADLOCK: XOR split merged by an AND join (ERROR)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="SP" default="x"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>x</bpmn:outgoing><bpmn:outgoing>y</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${D}"><bpmn:incoming>x</bpmn:incoming><bpmn:outgoing>xa</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="B" camunda:delegateExpression="${D2}"><bpmn:incoming>y</bpmn:incoming><bpmn:outgoing>yb</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:parallelGateway id="J"><bpmn:incoming>xa</bpmn:incoming><bpmn:incoming>yb</bpmn:incoming><bpmn:outgoing>z</bpmn:outgoing></bpmn:parallelGateway>
    <bpmn:endEvent id="E"><bpmn:incoming>z</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="SP"/><bpmn:sequenceFlow id="x" sourceRef="SP" targetRef="A"/><bpmn:sequenceFlow id="y" sourceRef="SP" targetRef="B"/>
    <bpmn:sequenceFlow id="xa" sourceRef="A" targetRef="J"/><bpmn:sequenceFlow id="yb" sourceRef="B" targetRef="J"/><bpmn:sequenceFlow id="z" sourceRef="J" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /ERROR DEADLOCK/);
});

test('NO DEFAULT: every outgoing flow conditioned, no default (WARN)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="G"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>x</bpmn:outgoing><bpmn:outgoing>y</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="E1"><bpmn:incoming>x</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>y</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="G"/>
    <bpmn:sequenceFlow id="x" sourceRef="G" targetRef="E1"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${EXPR('ok')}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="y" sourceRef="G" targetRef="E2"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${EXPR('!ok')}</bpmn:conditionExpression></bpmn:sequenceFlow>`);
  assert.match(await lintMsgs(xml), /WARN NO DEFAULT/);
});

test('IGNORED CONDITION: conditions on a parallel gateway (WARN)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:parallelGateway id="PG"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>x</bpmn:outgoing><bpmn:outgoing>y</bpmn:outgoing></bpmn:parallelGateway>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${D}"><bpmn:incoming>x</bpmn:incoming><bpmn:outgoing>xa</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="B" camunda:delegateExpression="${D2}"><bpmn:incoming>y</bpmn:incoming><bpmn:outgoing>yb</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:parallelGateway id="J"><bpmn:incoming>xa</bpmn:incoming><bpmn:incoming>yb</bpmn:incoming><bpmn:outgoing>z</bpmn:outgoing></bpmn:parallelGateway>
    <bpmn:endEvent id="E"><bpmn:incoming>z</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="PG"/>
    <bpmn:sequenceFlow id="x" sourceRef="PG" targetRef="A"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${EXPR('p')}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="y" sourceRef="PG" targetRef="B"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${EXPR('q')}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="xa" sourceRef="A" targetRef="J"/><bpmn:sequenceFlow id="yb" sourceRef="B" targetRef="J"/><bpmn:sequenceFlow id="z" sourceRef="J" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /WARN IGNORED CONDITION/);
});

test('DEFAULT WITH CONDITION: a default flow that also carries a condition (WARN)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="G" default="x"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>x</bpmn:outgoing><bpmn:outgoing>y</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="E1"><bpmn:incoming>x</bpmn:incoming></bpmn:endEvent>
    <bpmn:endEvent id="E2"><bpmn:incoming>y</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="G"/>
    <bpmn:sequenceFlow id="x" sourceRef="G" targetRef="E1"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${EXPR('ok')}</bpmn:conditionExpression></bpmn:sequenceFlow>
    <bpmn:sequenceFlow id="y" sourceRef="G" targetRef="E2"/>`);
  assert.match(await lintMsgs(xml), /WARN DEFAULT WITH CONDITION/);
});

test('CONDITIONAL FLOW STUCK: a conditioned single flow off a non-gateway (A5, WARN)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" camunda:delegateExpression="${D}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/>
    <bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"><bpmn:conditionExpression xsi:type="bpmn:tFormalExpression">${EXPR('ok')}</bpmn:conditionExpression></bpmn:sequenceFlow>`);
  assert.match(await lintMsgs(xml), /WARN CONDITIONAL FLOW STUCK/);
});

// --- negatives: sound flows must NOT trip these rules ---

test('negative: a sound XOR split / XOR join raises no deadlock or duplication', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:exclusiveGateway id="SP" default="x"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>x</bpmn:outgoing><bpmn:outgoing>y</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${D}"><bpmn:incoming>x</bpmn:incoming><bpmn:outgoing>xa</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="B" camunda:delegateExpression="${D2}"><bpmn:incoming>y</bpmn:incoming><bpmn:outgoing>yb</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:exclusiveGateway id="J"><bpmn:incoming>xa</bpmn:incoming><bpmn:incoming>yb</bpmn:incoming><bpmn:outgoing>z</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="E"><bpmn:incoming>z</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="SP"/><bpmn:sequenceFlow id="x" sourceRef="SP" targetRef="A"/><bpmn:sequenceFlow id="y" sourceRef="SP" targetRef="B"/>
    <bpmn:sequenceFlow id="xa" sourceRef="A" targetRef="J"/><bpmn:sequenceFlow id="yb" sourceRef="B" targetRef="J"/><bpmn:sequenceFlow id="z" sourceRef="J" targetRef="E"/>`);
  const m = await lintMsgs(xml);
  assert.doesNotMatch(m, /DEADLOCK/);
  assert.doesNotMatch(m, /TOKEN DUPLICATION/);
  assert.equal((await sev(xml, 'ERROR')).length, 0);
});

test('negative: a single unconditioned flow does not trip CONDITIONAL FLOW STUCK', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" camunda:delegateExpression="${D}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/>`);
  assert.doesNotMatch(await lintMsgs(xml), /CONDITIONAL FLOW STUCK/);
});
