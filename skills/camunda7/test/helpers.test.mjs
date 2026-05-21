/** Phase 3 — pure helpers: implOf branches, stub conventions, cam, diff kinds, summarizeText. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  summarizeJson, summarizeText, diffModels, parseBpmn, cam, camBool, shortType,
} from '../scripts/lib.mjs';
import { defs, proc, EXPR } from './builders.mjs';

const findActivity = (s, id) => s.processes[0].activities.find((a) => a.id === id);

test('implOf covers every implementation branch', async () => {
  const xml = proc(`
    <bpmn:serviceTask id="ext" camunda:type="external" camunda:topic="t"/>
    <bpmn:serviceTask id="del" camunda:delegateExpression="${EXPR('bean')}"/>
    <bpmn:serviceTask id="cls" camunda:class="com.acme.Foo"/>
    <bpmn:serviceTask id="exprT" camunda:expression="${EXPR('bean.run()')}" camunda:resultVariable="r"/>
    <bpmn:serviceTask id="noimpl"/>
    <bpmn:businessRuleTask id="dmn" camunda:decisionRef="dec" camunda:resultVariable="out" camunda:mapDecisionResult="singleEntry"/>
    <bpmn:scriptTask id="scr" scriptFormat="groovy"><bpmn:script>x</bpmn:script></bpmn:scriptTask>
    <bpmn:callActivity id="call" calledElement="otherProc"/>
    <bpmn:userTask id="ut" camunda:assignee="bob" camunda:formKey="embedded:app:f.html"/>
    <bpmn:sendTask id="snd" camunda:type="external" camunda:topic="st"/>`);
  const s = await summarizeJson(xml);
  assert.equal(findActivity(s, 'ext').impl, 'external topic=t');
  assert.equal(findActivity(s, 'del').impl, 'delegateExpression=${bean}');
  assert.equal(findActivity(s, 'cls').impl, 'class=com.acme.Foo');
  assert.equal(findActivity(s, 'exprT').impl, 'expression=${bean.run()} -> r');
  assert.equal(findActivity(s, 'noimpl').impl, '(no implementation)');
  assert.equal(findActivity(s, 'dmn').impl, 'DMN decisionRef=dec (singleEntry) -> out');
  assert.equal(findActivity(s, 'scr').impl, 'script (groovy)');
  assert.equal(findActivity(s, 'call').impl, 'calledElement=otherProc');
  assert.match(findActivity(s, 'ut').impl, /assignee=bob/);
  assert.match(findActivity(s, 'ut').impl, /formKey=embedded:app:f\.html/);
  assert.equal(findActivity(s, 'snd').impl, 'external topic=st');
});

test('isStub / isFormStub honour the documentation convention (not just the property)', async () => {
  const xml = proc(`
    <bpmn:serviceTask id="st" name="Stubbed" camunda:type="external" camunda:topic="t"><bpmn:documentation>STUB: build later. Inputs: x. Outputs: y.</bpmn:documentation></bpmn:serviceTask>
    <bpmn:userTask id="fs" name="Form" camunda:formRef="missing"><bpmn:documentation>FORM STUB: design the approval form.</bpmn:documentation></bpmn:userTask>`);
  const s = await summarizeJson(xml);
  assert.equal(findActivity(s, 'st').stub, true);
  assert.equal(findActivity(s, 'fs').formStub, true);
});

test('cam reads camunda attributes; camBool coerces booleans', async () => {
  const { defs: d } = await parseBpmn(proc(`<bpmn:serviceTask id="x" camunda:delegateExpression="${EXPR('b')}" camunda:asyncBefore="true"/>`));
  const procEl = (d.rootElements || []).find((r) => shortType(r) === 'Process');
  const el = (procEl.flowElements || []).find((e) => e.id === 'x');
  assert.equal(cam(el, 'delegateExpression'), '${b}');
  assert.equal(camBool(el, 'asyncBefore'), true);
  assert.equal(camBool(el, 'asyncAfter'), false);
});

test('diffModels reports added/removed/renamed/retyped/rewired/implChanged', async () => {
  const A = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" name="Old" camunda:type="external" camunda:topic="t1"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="RT" name="Retype me" camunda:delegateExpression="${EXPR('rt')}"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="R" name="Remove me" camunda:delegateExpression="${EXPR('r')}"><bpmn:incoming>f3</bpmn:incoming><bpmn:outgoing>f4</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>f4</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="f2" sourceRef="T" targetRef="RT"/>
    <bpmn:sequenceFlow id="f3" sourceRef="RT" targetRef="R"/><bpmn:sequenceFlow id="f4" sourceRef="R" targetRef="E"/>`);
  const B = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>f1</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="T" name="New" camunda:delegateExpression="${EXPR('bean')}"><bpmn:incoming>f1</bpmn:incoming><bpmn:outgoing>f2</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:userTask id="RT" name="Retype me" camunda:candidateGroups="g" camunda:formRef="f"><bpmn:incoming>f2</bpmn:incoming><bpmn:outgoing>f3</bpmn:outgoing></bpmn:userTask>
    <bpmn:serviceTask id="N" name="Added" camunda:delegateExpression="${EXPR('n')}"><bpmn:incoming>f3</bpmn:incoming><bpmn:outgoing>f5</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>f5</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="f1" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="f2" sourceRef="T" targetRef="RT"/>
    <bpmn:sequenceFlow id="f3" sourceRef="RT" targetRef="N"/><bpmn:sequenceFlow id="f5" sourceRef="N" targetRef="E"/>`);
  const d = await diffModels(A, B);
  assert.ok(d.added.some((e) => e.id === 'N'), 'N added');
  assert.ok(d.removed.some((e) => e.id === 'R'), 'R removed');
  assert.ok(d.renamed.some((r) => r.id === 'T' && r.from === 'Old' && r.to === 'New'), 'T renamed');
  assert.ok(d.retyped.some((r) => r.id === 'RT' && r.from === 'ServiceTask' && r.to === 'UserTask'), 'RT retyped');
  assert.ok(d.rewired.some((r) => r.id === 'f3'), 'f3 rewired');
  assert.ok(d.implChanged.some((r) => r.id === 'T' && /delegateExpression/.test(r.to)), 'T impl changed');
});

test('summarizeText renders the collaboration block and declared root elements', async () => {
  const xml = defs(
    `<bpmn:collaboration id="C">
       <bpmn:participant id="PA" name="Customer" processRef="PrA"/>
       <bpmn:participant id="PB" name="System" processRef="PrB"/>
       <bpmn:messageFlow id="mf" sourceRef="TA" targetRef="SB"/>
     </bpmn:collaboration>
     <bpmn:process id="PrA" isExecutable="true" camunda:historyTimeToLive="P30D">
       <bpmn:startEvent id="SA"><bpmn:outgoing>a1</bpmn:outgoing></bpmn:startEvent>
       <bpmn:serviceTask id="TA" camunda:delegateExpression="${EXPR('send')}"><bpmn:incoming>a1</bpmn:incoming><bpmn:outgoing>a2</bpmn:outgoing></bpmn:serviceTask>
       <bpmn:endEvent id="EA"><bpmn:incoming>a2</bpmn:incoming></bpmn:endEvent>
       <bpmn:sequenceFlow id="a1" sourceRef="SA" targetRef="TA"/><bpmn:sequenceFlow id="a2" sourceRef="TA" targetRef="EA"/>
     </bpmn:process>
     <bpmn:process id="PrB" isExecutable="true" camunda:historyTimeToLive="P30D">
       <bpmn:startEvent id="SB"><bpmn:outgoing>b1</bpmn:outgoing></bpmn:startEvent>
       <bpmn:endEvent id="EB"><bpmn:incoming>b1</bpmn:incoming></bpmn:endEvent>
       <bpmn:sequenceFlow id="b1" sourceRef="SB" targetRef="EB"/>
     </bpmn:process>`,
    `<bpmn:message id="m1" name="PaymentConfirmed"/><bpmn:error id="e1" name="Boom" errorCode="BOOM"/>`);
  const t = await summarizeText(xml);
  assert.match(t, /Collaboration:/);
  assert.match(t, /Pool "Customer"/);
  assert.match(t, /Message flow:/);
  assert.match(t, /Declared \(root\) elements:/);
  assert.match(t, /Message: "PaymentConfirmed"/);
  assert.match(t, /Error: "Boom"/);
});

test('summarizeText reports parse warnings (e.g. duplicate ids)', async () => {
  const xml = proc(`<bpmn:startEvent id="DUP"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="DUP" camunda:delegateExpression="${EXPR('x')}"><bpmn:incoming>a</bpmn:incoming></bpmn:serviceTask>`);
  assert.match(await summarizeText(xml), /Parse warnings:/);
});
