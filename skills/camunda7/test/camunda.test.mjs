/**
 * Tests for the camunda7 lib. Run: `npm test` (from skills/camunda7).
 * They assert the Camunda-specific behaviour on top of the ported bpmn engine:
 * extension preservation through layout, collaboration layout, resync, the
 * execution lint, structural lint, stub recursion, summarize, diff, find.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  layoutModel, validateModel, lintModel, summarizeJson, diffModels, findModel,
} from '../scripts/lib.mjs';
import { defs, proc, CLEAN, lintMsgs, sev } from './builders.mjs';

test('layout preserves camunda: extensions and produces valid DI', async () => {
  const out = await layoutModel(CLEAN, { rebuild: true });
  assert.match(out, /camunda:delegateExpression/);
  assert.match(out, /camunda:candidateGroups/);
  assert.match(out, /camunda:formRef/);
  assert.match(out, /camunda:historyTimeToLive/);
  assert.match(out, /BPMNShape/);
  const v = await validateModel(out);
  assert.equal(v.ok, true, JSON.stringify(v));
});

test('layout is non-destructive on a file that already has DI (resync)', async () => {
  const once = await layoutModel(CLEAN, { rebuild: true });
  const twice = await layoutModel(once); // no rebuild
  assert.match(twice, /camunda:delegateExpression/);
  assert.equal((await validateModel(twice)).ok, true);
});

test('lint is clean on a fully-wired process', async () => {
  assert.equal((await sev(CLEAN, 'ERROR')).length, 0);
  assert.equal((await sev(CLEAN, 'WARN')).length, 0);
});

test('collaboration: both pools are laid out and extensions survive', async () => {
  const xml = defs(
    `<bpmn:collaboration id="C">
       <bpmn:participant id="PA" name="A" processRef="PrA"/>
       <bpmn:participant id="PB" name="B" processRef="PrB"/>
       <bpmn:messageFlow id="mf" sourceRef="TA" targetRef="TB"/>
     </bpmn:collaboration>
     <bpmn:process id="PrA" isExecutable="true" camunda:historyTimeToLive="P30D">
       <bpmn:startEvent id="SA"><bpmn:outgoing>a1</bpmn:outgoing></bpmn:startEvent>
       <bpmn:serviceTask id="TA" camunda:delegateExpression="${'${send}'}"><bpmn:incoming>a1</bpmn:incoming><bpmn:outgoing>a2</bpmn:outgoing></bpmn:serviceTask>
       <bpmn:endEvent id="EA"><bpmn:incoming>a2</bpmn:incoming></bpmn:endEvent>
       <bpmn:sequenceFlow id="a1" sourceRef="SA" targetRef="TA"/><bpmn:sequenceFlow id="a2" sourceRef="TA" targetRef="EA"/>
     </bpmn:process>
     <bpmn:process id="PrB" isExecutable="true" camunda:historyTimeToLive="P30D">
       <bpmn:startEvent id="SB"><bpmn:outgoing>b1</bpmn:outgoing></bpmn:startEvent>
       <bpmn:serviceTask id="TB" camunda:type="external" camunda:topic="recv"><bpmn:incoming>b1</bpmn:incoming><bpmn:outgoing>b2</bpmn:outgoing></bpmn:serviceTask>
       <bpmn:endEvent id="EB"><bpmn:incoming>b2</bpmn:incoming></bpmn:endEvent>
       <bpmn:sequenceFlow id="b1" sourceRef="SB" targetRef="TB"/><bpmn:sequenceFlow id="b2" sourceRef="TB" targetRef="EB"/>
     </bpmn:process>`);
  const out = await layoutModel(xml, { rebuild: true });
  assert.match(out, /bpmnElement="PA"/);
  assert.match(out, /bpmnElement="PB"/);
  assert.match(out, /bpmnElement="TA"/);
  assert.match(out, /bpmnElement="TB"/);
  assert.match(out, /camunda:topic="recv"/);
  assert.equal((await validateModel(out)).ok, true, JSON.stringify(await validateModel(out)));
});

test('execution lint: service task with no implementation is an ERROR', async () => {
  const xml = proc(`<bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" name="X"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /ERROR .*no implementation/);
});

test('execution lint: external task without topic is an ERROR', async () => {
  const xml = proc(`<bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" camunda:type="external"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /ERROR .*no camunda:topic/);
});

test('execution lint: missing historyTimeToLive is a WARN; bad value is a WARN', async () => {
  const noHttl = proc(`<bpmn:startEvent id="S"/>`, 'isExecutable="true"');
  assert.match(await lintMsgs(noHttl), /WARN .*historyTimeToLive/);
  const badHttl = proc(`<bpmn:startEvent id="S"/>`, 'isExecutable="true" camunda:historyTimeToLive="PT1H"');
  assert.match(await lintMsgs(badHttl), /WARN .*not day-based/);
});

test('execution lint: malformed timer is an ERROR', async () => {
  const xml = proc(`<bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="W"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing><bpmn:timerEventDefinition><bpmn:timeDuration>2 days</bpmn:timeDuration></bpmn:timerEventDefinition></bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="W"/><bpmn:sequenceFlow id="b" sourceRef="W" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /ERROR Timer event.*ISO-8601 duration/);
});

test('execution lint: zeebe attributes are an ERROR (wrong engine)', async () => {
  const xml = `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:zeebe="http://camunda.org/schema/zeebe/1.0" id="d" targetNamespace="t"><bpmn:process id="p" isExecutable="true" camunda:historyTimeToLive="P30D" xmlns:camunda="http://camunda.org/schema/1.0/bpmn"><bpmn:startEvent id="S"/></bpmn:process></bpmn:definitions>`;
  assert.match(await lintMsgs(xml), /ERROR .*[Zz]eebe/);
});

test('structural lint: missing start event and dead end (A3)', async () => {
  const xml = proc(`<bpmn:serviceTask id="T" camunda:delegateExpression="${'${x}'}"/>`);
  const m = await lintMsgs(xml);
  assert.match(m, /NO START/);
  assert.match(m, /DEAD END|NO END/);
});

test('control-flow lint: AND-split / XOR-join token duplication (ERROR)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:parallelGateway id="SP"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>x</bpmn:outgoing><bpmn:outgoing>y</bpmn:outgoing></bpmn:parallelGateway>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${'${a}'}"><bpmn:incoming>x</bpmn:incoming><bpmn:outgoing>xa</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="B" camunda:delegateExpression="${'${b}'}"><bpmn:incoming>y</bpmn:incoming><bpmn:outgoing>yb</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:exclusiveGateway id="J"><bpmn:incoming>xa</bpmn:incoming><bpmn:incoming>yb</bpmn:incoming><bpmn:outgoing>z</bpmn:outgoing></bpmn:exclusiveGateway>
    <bpmn:endEvent id="E"><bpmn:incoming>z</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="SP"/><bpmn:sequenceFlow id="x" sourceRef="SP" targetRef="A"/><bpmn:sequenceFlow id="y" sourceRef="SP" targetRef="B"/>
    <bpmn:sequenceFlow id="xa" sourceRef="A" targetRef="J"/><bpmn:sequenceFlow id="yb" sourceRef="B" targetRef="J"/><bpmn:sequenceFlow id="z" sourceRef="J" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /ERROR TOKEN DUPLICATION/);
});

test('lint surfaces parse warnings such as duplicate ids (A2)', async () => {
  const xml = proc(`<bpmn:startEvent id="DUP"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="DUP" camunda:delegateExpression="${'${x}'}"><bpmn:incoming>a</bpmn:incoming></bpmn:serviceTask>`);
  assert.match(await lintMsgs(xml), /ERROR PARSE/);
});

test('stub listing recurses into sub-processes (A4)', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Sub"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing>
      <bpmn:startEvent id="ss"><bpmn:outgoing>i</bpmn:outgoing></bpmn:startEvent>
      <bpmn:serviceTask id="NestedStub" name="Nested stub" camunda:type="external" camunda:topic="ns">
        <bpmn:extensionElements><camunda:properties><camunda:property name="stub" value="true"/></camunda:properties></bpmn:extensionElements>
        <bpmn:incoming>i</bpmn:incoming><bpmn:outgoing>j</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:endEvent id="se"><bpmn:incoming>j</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="i" sourceRef="ss" targetRef="NestedStub"/><bpmn:sequenceFlow id="j" sourceRef="NestedStub" targetRef="se"/>
    </bpmn:subProcess>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="Sub"/><bpmn:sequenceFlow id="b" sourceRef="Sub" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /INFO Stub activity.*Nested stub/);
});

test('user task without a form is a WARN', async () => {
  const xml = proc(`<bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:userTask id="U" camunda:candidateGroups="g"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:userTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="U"/><bpmn:sequenceFlow id="b" sourceRef="U" targetRef="E"/>`);
  assert.match(await lintMsgs(xml), /WARN User task.*no form/);
});

test('summarize --json exposes implementation and stub markers', async () => {
  const s = await summarizeJson(CLEAN);
  const p = s.processes[0];
  assert.equal(p.executable, true);
  assert.equal(p.historyTimeToLive, 'P30D');
  const svc = p.activities.find((a) => a.id === 'Svc');
  assert.match(svc.impl, /delegateExpression/);
});

test('diff reports implementation changes', async () => {
  const a = proc(`<bpmn:serviceTask id="T" camunda:type="external" camunda:topic="t1"/>`);
  const b = proc(`<bpmn:serviceTask id="T" camunda:delegateExpression="${'${bean}'}"/>`);
  const d = await diffModels(a, b);
  assert.equal(d.implChanged.length, 1);
  assert.match(d.implChanged[0].to, /delegateExpression/);
});

test('find matches by name/type', async () => {
  const hits = await findModel(CLEAN, 'review');
  assert.ok(hits.some((h) => h.id === 'U'));
});

test('layout fails loudly on an empty process (A6)', async () => {
  await assert.rejects(() => layoutModel(proc('')), /nothing to lay out/);
});
