/** Phase 2 — layout (resync mutations, laned, extras, drill-down) + validate edge cases. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutModel, validateModel, parseBpmn } from '../scripts/lib.mjs';
import { defs, proc, CLEAN, EXPR } from './builders.mjs';

const planeEls = (defsObj) => {
  const out = [];
  for (const d of defsObj.diagrams || []) if (d.plane) for (const pe of d.plane.planeElement || []) out.push(pe);
  return out;
};
async function shapeBounds(xml, id) {
  const { defs: d } = await parseBpmn(xml);
  for (const pe of planeEls(d)) {
    if (pe.$type && pe.$type.endsWith('BPMNShape') && pe.bpmnElement && pe.bpmnElement.id === id && pe.bounds) {
      const { x, y, width, height } = pe.bounds; return { x, y, width, height };
    }
  }
  return null;
}
async function edgeWaypoints(xml, id) {
  const { defs: d } = await parseBpmn(xml);
  for (const pe of planeEls(d)) {
    if (pe.$type && pe.$type.endsWith('BPMNEdge') && pe.bpmnElement && pe.bpmnElement.id === id) {
      return (pe.waypoint || []).map((w) => ({ x: w.x, y: w.y }));
    }
  }
  return null;
}
const near = (p, b, tol = 14) => p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol;

// --- resync mutations (the non-destructive contract) ---

test('resync ADD: a node missing DI is placed; existing geometry is untouched', async () => {
  const xml = defs(`<bpmn:process id="p" isExecutable="true" camunda:historyTimeToLive="P30D">
      <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
      <bpmn:serviceTask id="T1" camunda:delegateExpression="${EXPR('t1')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:serviceTask id="TX" camunda:delegateExpression="${EXPR('tx')}"><bpmn:incoming>b</bpmn:incoming><bpmn:outgoing>d</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:endEvent id="E"><bpmn:incoming>d</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T1"/>
      <bpmn:sequenceFlow id="b" sourceRef="T1" targetRef="TX"/>
      <bpmn:sequenceFlow id="d" sourceRef="TX" targetRef="E"/>
    </bpmn:process>
    <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="200" y="78" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="520" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="a_di" bpmnElement="a"><di:waypoint x="136" y="118"/><di:waypoint x="200" y="118"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`);
  const out = await layoutModel(xml); // no rebuild -> resync
  assert.notEqual(await shapeBounds(out, 'TX'), null, 'TX should be placed');
  assert.deepEqual(await shapeBounds(out, 'T1'), { x: 200, y: 78, width: 100, height: 80 }, 'existing T1 geometry preserved');
  assert.match(out, /camunda:delegateExpression/);
  assert.equal((await validateModel(out)).ok, true, JSON.stringify(await validateModel(out)));
});

test('resync PRUNE: DI for an element no longer in the semantics is dropped', async () => {
  const xml = defs(`<bpmn:process id="p" isExecutable="true" camunda:historyTimeToLive="P30D">
      <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
      <bpmn:serviceTask id="T1" camunda:delegateExpression="${EXPR('t1')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>c</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:endEvent id="E"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T1"/>
      <bpmn:sequenceFlow id="c" sourceRef="T1" targetRef="E"/>
    </bpmn:process>
    <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="200" y="78" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="GHOST_di" bpmnElement="GHOST"><dc:Bounds x="360" y="78" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="520" y="100" width="36" height="36"/></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`);
  const out = await layoutModel(xml);
  assert.doesNotMatch(out, /bpmnElement="GHOST"/);
  assert.deepEqual(await shapeBounds(out, 'T1'), { x: 200, y: 78, width: 100, height: 80 });
  assert.equal((await validateModel(out)).ok, true);
});

test('resync REROUTE: an edge whose waypoints no longer touch its nodes is re-routed', async () => {
  const xml = defs(`<bpmn:process id="p" isExecutable="true" camunda:historyTimeToLive="P30D">
      <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
      <bpmn:serviceTask id="T1" camunda:delegateExpression="${EXPR('t1')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>c</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:endEvent id="E"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T1"/>
      <bpmn:sequenceFlow id="c" sourceRef="T1" targetRef="E"/>
    </bpmn:process>
    <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="T1_di" bpmnElement="T1"><dc:Bounds x="200" y="78" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="520" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="a_di" bpmnElement="a"><di:waypoint x="0" y="0"/><di:waypoint x="5" y="5"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="c_di" bpmnElement="c"><di:waypoint x="300" y="118"/><di:waypoint x="520" y="118"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`);
  const out = await layoutModel(xml);
  const wp = await edgeWaypoints(out, 'a');
  assert.ok(wp && wp.length >= 2, 'edge a still has waypoints');
  assert.ok(near(wp[0], { x: 100, y: 100, width: 36, height: 36 }), `first waypoint should touch S, got ${JSON.stringify(wp[0])}`);
  assert.ok(near(wp[wp.length - 1], { x: 200, y: 78, width: 100, height: 80 }), `last waypoint should touch T1, got ${JSON.stringify(wp.at(-1))}`);
});

// --- generation paths ---

test('laned layout: lane bands are drawn and every node gets DI', async () => {
  const xml = proc(`
    <bpmn:laneSet id="ls">
      <bpmn:lane id="L1" name="Sales"><bpmn:flowNodeRef>S</bpmn:flowNodeRef><bpmn:flowNodeRef>A</bpmn:flowNodeRef></bpmn:lane>
      <bpmn:lane id="L2" name="Finance"><bpmn:flowNodeRef>B</bpmn:flowNodeRef><bpmn:flowNodeRef>E</bpmn:flowNodeRef></bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${EXPR('a')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:serviceTask id="B" camunda:delegateExpression="${EXPR('b')}"><bpmn:incoming>b</bpmn:incoming><bpmn:outgoing>c</bpmn:outgoing></bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="A"/><bpmn:sequenceFlow id="b" sourceRef="A" targetRef="B"/><bpmn:sequenceFlow id="c" sourceRef="B" targetRef="E"/>`);
  const out = await layoutModel(xml, { rebuild: true });
  assert.notEqual(await shapeBounds(out, 'L1'), null, 'lane L1 has a band');
  assert.notEqual(await shapeBounds(out, 'L2'), null, 'lane L2 has a band');
  for (const id of ['S', 'A', 'B', 'E']) assert.notEqual(await shapeBounds(out, id), null, `${id} has DI`);
  assert.equal((await validateModel(out)).ok, true, JSON.stringify(await validateModel(out)));
});

test('placeExtras: data objects and text annotations get DI', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:serviceTask id="A" camunda:delegateExpression="${EXPR('a')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing>
      <bpmn:dataOutputAssociation id="doa"><bpmn:targetRef>DO</bpmn:targetRef></bpmn:dataOutputAssociation>
    </bpmn:serviceTask>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:dataObjectReference id="DO" name="Doc" dataObjectRef="d1"/>
    <bpmn:dataObject id="d1"/>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="A"/><bpmn:sequenceFlow id="b" sourceRef="A" targetRef="E"/>
    <bpmn:textAnnotation id="TA"><bpmn:text>note</bpmn:text></bpmn:textAnnotation>
    <bpmn:association id="assoc" sourceRef="A" targetRef="TA"/>`);
  const out = await layoutModel(xml, { rebuild: true });
  assert.notEqual(await shapeBounds(out, 'DO'), null, 'data object reference placed');
  assert.notEqual(await shapeBounds(out, 'TA'), null, 'text annotation placed');
  assert.equal((await validateModel(out)).ok, true, JSON.stringify(await validateModel(out)));
});

test('sub-process drill-down: an expanded sub-process keeps its children laid out', async () => {
  const xml = proc(`
    <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
    <bpmn:subProcess id="Sub" name="Inner"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing>
      <bpmn:startEvent id="ss"><bpmn:outgoing>i</bpmn:outgoing></bpmn:startEvent>
      <bpmn:serviceTask id="NT" camunda:delegateExpression="${EXPR('nt')}"><bpmn:incoming>i</bpmn:incoming><bpmn:outgoing>j</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:endEvent id="se"><bpmn:incoming>j</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="i" sourceRef="ss" targetRef="NT"/><bpmn:sequenceFlow id="j" sourceRef="NT" targetRef="se"/>
    </bpmn:subProcess>
    <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
    <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="Sub"/><bpmn:sequenceFlow id="b" sourceRef="Sub" targetRef="E"/>`);
  const out = await layoutModel(xml, { rebuild: true });
  assert.notEqual(await shapeBounds(out, 'Sub'), null, 'sub-process has DI');
  assert.notEqual(await shapeBounds(out, 'NT'), null, 'nested task keeps DI (not collapse-deleted)');
  assert.equal((await validateModel(out)).ok, true, JSON.stringify(await validateModel(out)));
});

test('collaboration with a black-box pool: the empty pool and its message flows get DI', async () => {
  const xml = defs(
    `<bpmn:collaboration id="C">
       <bpmn:participant id="Customer" name="Customer"/>
       <bpmn:participant id="Sys" name="Order System" processRef="PrSys"/>
       <bpmn:messageFlow id="mfIn" sourceRef="Customer" targetRef="SS"/>
       <bpmn:messageFlow id="mfOut" sourceRef="TS" targetRef="Customer"/>
     </bpmn:collaboration>
     <bpmn:process id="PrSys" isExecutable="true" camunda:historyTimeToLive="P30D">
       <bpmn:startEvent id="SS"><bpmn:outgoing>s1</bpmn:outgoing></bpmn:startEvent>
       <bpmn:serviceTask id="TS" camunda:delegateExpression="${EXPR('processOrder')}"><bpmn:incoming>s1</bpmn:incoming><bpmn:outgoing>s2</bpmn:outgoing></bpmn:serviceTask>
       <bpmn:endEvent id="ES"><bpmn:incoming>s2</bpmn:incoming></bpmn:endEvent>
       <bpmn:sequenceFlow id="s1" sourceRef="SS" targetRef="TS"/><bpmn:sequenceFlow id="s2" sourceRef="TS" targetRef="ES"/>
     </bpmn:process>`);
  const out = await layoutModel(xml, { rebuild: true });
  assert.notEqual(await shapeBounds(out, 'Customer'), null, 'black-box pool gets a shape');
  assert.notEqual(await shapeBounds(out, 'Sys'), null, 'system pool gets a shape');
  assert.match(out, /bpmnElement="mfIn"/, 'inbound message flow has an edge');
  assert.match(out, /bpmnElement="mfOut"/, 'outbound message flow has an edge');
  assert.equal((await validateModel(out)).ok, true, JSON.stringify(await validateModel(out)));
});

// --- validate edge cases ---

test('validate flags overlapping shapes', async () => {
  const xml = defs(`<bpmn:process id="p" isExecutable="true" camunda:historyTimeToLive="P30D">
      <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
      <bpmn:serviceTask id="A" camunda:delegateExpression="${EXPR('a')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:serviceTask id="B" camunda:delegateExpression="${EXPR('b')}"><bpmn:incoming>b</bpmn:incoming><bpmn:outgoing>c</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:endEvent id="E"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="A"/><bpmn:sequenceFlow id="b" sourceRef="A" targetRef="B"/><bpmn:sequenceFlow id="c" sourceRef="B" targetRef="E"/>
    </bpmn:process>
    <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="A_di" bpmnElement="A"><dc:Bounds x="200" y="78" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="B_di" bpmnElement="B"><dc:Bounds x="250" y="78" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="520" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="a_di" bpmnElement="a"><di:waypoint x="136" y="118"/><di:waypoint x="200" y="118"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="b_di" bpmnElement="b"><di:waypoint x="300" y="118"/><di:waypoint x="250" y="118"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="c_di" bpmnElement="c"><di:waypoint x="350" y="118"/><di:waypoint x="520" y="118"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`);
  const r = await validateModel(xml);
  assert.ok(r.overlaps.length >= 1, 'A and B overlap');
  assert.equal(r.ok, false);
});

test('validate flags a flow node with no shape', async () => {
  const xml = defs(`<bpmn:process id="p" isExecutable="true" camunda:historyTimeToLive="P30D">
      <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
      <bpmn:serviceTask id="M" camunda:delegateExpression="${EXPR('m')}"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
      <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="M"/><bpmn:sequenceFlow id="b" sourceRef="M" targetRef="E"/>
    </bpmn:process>
    <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="520" y="100" width="36" height="36"/></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`);
  const r = await validateModel(xml);
  assert.ok(r.missing.some((m) => m.includes('#M')), `M should be reported missing, got ${JSON.stringify(r.missing)}`);
  assert.equal(r.ok, false);
});

test('validate is plane-aware: a collapsed sub-process need not lay out its children', async () => {
  const xml = defs(`<bpmn:process id="p" isExecutable="true" camunda:historyTimeToLive="P30D">
      <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
      <bpmn:subProcess id="Sub" name="Collapsed"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing>
        <bpmn:startEvent id="ss"><bpmn:outgoing>i</bpmn:outgoing></bpmn:startEvent>
        <bpmn:serviceTask id="NT" camunda:delegateExpression="${EXPR('nt')}"><bpmn:incoming>i</bpmn:incoming><bpmn:outgoing>j</bpmn:outgoing></bpmn:serviceTask>
        <bpmn:endEvent id="se"><bpmn:incoming>j</bpmn:incoming></bpmn:endEvent>
        <bpmn:sequenceFlow id="i" sourceRef="ss" targetRef="NT"/><bpmn:sequenceFlow id="j" sourceRef="NT" targetRef="se"/>
      </bpmn:subProcess>
      <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
      <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="Sub"/><bpmn:sequenceFlow id="b" sourceRef="Sub" targetRef="E"/>
    </bpmn:process>
    <bpmndi:BPMNDiagram id="dia"><bpmndi:BPMNPlane id="plane" bpmnElement="p">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Sub_di" bpmnElement="Sub" isExpanded="false"><dc:Bounds x="200" y="78" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="520" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="a_di" bpmnElement="a"><di:waypoint x="136" y="118"/><di:waypoint x="200" y="118"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="b_di" bpmnElement="b"><di:waypoint x="300" y="118"/><di:waypoint x="520" y="118"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>`);
  const r = await validateModel(xml);
  assert.equal(r.ok, true, `collapsed children should not be required: ${JSON.stringify(r)}`);
});

// --- idempotency (no churn) ---

test('idempotency: re-laying out a laid-out file keeps geometry and extensions stable', async () => {
  const once = await layoutModel(CLEAN, { rebuild: true });
  const twice = await layoutModel(once); // resync
  for (const id of ['S', 'Svc', 'U', 'E']) {
    assert.deepEqual(await shapeBounds(twice, id), await shapeBounds(once, id), `${id} bounds stable across passes`);
  }
  assert.match(twice, /camunda:delegateExpression/);
  assert.match(twice, /camunda:formRef/);
  assert.equal((await validateModel(twice)).ok, true);
});
