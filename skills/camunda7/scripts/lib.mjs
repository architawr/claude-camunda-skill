/**
 * lib.mjs - pure-ish library for the `camunda7` skill.
 *
 * Mirrors the sibling `bpmn` skill's architecture (engine as functions over data;
 * the CLI is a thin wrapper) but is **Camunda 7 aware**:
 *   - registers `camunda-bpmn-moddle`, so the `camunda:` namespace is parsed and
 *     serialized instead of silently dropped on the first round-trip;
 *   - layout rebuilds DI from coordinates INSIDE the camunda-moddle document, so
 *     execution extensions are preserved natively on every path (no XML grafting);
 *   - layout is non-destructive by default (resync), regenerating only on rebuild;
 *   - lint adds Camunda execution-readiness rules on top of the structural ones.
 */
import * as moddlePkg from 'bpmn-moddle';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const camundaDescriptor = require('camunda-bpmn-moddle/resources/camunda.json');

const BpmnModdle = moddlePkg.BpmnModdle || moddlePkg.default || moddlePkg;
// Every parse/serialize that must keep camunda: data goes through this.
export const makeModdle = () => new BpmnModdle({ camunda: camundaDescriptor });

export const shortType = (el) => (el && el.$type ? el.$type.replace(/^bpmn:/, '') : '');
export const localName = (el) => (el && el.$type ? el.$type.split(':').pop() : '');
export const isFlowNode = (el) => typeof el.$instanceOf === 'function' && el.$instanceOf('bpmn:FlowNode');
export const isSubProcess = (el) => /SubProcess$|Transaction$|AdHocSubProcess$/.test(shortType(el));

function eventTrigger(el) {
  const defs = el.eventDefinitions || [];
  if (!defs.length) return null;
  return defs.map((d) => shortType(d).replace(/EventDefinition$/, '')).join('+');
}

export function label(el) {
  if (!el) return '(none)';
  const name = el.name ? JSON.stringify(el.name) : '(unnamed)';
  let kind = shortType(el);
  const trig = el.eventDefinitions ? eventTrigger(el) : null;
  if (trig) kind += `:${trig}`;
  return `${name} [${kind} #${el.id}]`;
}

export async function parseBpmn(xml) {
  const moddle = makeModdle();
  const { rootElement: defs, warnings } = await moddle.fromXML(xml);
  return { defs, warnings: warnings || [], moddle };
}

/* ----------------------------- camunda helpers ----------------------------- */

// Read a camunda: attribute whether it parsed into a typed property or the $attrs bag.
export function cam(el, name) {
  if (!el) return undefined;
  let v;
  if (typeof el.get === 'function') { try { v = el.get('camunda:' + name); } catch { /* not a known prop */ } }
  if (v === undefined || v === null) { if (el.$attrs) v = el.$attrs['camunda:' + name]; }
  return v;
}
export const camBool = (el, name) => { const v = cam(el, name); return v === true || v === 'true'; };
const extValues = (el) => (el && el.extensionElements && el.extensionElements.values) || [];
const hasExt = (el, local) => extValues(el).some((v) => localName(v) === local);

function camProps(el) {
  const out = {};
  for (const v of extValues(el)) if (localName(v) === 'Properties') for (const p of (v.values || [])) out[p.name] = p.value;
  return out;
}
export const isStub = (el) => {
  const s = camProps(el).stub;
  if (s === 'true' || s === true) return true;
  const doc = (el.documentation && el.documentation[0] && el.documentation[0].text) || '';
  return /^\s*STUB\b/i.test(doc);
};
export const isFormStub = (el) => {
  const v = camProps(el).formStub;
  if (v === 'true' || v === true) return true;
  const doc = (el.documentation && el.documentation[0] && el.documentation[0].text) || '';
  return /^\s*FORM STUB\b/i.test(doc);
};
const hasForm = (el) => !!(cam(el, 'formKey') || cam(el, 'formRef') || hasExt(el, 'FormData'));

// One-line description of HOW an activity is implemented on the engine.
export function implOf(el) {
  const t = shortType(el);
  const cls = cam(el, 'class'), del = cam(el, 'delegateExpression'), expr = cam(el, 'expression');
  const type = cam(el, 'type'), topic = cam(el, 'topic'), resVar = cam(el, 'resultVariable');
  const exprTail = expr ? `expression=${expr}${resVar ? ` -> ${resVar}` : ''}` : null;
  if (t === 'BusinessRuleTask') {
    const dref = cam(el, 'decisionRef');
    if (dref) return `DMN decisionRef=${dref}${cam(el, 'mapDecisionResult') ? ` (${cam(el, 'mapDecisionResult')})` : ''}${resVar ? ` -> ${resVar}` : ''}`;
    if (cls) return `class=${cls}`;
    if (del) return `delegateExpression=${del}`;
    if (exprTail) return exprTail;
    if (type === 'external') return topic ? `external topic=${topic}` : 'external (NO topic)';
    return '(no implementation)';
  }
  if (t === 'ServiceTask' || t === 'SendTask') {
    if (type === 'external') return topic ? `external topic=${topic}` : 'external (NO topic)';
    if (cls) return `class=${cls}`;
    if (del) return `delegateExpression=${del}`;
    if (exprTail) return exprTail;
    if (hasExt(el, 'Connector')) return 'connector';
    return '(no implementation)';
  }
  if (t === 'ScriptTask') return el.scriptFormat ? `script (${el.scriptFormat})` : 'script (NO format)';
  if (t === 'CallActivity') return el.calledElement ? `calledElement=${el.calledElement}` : '(no calledElement)';
  if (t === 'UserTask') {
    const bits = [];
    for (const k of ['assignee', 'candidateGroups', 'candidateUsers']) { const v = cam(el, k); if (v) bits.push(`${k}=${v}`); }
    const fk = cam(el, 'formKey'), fr = cam(el, 'formRef');
    if (fk) bits.push(`formKey=${fk}`);
    if (fr) bits.push(`formRef=${fr}`);
    if (hasExt(el, 'FormData')) bits.push('formData');
    return bits.length ? bits.join(', ') : '(no assignee/form)';
  }
  return null;
}

function decorate(el) {
  const extras = [];
  if (isStub(el)) extras.push('STUB');
  if (isFormStub(el)) extras.push('FORM-STUB');
  if (camBool(el, 'asyncBefore')) extras.push('asyncBefore');
  if (camBool(el, 'asyncAfter')) extras.push('asyncAfter');
  if (hasExt(el, 'InputOutput')) extras.push('io');
  if (hasExt(el, 'ExecutionListener') || hasExt(el, 'TaskListener')) extras.push('listeners');
  if (el.loopCharacteristics) extras.push(localName(el.loopCharacteristics) === 'MultiInstanceLoopCharacteristics' ? 'multi-instance' : 'loop');
  return extras.length ? `  {${extras.join(',')}}` : '';
}

/* -------------------------------- summarize -------------------------------- */

function categorize(container) {
  const out = { start: [], end: [], intermediate: [], boundary: [], activities: [], gateways: [], subprocesses: [], flows: [], data: [], other: [] };
  for (const el of container.flowElements || []) {
    const t = shortType(el);
    if (t === 'SequenceFlow') out.flows.push(el);
    else if (t === 'BoundaryEvent') out.boundary.push(el);
    else if (t === 'StartEvent') out.start.push(el);
    else if (t === 'EndEvent') out.end.push(el);
    else if (/Event$/.test(t)) out.intermediate.push(el);
    else if (/Gateway$/.test(t)) out.gateways.push(el);
    else if (t === 'SubProcess' || t === 'Transaction' || t === 'AdHocSubProcess') out.subprocesses.push(el);
    else if (/Task$/.test(t) || t === 'CallActivity') out.activities.push(el);
    else if (/^Data/.test(t)) out.data.push(el);
    else out.other.push(el);
  }
  return out;
}

function laneOf(container) {
  const map = {};
  for (const ls of container.laneSets || []) for (const lane of ls.lanes || []) for (const ref of lane.flowNodeRef || []) map[ref.id] = lane.name || lane.id;
  return map;
}

const flowEndpoint = (ref) => (!ref ? '?' : ref.name ? JSON.stringify(ref.name) : `#${ref.id}`);

function summarizeContainer(container, lines, indent = '') {
  const cat = categorize(container);
  const lanes = laneOf(container);
  const tag = (el) => (lanes[el.id] ? `  {lane: ${lanes[el.id]}}` : '');
  const section = (title, items, fmt) => { if (!items.length) return; lines.push(`${indent}${title}:`); for (const el of items) lines.push(`${indent}  - ${fmt(el)}`); };
  section('Start events', cat.start, (el) => label(el) + tag(el) + decorate(el));
  section('Activities', cat.activities, (el) => { const impl = implOf(el); return label(el) + tag(el) + (impl ? `  -> ${impl}` : '') + decorate(el); });
  section('Gateways', cat.gateways, (el) => {
    const dir = el.gatewayDirection ? ` (${el.gatewayDirection})` : '';
    const def = el.default ? `  default=#${el.default.id}` : '';
    return label(el) + dir + def + tag(el);
  });
  section('Intermediate events', cat.intermediate, (el) => label(el) + tag(el) + decorate(el));
  section('Boundary events', cat.boundary, (el) => {
    const host = flowEndpoint(el.attachedToRef);
    const interrupting = el.cancelActivity === false ? 'non-interrupting' : 'interrupting';
    return `${label(el)} attached to ${host} (${interrupting})` + decorate(el);
  });
  section('End events', cat.end, (el) => label(el) + tag(el));
  section('Data', cat.data, (el) => label(el));
  section('Other', cat.other, (el) => label(el));
  if (cat.flows.length) {
    lines.push(`${indent}Sequence flows:`);
    for (const f of cat.flows) {
      const cond = f.conditionExpression && f.conditionExpression.body ? `  [condition: ${f.conditionExpression.body}]` : '';
      const name = f.name ? ` ("${f.name}")` : '';
      lines.push(`${indent}  - ${flowEndpoint(f.sourceRef)} -> ${flowEndpoint(f.targetRef)}${name}${cond}`);
    }
  }
  for (const sp of cat.subprocesses) { lines.push(`${indent}Sub-process ${label(sp)}${decorate(sp)}:`); summarizeContainer(sp, lines, indent + '    '); }
}

function categorizeIds(container) {
  const c = categorize(container);
  const ids = (arr) => arr.map((e) => ({ id: e.id, name: e.name || null, type: shortType(e), impl: implOf(e) || undefined, stub: isStub(e) || undefined, formStub: isFormStub(e) || undefined }));
  return {
    start: ids(c.start), end: ids(c.end), intermediate: ids(c.intermediate), boundary: ids(c.boundary),
    activities: ids(c.activities), gateways: ids(c.gateways), subprocesses: ids(c.subprocesses), data: ids(c.data),
    flows: c.flows.map((f) => ({ id: f.id, name: f.name || null, source: f.sourceRef && f.sourceRef.id, target: f.targetRef && f.targetRef.id, condition: f.conditionExpression && f.conditionExpression.body })),
  };
}

const rootDefs = (defs, type) => (defs.rootElements || []).filter((r) => shortType(r) === type);

export async function summarizeJson(xml) {
  const { defs } = await parseBpmn(xml);
  return {
    processes: rootDefs(defs, 'Process').map((p) => ({
      id: p.id, name: p.name || null, executable: !!p.isExecutable,
      historyTimeToLive: cam(p, 'historyTimeToLive') || null, versionTag: cam(p, 'versionTag') || null,
      ...categorizeIds(p),
    })),
  };
}

export async function summarizeText(xml) {
  const { defs, warnings } = await parseBpmn(xml);
  const processes = rootDefs(defs, 'Process');
  const collaboration = (defs.rootElements || []).find((r) => shortType(r) === 'Collaboration');
  const lines = [];
  if (collaboration) {
    lines.push('Collaboration:');
    for (const p of collaboration.participants || []) lines.push(`  - Pool ${JSON.stringify(p.name || p.id)} -> process ${p.processRef ? `#${p.processRef.id}` : '(no process)'}`);
    for (const mf of collaboration.messageFlows || []) lines.push(`  - Message flow: ${flowEndpoint(mf.sourceRef)} -> ${flowEndpoint(mf.targetRef)}`);
    lines.push('');
  }
  for (const proc of processes) {
    const exec = proc.isExecutable ? 'executable' : 'non-executable';
    const httl = cam(proc, 'historyTimeToLive'), vtag = cam(proc, 'versionTag');
    lines.push(`Process ${JSON.stringify(proc.name || proc.id)} #${proc.id} (${exec}, historyTTL=${httl != null ? httl : 'MISSING'}${vtag ? `, versionTag=${vtag}` : ''})`);
    summarizeContainer(proc, lines, '  ');
    lines.push('');
  }
  const declared = [];
  for (const t of ['Message', 'Signal', 'Error', 'Escalation']) {
    const items = rootDefs(defs, t);
    if (items.length) declared.push(`${t}: ${items.map((i) => (i.name ? `"${i.name}"` : `#${i.id}`)).join(', ')}`);
  }
  if (declared.length) { lines.push('Declared (root) elements:'); for (const d of declared) lines.push(`  - ${d}`); lines.push(''); }
  if (warnings.length) { lines.push(`Parse warnings: ${warnings.length}`); for (const w of warnings) lines.push(`  ! ${w.message}`); }
  return lines.join('\n').trimEnd();
}

/* ---------------------------------- lint ----------------------------------- */

const gwFamily = (t) => (t === 'ParallelGateway' ? 'AND' : t === 'ExclusiveGateway' ? 'XOR' : t === 'InclusiveGateway' ? 'OR' : t === 'EventBasedGateway' ? 'EVENT' : null);

function buildGraph(proc) {
  const nodes = new Map(); const out = new Map(); const inc = new Map(); const outEdges = new Map();
  const push = (m, k, v) => { if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  const collect = (c) => {
    for (const el of c.flowElements || []) {
      if (shortType(el) === 'SequenceFlow') {
        const s = el.sourceRef && el.sourceRef.id, t = el.targetRef && el.targetRef.id;
        if (s && t) { push(out, s, t); push(inc, t, s); push(outEdges, s, el); }
      } else { nodes.set(el.id, el); if (el.flowElements) collect(el); }
    }
  };
  collect(proc);
  return { nodes, out, inc, outEdges };
}

function nearestDivergingUpstream(startId, out, inc, nodes) {
  const seen = new Set([startId]); const q = [...(inc.get(startId) || [])];
  while (q.length) {
    const id = q.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const el = nodes.get(id);
    if (el && /Gateway$/.test(shortType(el)) && (out.get(id) || []).length > 1) return id;
    for (const p of inc.get(id) || []) q.push(p);
  }
  return null;
}

// Lenient ISO-8601 / cron checks for timer values; expressions are runtime-resolved.
const isExpr = (s) => /^[#$]\{.*\}$/.test(String(s).trim());
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const ISO_DUR = /^P(?=[^T]|T.)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(\d+H)?(\d+M)?(\d+(\.\d+)?S)?)?$/;
function badTimer(kind, value) {
  if (!value || !value.trim()) return `empty ${kind}`;
  const v = value.trim();
  if (isExpr(v)) return null;
  if (kind === 'timeDate') return ISO_DATE.test(v) ? null : `not an ISO-8601 datetime: "${v}"`;
  if (kind === 'timeDuration') return ISO_DUR.test(v) ? null : `not an ISO-8601 duration (e.g. PT15M): "${v}"`;
  if (kind === 'timeCycle') {
    if (/^R\d*\//.test(v) || ISO_DUR.test(v)) return null;
    const f = v.split(/\s+/).length; if (f >= 6 && f <= 7) return null; // Quartz cron (seconds-first), 6-7 fields
    return `not a repeating interval (R3/PT1H) or a 6-7 field cron: "${v}"`;
  }
  return null;
}

// Per-container structural checks (ported from the bpmn skill): reachability,
// dead ends, missing start/end, implicit split, misdirected/bad-boundary, lanes.
function structuralFindings(container, add, isTop) {
  const nodes = new Map(); const outE = new Map(); const inE = new Map(); const attach = new Map();
  for (const el of container.flowElements || []) if (shortType(el) !== 'SequenceFlow' && isFlowNode(el)) nodes.set(el.id, el);
  for (const el of container.flowElements || []) {
    if (shortType(el) !== 'SequenceFlow') continue;
    const s = el.sourceRef && el.sourceRef.id, t = el.targetRef && el.targetRef.id;
    if (s && t) { if (!outE.has(s)) outE.set(s, []); outE.get(s).push(t); if (!inE.has(t)) inE.set(t, []); inE.get(t).push(s); }
  }
  for (const el of nodes.values()) if (shortType(el) === 'BoundaryEvent' && el.attachedToRef) { const h = el.attachedToRef.id; if (!attach.has(h)) attach.set(h, []); attach.get(h).push(el.id); }
  const starts = [...nodes.values()].filter((n) => shortType(n) === 'StartEvent');
  const where = isTop ? '' : ` (in sub-process #${container.id})`;
  if (nodes.size && !starts.length) add('WARN', `NO START: the process has no start event${where}. It can't be instantiated normally. Fix: add a start event.`);
  if (nodes.size && ![...nodes.values()].some((n) => shortType(n) === 'EndEvent')) add('WARN', `NO END: the process has no end event${where}. Tokens have nowhere to finish. Fix: add an end event for each outcome.`);
  if (starts.length) {
    const seen = new Set(); const q = starts.map((s) => s.id);
    while (q.length) { const id = q.shift(); if (seen.has(id)) continue; seen.add(id); for (const t of outE.get(id) || []) q.push(t); for (const b of attach.get(id) || []) q.push(b); }
    for (const [id, el] of nodes) { if (shortType(el) === 'StartEvent') continue; if (!seen.has(id)) add('WARN', `UNREACHABLE: ${label(el)}${where} has no path from a start event, so it never executes. Fix: connect it with a sequence flow or remove it.`); }
  }
  for (const [id, el] of nodes) { if (shortType(el) === 'EndEvent' || shortType(el) === 'BoundaryEvent') continue; if (!(outE.get(id) || []).length) add('WARN', `DEAD END: ${label(el)}${where} has no outgoing sequence flow, so the token stops there. Fix: connect it onward or end the branch with an end event.`); }
  for (const [id, el] of nodes) { if (/Gateway$/.test(shortType(el))) continue; const n = (outE.get(id) || []).length; if (n > 1) add('WARN', `IMPLICIT SPLIT: ${label(el)}${where} has ${n} outgoing flows but is not a gateway, so it splits the token implicitly. Fix: route the branches through a gateway.`); }
  for (const [id, el] of nodes) {
    if (shortType(el) === 'StartEvent' && (inE.get(id) || []).length) add('WARN', `MISDIRECTED EVENT: start event ${label(el)}${where} has an incoming sequence flow. Fix: remove it or use an intermediate event.`);
    if (shortType(el) === 'EndEvent' && (outE.get(id) || []).length) add('WARN', `MISDIRECTED EVENT: end event ${label(el)}${where} has an outgoing sequence flow. Fix: remove it or use an intermediate event.`);
  }
  const isActivity = (t) => /Task$/.test(t) || t === 'CallActivity' || /SubProcess$|Transaction$|AdHocSubProcess$/.test(t);
  for (const [, el] of nodes) { if (shortType(el) !== 'BoundaryEvent' || !el.attachedToRef) continue; const host = nodes.get(el.attachedToRef.id); if (host && !isActivity(shortType(host))) add('WARN', `BAD BOUNDARY: boundary event ${label(el)}${where} is attached to a ${shortType(host)}, not an activity.`); }
  const lanes = (container.laneSets || []).flatMap((ls) => ls.lanes || []);
  if (lanes.length) { const assigned = new Set(); for (const lane of lanes) for (const ref of lane.flowNodeRef || []) assigned.add(ref.id); for (const [id, el] of nodes) { if (shortType(el) === 'BoundaryEvent') continue; if (!assigned.has(id)) add('WARN', `UNASSIGNED NODE: ${label(el)}${where} is in no lane though the process uses lanes. Fix: add it to a lane's flowNodeRef.`); } }
}

// Returns [{ sev: 'ERROR'|'WARN'|'INFO', msg }], sorted by severity.
export async function lintModel(xml) {
  const { defs, warnings } = await parseBpmn(xml);
  const findings = [];
  const add = (sev, msg) => findings.push({ sev, msg });
  const nameOf = (el, id) => (el && el.name ? `"${el.name}"` : `#${id}`);

  // A2: surface parse warnings (duplicate ids, dropped/dangling elements).
  for (const w of warnings) add('ERROR', `PARSE: ${w.message}. The model didn't parse cleanly; an element may have been dropped. Fix the XML and re-run.`);

  if (/\bxmlns:zeebe=|[\s<]zeebe:/.test(xml)) add('ERROR', 'Found Zeebe (zeebe:) attributes/namespace — that is Camunda 8, not Camunda 7. Use camunda: implementations (class / delegateExpression / external topic / DMN decisionRef).');

  const processes = rootDefs(defs, 'Process');
  if (processes.length && !processes.some((p) => p.isExecutable)) add('WARN', 'No process has isExecutable="true". Nothing here can start on the engine. Set isExecutable="true" on the process you intend to run.');

  const errorsById = new Map(rootDefs(defs, 'Error').map((e) => [e.id, e]));
  const escalations = new Set(rootDefs(defs, 'Escalation').map((e) => e.id));

  for (const proc of processes) {
    const httl = cam(proc, 'historyTimeToLive');
    if (proc.isExecutable && httl == null) add('WARN', `Process ${nameOf(proc, proc.id)} has no historyTimeToLive. Since Camunda 7.20 the engine rejects deployment without it. Fix: add camunda:historyTimeToLive (e.g. "P30D").`);
    else if (httl != null && !isExpr(httl) && !/^P\d+D$/.test(String(httl)) && !/^\d+$/.test(String(httl))) add('WARN', `Process ${nameOf(proc, proc.id)} historyTimeToLive="${httl}" is not day-based. Use an ISO-8601 day duration ("P30D") or an integer day count ("30") — sub-day units like PT1H are rejected.`);

    const { nodes, out, inc, outEdges } = buildGraph(proc);

    // Gateway split/join family mismatch.
    for (const [id, el] of nodes) {
      if (!/Gateway$/.test(shortType(el))) continue;
      const incoming = inc.get(id) || [];
      if (incoming.length < 2) continue;
      const jf = gwFamily(shortType(el));
      const splits = new Map();
      for (const s of incoming) { const sd = nearestDivergingUpstream(s, out, inc, nodes); if (sd) splits.set(sd, (splits.get(sd) || 0) + 1); }
      for (const [sid, count] of splits) {
        if (count < 2) continue;
        const sf = gwFamily(shortType(nodes.get(sid)));
        const jn = nameOf(el, id), sn = nameOf(nodes.get(sid), sid);
        if ((sf === 'XOR' || sf === 'OR') && jf === 'AND') add('ERROR', `DEADLOCK: parallel (AND) join ${jn} merges branches that split at ${sf} gateway ${sn}. Only one branch gets a token, so the AND-join waits forever. Fix: make the join exclusive/inclusive to match the split.`);
        else if (sf === 'AND' && (jf === 'XOR' || jf === 'OR')) add('ERROR', `TOKEN DUPLICATION: ${jf} join ${jn} merges branches from a parallel (AND) split ${sn}. Every token passes straight through, so everything after the merge runs more than once. Fix: synchronize with a parallel join.`);
      }
    }

    for (const [id, el] of nodes) {
      const t = shortType(el); const oe = outEdges.get(id) || [];
      if ((t === 'ExclusiveGateway' || t === 'InclusiveGateway') && oe.length > 1 && !el.default && oe.every((f) => f.conditionExpression && f.conditionExpression.body))
        add('WARN', `NO DEFAULT: diverging ${t} ${nameOf(el, id)} has every outgoing flow conditioned but no default. If none matches the token stops. Fix: mark one flow as default.`);
      if (t === 'ParallelGateway' && oe.length > 1 && oe.some((f) => f.conditionExpression && f.conditionExpression.body))
        add('WARN', `IGNORED CONDITION: parallel gateway ${nameOf(el, id)} has conditions on its outgoing flows. A parallel gateway always activates ALL branches; the conditions are ignored. Fix: use an exclusive/inclusive gateway.`);
      if (el.default && el.default.conditionExpression && el.default.conditionExpression.body)
        add('WARN', `DEFAULT WITH CONDITION: gateway ${nameOf(el, id)} marks flow #${el.default.id} default but it also has a condition (which is ignored). Fix: remove the condition or pick another default.`);
      // A5: a condition on a flow leaving a non-gateway (conditional flow) with no fallback.
      if (!/Gateway$/.test(t) && oe.length === 1 && oe[0].conditionExpression && oe[0].conditionExpression.body && !el.default)
        add('WARN', `CONDITIONAL FLOW STUCK: ${t} ${nameOf(el, id)} has a single outgoing flow guarded by a condition and no alternative. If it's false the token stops here. Fix: add a default/second flow, or move the decision to a gateway.`);
    }

    // Camunda execution readiness (per node, recurses via buildGraph).
    for (const [id, el] of nodes) {
      const t = shortType(el);
      if (t === 'ServiceTask' || t === 'SendTask' || t === 'BusinessRuleTask') {
        const impl = implOf(el);
        if (impl === '(no implementation)') add('ERROR', `${t} ${nameOf(el, id)} has no implementation. The engine throws on deploy/exec. Fix: set camunda:class / delegateExpression / expression, camunda:type="external"+topic, ${t === 'BusinessRuleTask' ? 'camunda:decisionRef, ' : ''}or a connector.`);
        else if (impl === 'external (NO topic)') add('ERROR', `${t} ${nameOf(el, id)} is camunda:type="external" but has no camunda:topic. Workers subscribe by topic. Fix: add camunda:topic.`);
      }
      if (t === 'ScriptTask' && !el.scriptFormat && !cam(el, 'resource')) add('ERROR', `Script task ${nameOf(el, id)} has no scriptFormat. Fix: set scriptFormat (e.g. "groovy") + a <bpmn:script> body or camunda:resource.`);
      if (t === 'CallActivity' && !el.calledElement && !cam(el, 'caseRef')) add('ERROR', `Call activity ${nameOf(el, id)} has no calledElement. Fix: set calledElement to the called process key (+ camunda:in/out).`);
      if (t === 'ReceiveTask' && !el.messageRef) add('WARN', `Receive task ${nameOf(el, id)} has no messageRef. Correlation is by message name. Fix: reference a <bpmn:message>.`);
      if (t === 'UserTask' && !hasForm(el)) add('WARN', `User task ${nameOf(el, id)} has no form. This skill puts a form on every user task. Fix: wire camunda:formRef (or formKey) to a catalog form, or form-stub it (+ spec).`);

      const loop = el.loopCharacteristics;
      if (loop && localName(loop) === 'MultiInstanceLoopCharacteristics') {
        const hasCard = loop.loopCardinality && loop.loopCardinality.body;
        const hasColl = cam(loop, 'collection');
        if (!hasCard && !hasColl) add('ERROR', `Multi-instance ${t} ${nameOf(el, id)} has neither loopCardinality nor a collection. Fix: set loopCardinality or camunda:collection (+ camunda:elementVariable).`);
      }

      const isThrow = t === 'IntermediateThrowEvent' || t === 'EndEvent';
      for (const def of el.eventDefinitions || []) {
        const dt = shortType(def);
        if (dt === 'TimerEventDefinition') {
          const specs = [['timeDate', def.timeDate], ['timeDuration', def.timeDuration], ['timeCycle', def.timeCycle]].filter(([, v]) => v);
          if (!specs.length) add('ERROR', `Timer event ${nameOf(el, id)} has no timeDate/timeDuration/timeCycle. Fix: add one (e.g. <bpmn:timeDuration>PT15M</bpmn:timeDuration>).`);
          for (const [kind, ex] of specs) { const bad = badTimer(kind, ex.body || ''); if (bad) add('ERROR', `Timer event ${nameOf(el, id)}: ${bad}. Fix: ${kind === 'timeCycle' ? 'R3/PT10M or a cron' : kind === 'timeDuration' ? 'an ISO-8601 duration like PT15M / P1D' : 'an ISO-8601 datetime like 2026-01-01T12:00:00Z'}.`); }
        }
        if (dt === 'MessageEventDefinition' && !def.messageRef) add(isThrow ? 'INFO' : 'WARN', `Message ${isThrow ? 'throw' : 'catch'} event ${nameOf(el, id)} has no messageRef. ${isThrow ? 'A throwing message in C7 needs an implementation or is a no-op.' : 'Correlation is by message name.'} Fix: reference a <bpmn:message>${isThrow ? ' and/or set an implementation' : ''}.`);
        if (dt === 'SignalEventDefinition' && !def.signalRef) add('WARN', `Signal event ${nameOf(el, id)} has no signalRef. Fix: reference a <bpmn:signal>.`);
        if (dt === 'ErrorEventDefinition') {
          if (isThrow && !def.errorRef) add('ERROR', `Error throw event ${nameOf(el, id)} has no errorRef. Fix: reference a <bpmn:error> with an errorCode.`);
          if (def.errorRef) { const err = errorsById.get(def.errorRef.id) || def.errorRef; if (err && !err.errorCode) add('WARN', `Error ${err.name ? `"${err.name}"` : `#${err.id}`} referenced by ${nameOf(el, id)} has no errorCode. Camunda matches by errorCode. Fix: set an errorCode.`); }
        }
        if (dt === 'EscalationEventDefinition' && def.escalationRef && !escalations.has(def.escalationRef.id)) add('WARN', `Escalation event ${nameOf(el, id)} references an escalation not declared at root. Fix: add a <bpmn:escalation>.`);
        if (dt === 'ConditionalEventDefinition' && !(def.condition && def.condition.body)) add('WARN', `Conditional event ${nameOf(el, id)} has no condition expression. Fix: add a <bpmn:condition>.`);
      }
    }

    // Structural checks per container (process + each sub-process).
    structuralFindings(proc, add, true);
    const walkSub = (c) => { for (const el of c.flowElements || []) if (isSubProcess(el)) { structuralFindings(el, add, false); walkSub(el); } };
    walkSub(proc);
  }

  // Collaboration: message flows must cross pools.
  const collab = (defs.rootElements || []).find((r) => shortType(r) === 'Collaboration');
  if (collab) {
    const partOf = new Map();
    for (const p of collab.participants || []) { if (!p.processRef) continue; const walk = (c) => { for (const el of c.flowElements || []) { partOf.set(el.id, p.id); if (el.flowElements) walk(el); } }; walk(p.processRef); }
    for (const mf of collab.messageFlows || []) { const s = mf.sourceRef && mf.sourceRef.id, t = mf.targetRef && mf.targetRef.id; if (s && t && partOf.get(s) && partOf.get(s) === partOf.get(t)) add('WARN', `INTERNAL MESSAGE FLOW: message flow #${mf.id} connects two nodes in the same pool; message flows must cross pools. Use a sequence flow.`); }
  }

  // A4: stubs / form-stubs listed RECURSIVELY across all containers.
  const allNodes = [];
  for (const proc of processes) { const collect = (c) => { for (const el of c.flowElements || []) { allNodes.push(el); if (el.flowElements) collect(el); } }; collect(proc); }
  const stubs = allNodes.filter(isStub).map((el) => (el.name ? `"${el.name}"` : `#${el.id}`));
  if (stubs.length) add('INFO', `Stub activit${stubs.length > 1 ? 'ies' : 'y'} (placeholder to build separately): ${stubs.join(', ')}. Put each in the follow-up spec. NOTE: a deployed process WAITS forever at an external-task stub (no worker) — the skeleton deploys but won't run end-to-end until built.`);
  const formStubs = allNodes.filter(isFormStub).map((el) => (el.name ? `"${el.name}"` : `#${el.id}`));
  if (formStubs.length) add('INFO', `Form stub(s) (user-task form to create separately): ${formStubs.join(', ')}. Put each in the spec; the camunda:formRef points at a form that doesn't exist yet (Tasklist shows "form not found" until built).`);

  const anyAsync = allNodes.some((el) => camBool(el, 'asyncBefore') || camBool(el, 'asyncAfter'));
  const serviceCount = allNodes.filter((el) => /^(ServiceTask|SendTask|BusinessRuleTask)$/.test(shortType(el))).length;
  if (!anyAsync && serviceCount >= 2) add('INFO', 'No async boundaries (camunda:asyncBefore/After) anywhere. For reliability the engine should be able to retry/save state at risky points — consider asyncBefore on service tasks calling external systems and before wait states. (Optional for simple synchronous flows.)');

  const ord = { ERROR: 0, WARN: 1, INFO: 2 };
  findings.sort((a, b) => ord[a.sev] - ord[b.sev]);
  return findings;
}

/* ------------------------------ diff and find ------------------------------ */

const descOf = (el) => ({ id: el.id, name: el.name || null, type: shortType(el) });

function containersOf(defs) {
  const out = [];
  const collect = (c) => { if (!c.flowElements) return; out.push(c); for (const el of c.flowElements) if (el.flowElements) collect(el); };
  for (const root of rootDefs(defs, 'Process')) collect(root);
  return out;
}

function flowElemMap(defs) {
  const map = new Map();
  for (const c of containersOf(defs)) for (const el of c.flowElements || []) if (!map.has(el.id)) map.set(el.id, el);
  return map;
}

export async function diffModels(xmlA, xmlB) {
  const A = (await parseBpmn(xmlA)).defs, B = (await parseBpmn(xmlB)).defs;
  const ma = flowElemMap(A), mb = flowElemMap(B);
  const res = { added: [], removed: [], renamed: [], retyped: [], rewired: [], implChanged: [] };
  const isFlow = (el) => shortType(el) === 'SequenceFlow';
  for (const [id, el] of mb) if (!ma.has(id)) res.added.push(descOf(el));
  for (const [id, el] of ma) if (!mb.has(id)) res.removed.push(descOf(el));
  for (const [id, a] of ma) {
    const b = mb.get(id); if (!b) continue;
    if (shortType(a) !== shortType(b)) res.retyped.push({ id, from: shortType(a), to: shortType(b) });
    else if (!isFlow(a) && (a.name || '') !== (b.name || '')) res.renamed.push({ id, from: a.name || '', to: b.name || '' });
    if (isFlow(a) && isFlow(b)) {
      const ea = `${a.sourceRef && a.sourceRef.id}->${a.targetRef && a.targetRef.id}`, eb = `${b.sourceRef && b.sourceRef.id}->${b.targetRef && b.targetRef.id}`;
      if (ea !== eb) res.rewired.push({ id, from: ea, to: eb });
    }
    // Camunda-specific: implementation changed (delegate/topic/decisionRef/etc.).
    const ia = implOf(a), ib = implOf(b);
    if (ia !== undefined && ia !== ib) res.implChanged.push({ id, from: ia, to: ib });
  }
  return res;
}

export async function findModel(xml, term) {
  const { defs } = await parseBpmn(xml);
  const t = (term || '').toLowerCase(); const out = [];
  for (const c of containersOf(defs)) for (const el of c.flowElements || []) {
    const name = (el.name || '').toLowerCase(), type = shortType(el).toLowerCase();
    if (!t || name.includes(t) || type.includes(t)) out.push(descOf(el));
  }
  return out;
}

/* --------------------------------- layout ---------------------------------- */
// Ported from the bpmn skill, but every FINAL document is parsed/serialized with
// makeModdle() (camunda descriptor) so camunda: extensions survive. DI is rebuilt
// from coordinates inside that document — no XML grafting.

function normalizeFlowRefs(defs) {
  for (const c of containersOf(defs)) {
    for (const el of c.flowElements) if (isFlowNode(el)) { el.incoming = []; el.outgoing = []; }
    for (const fe of c.flowElements) { if (shortType(fe) !== 'SequenceFlow') continue; const { sourceRef: s, targetRef: t } = fe; if (s && isFlowNode(s)) s.outgoing.push(fe); if (t && isFlowNode(t)) t.incoming.push(fe); }
  }
}

const POOL_LABEL_W = 30, POOL_MARGIN = 30, POOL_GAP = 60;

function allElementsById(defs) {
  const map = new Map(); const add = (el) => { if (el && el.id) map.set(el.id, el); };
  for (const root of defs.rootElements || []) {
    if (shortType(root) === 'Collaboration') { for (const p of root.participants || []) add(p); for (const mf of root.messageFlows || []) add(mf); }
    if (shortType(root) === 'Process') { const walk = (c) => { for (const ls of c.laneSets || []) for (const lane of ls.lanes || []) add(lane); for (const el of c.flowElements || []) { add(el); if (el.flowElements) walk(el); } }; add(root); walk(root); }
  }
  return map;
}

function readPlaneCoords(plane) {
  const shapes = [], edges = [];
  for (const pe of plane.planeElement || []) {
    if (localName(pe) === 'BPMNShape' && pe.bounds && pe.bpmnElement) shapes.push({ id: pe.bpmnElement.id, x: pe.bounds.x, y: pe.bounds.y, width: pe.bounds.width, height: pe.bounds.height, isExpanded: pe.isExpanded === true });
    else if (localName(pe) === 'BPMNEdge' && pe.bpmnElement) edges.push({ id: pe.bpmnElement.id, waypoints: (pe.waypoint || []).map((w) => ({ x: w.x, y: w.y })) });
  }
  return { shapes, edges };
}

const bboxOf = (shapes) => {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) { minX = Math.min(minX, s.x); minY = Math.min(minY, s.y); maxX = Math.max(maxX, s.x + s.width); maxY = Math.max(maxY, s.y + s.height); }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
};

function addShapeAbs(moddle, plane, el, b, isExpanded) {
  const shape = moddle.create('bpmndi:BPMNShape', { id: el.id + '_di', bpmnElement: el, bounds: moddle.create('dc:Bounds', b) });
  if (isExpanded) shape.isExpanded = true;
  plane.planeElement.push(shape);
  return shape;
}

function addPlaneCoords(moddle, plane, elemById, data, dx, dy) {
  for (const s of data.shapes) { const el = elemById.get(s.id); if (!el) continue; addShapeAbs(moddle, plane, el, { x: s.x + dx, y: s.y + dy, width: s.width, height: s.height }, s.isExpanded); }
  for (const e of data.edges) { const el = elemById.get(e.id); if (!el) continue; plane.planeElement.push(moddle.create('bpmndi:BPMNEdge', { id: el.id + '_di', bpmnElement: el, waypoint: e.waypoints.map((p) => moddle.create('dc:Point', { x: p.x + dx, y: p.y + dy })) })); }
}

async function singleProcessXml(semXml, processId) {
  const m = makeModdle();
  const { rootElement: d } = await m.fromXML(semXml);
  d.rootElements = (d.rootElements || []).filter((r) => shortType(r) === 'Process' && r.id === processId);
  d.diagrams = [];
  return (await m.toXML(d)).xml;
}

// Plain single process: rebuild DI from auto-layout coords into the camunda doc.
async function generateSingleLayout(semXml, layoutProcess) {
  const moddle = makeModdle();
  const { rootElement: defs } = await moddle.fromXML(semXml);
  const proc = rootDefs(defs, 'Process')[0];
  const elemById = allElementsById(defs);
  const laidXml = await layoutProcess(semXml);
  const lm = makeModdle();
  const { rootElement: laid } = await lm.fromXML(laidXml);
  defs.diagrams = [];
  for (const d of laid.diagrams || []) {
    if (!d.plane || !d.plane.bpmnElement) continue;
    const container = elemById.get(d.plane.bpmnElement.id) || proc;
    const plane = moddle.create('bpmndi:BPMNPlane', { id: 'BPMNPlane_' + container.id, bpmnElement: container, planeElement: [] });
    addPlaneCoords(moddle, plane, elemById, readPlaneCoords(d.plane), 0, 0);
    defs.diagrams.push(moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_' + container.id, plane }));
  }
  return (await moddle.toXML(defs, { format: true })).xml;
}

async function generateCollaborationLayout(semXml, layoutProcess) {
  const moddle = makeModdle();
  const { rootElement: defs } = await moddle.fromXML(semXml);
  const collab = (defs.rootElements || []).find((r) => shortType(r) === 'Collaboration');
  const elemById = allElementsById(defs);
  const collabPlane = moddle.create('bpmndi:BPMNPlane', { id: 'BPMNPlane_' + collab.id, bpmnElement: collab, planeElement: [] });
  defs.diagrams = [moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_' + collab.id, plane: collabPlane })];
  const pools = []; let cursorY = 0;
  const BLACKBOX_W = 600, BLACKBOX_H = 100;
  for (const p of collab.participants || []) {
    if (!p.processRef) {
      // Black-box participant (no process): bpmn-auto-layout ignores it, so give it
      // its own empty pool band here — otherwise message flows to it have no anchor.
      const pool = moddle.create('bpmndi:BPMNShape', { id: p.id + '_di', bpmnElement: p, isHorizontal: true, bounds: moddle.create('dc:Bounds', { x: 0, y: cursorY, width: BLACKBOX_W, height: BLACKBOX_H }) });
      collabPlane.planeElement.push(pool); pools.push(pool);
      cursorY += BLACKBOX_H + POOL_GAP;
      continue;
    }
    const lm = makeModdle();
    const { rootElement: laid } = await lm.fromXML(await layoutProcess(await singleProcessXml(semXml, p.processRef.id)));
    const mainPlane = (laid.diagrams || []).find((d) => d.plane && d.plane.bpmnElement && d.plane.bpmnElement.id === p.processRef.id);
    const main = mainPlane ? readPlaneCoords(mainPlane.plane) : { shapes: [], edges: [] };
    const bb = bboxOf(main.shapes);
    const dx = POOL_LABEL_W + POOL_MARGIN - (isFinite(bb.minX) ? bb.minX : 0);
    const dy = cursorY + POOL_MARGIN - (isFinite(bb.minY) ? bb.minY : 0);
    const poolW = (isFinite(bb.width) ? bb.width : 200) + POOL_MARGIN * 2 + POOL_LABEL_W;
    const poolH = (isFinite(bb.height) ? bb.height : 100) + POOL_MARGIN * 2;
    const pool = moddle.create('bpmndi:BPMNShape', { id: p.id + '_di', bpmnElement: p, isHorizontal: true, bounds: moddle.create('dc:Bounds', { x: 0, y: cursorY, width: poolW, height: poolH }) });
    collabPlane.planeElement.push(pool); pools.push(pool);
    addPlaneCoords(moddle, collabPlane, elemById, main, dx, dy);
    for (const d of laid.diagrams || []) {
      if (!d.plane || !d.plane.bpmnElement || d.plane.bpmnElement.id === p.processRef.id) continue;
      const sub = elemById.get(d.plane.bpmnElement.id); if (!sub) continue;
      const subPlane = moddle.create('bpmndi:BPMNPlane', { id: 'BPMNPlane_' + sub.id, bpmnElement: sub, planeElement: [] });
      addPlaneCoords(moddle, subPlane, elemById, readPlaneCoords(d.plane), 0, 0);
      defs.diagrams.push(moddle.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_' + sub.id, plane: subPlane }));
    }
    cursorY += poolH + POOL_GAP;
  }
  if (pools.length) { const maxW = Math.max(...pools.map((p) => p.bounds.width)); for (const p of pools) p.bounds.width = maxW; }
  const boundsIn = (id) => { const s = collabPlane.planeElement.find((pe) => pe.bpmnElement && pe.bpmnElement.id === id && pe.bounds); return s ? s.bounds : null; };
  for (const mf of collab.messageFlows || []) {
    const s = boundsIn(mf.sourceRef && mf.sourceRef.id), t = boundsIn(mf.targetRef && mf.targetRef.id); if (!s || !t) continue;
    const [from, to] = s.y <= t.y ? [{ x: s.x + s.width / 2, y: s.y + s.height }, { x: t.x + t.width / 2, y: t.y }] : [{ x: s.x + s.width / 2, y: s.y }, { x: t.x + t.width / 2, y: t.y + t.height }];
    collabPlane.planeElement.push(moddle.create('bpmndi:BPMNEdge', { id: mf.id + '_di', bpmnElement: mf, waypoint: [moddle.create('dc:Point', from), moddle.create('dc:Point', to)] }));
  }
  return (await moddle.toXML(defs, { format: true })).xml;
}

const LANE_LABEL_W = 30, LANE_PAD = 20, LANE_H = 150;
const lanesOf = (proc) => { const out = []; for (const ls of proc.laneSets || []) for (const lane of ls.lanes || []) out.push(lane); return out; };

function orthoWaypoints(moddle, a, b) {
  const P = (x, y) => moddle.create('dc:Point', { x, y });
  const ay = a.y + a.height / 2, by = b.y + b.height / 2, ax = a.x + a.width, bx = b.x;
  if (Math.abs(ay - by) < 1) return [P(ax, ay), P(bx, by)];
  const midX = Math.round((ax + bx) / 2);
  return [P(ax, ay), P(midX, ay), P(midX, by), P(bx, by)];
}

async function generateLanedLayout(semXml, layoutProcess) {
  const lm = makeModdle();
  const { rootElement: laid } = await lm.fromXML(await layoutProcess(semXml));
  const base = readPlaneCoords(laid.diagrams[0].plane);
  if (!base.shapes.length) return await generateSingleLayout(semXml, layoutProcess);
  const fm = makeModdle();
  const { rootElement: defs } = await fm.fromXML(semXml);
  const elemById = allElementsById(defs);
  const proc = rootDefs(defs, 'Process').find((r) => lanesOf(r).length) || rootDefs(defs, 'Process')[0];
  const lanes = lanesOf(proc);
  const laneOfNode = new Map();
  for (const lane of lanes) for (const ref of lane.flowNodeRef || []) laneOfNode.set(ref.id, lane.id);
  const plane = fm.create('bpmndi:BPMNPlane', { id: 'BPMNPlane_' + proc.id, bpmnElement: proc, planeElement: [] });
  defs.diagrams = [fm.create('bpmndi:BPMNDiagram', { id: 'BPMNDiagram_' + proc.id, plane })];
  const minX = Math.min(...base.shapes.map((s) => s.x)), maxRight = Math.max(...base.shapes.map((s) => s.x + s.width));
  const laneW = maxRight - minX + LANE_PAD * 2, dx = LANE_LABEL_W + LANE_PAD - minX;
  const bandTop = new Map();
  lanes.forEach((lane, i) => { const y = i * LANE_H; bandTop.set(lane.id, y); const sh = addShapeAbs(fm, plane, elemById.get(lane.id), { x: LANE_LABEL_W, y, width: laneW, height: LANE_H }, false); sh.isHorizontal = true; });
  for (const s of base.shapes) { const el = elemById.get(s.id); if (!el) continue; const top = bandTop.has(laneOfNode.get(s.id)) ? bandTop.get(laneOfNode.get(s.id)) : 0; addShapeAbs(fm, plane, el, { x: s.x + dx, y: top + (LANE_H - s.height) / 2, width: s.width, height: s.height }, s.isExpanded); }
  const boundsIn = (id) => { const sh = plane.planeElement.find((pe) => pe.bpmnElement && pe.bpmnElement.id === id && pe.bounds); return sh ? sh.bounds : null; };
  for (const fe of proc.flowElements || []) { if (shortType(fe) !== 'SequenceFlow') continue; const a = boundsIn(fe.sourceRef && fe.sourceRef.id), b = boundsIn(fe.targetRef && fe.targetRef.id); if (a && b) plane.planeElement.push(fm.create('bpmndi:BPMNEdge', { id: fe.id + '_di', bpmnElement: fe, waypoint: orthoWaypoints(fm, a, b) })); }
  return (await fm.toXML(defs, { format: true })).xml;
}

async function generateLayout(xml) {
  const { layoutProcess } = await import('bpmn-auto-layout');
  const moddle = makeModdle();
  const { rootElement: defs } = await moddle.fromXML(xml);
  const collab = (defs.rootElements || []).find((r) => shortType(r) === 'Collaboration');
  const lanedProc = rootDefs(defs, 'Process').find((r) => lanesOf(r).length);
  const hasFlow = rootDefs(defs, 'Process').some((p) => (p.flowElements || []).length);
  if (!collab && !hasFlow) throw new Error('nothing to lay out: no process flow elements');
  defs.diagrams = [];
  normalizeFlowRefs(defs);
  const { xml: normalized } = await moddle.toXML(defs);
  if (collab) return await generateCollaborationLayout(normalized, layoutProcess);
  if (lanedProc) return await generateLanedLayout(normalized, layoutProcess);
  return await generateSingleLayout(normalized, layoutProcess);
}

function pruneDI(defs) {
  defs.diagrams = (defs.diagrams || []).filter((d) => d.plane && d.plane.bpmnElement);
  for (const d of defs.diagrams) d.plane.planeElement = (d.plane.planeElement || []).filter((pe) => pe.bpmnElement);
}

const GAP = 50;
const sizeFor = (t) => (/Event$/.test(t) ? { width: 36, height: 36 } : /Gateway$/.test(t) ? { width: 50, height: 50 } : { width: 100, height: 80 });
const overlaps = (a, b, tol = 4) => a.x < b.x + b.width - tol && a.x + a.width - tol > b.x && a.y < b.y + b.height - tol && a.y + a.height - tol > b.y;
const boundsOf = (plane, id) => { if (!id) return null; const s = (plane.planeElement || []).find((pe) => pe.bpmnElement && pe.bpmnElement.id === id && pe.bounds); return s ? s.bounds : null; };
function diIndex(defs) { const has = new Set(); for (const d of defs.diagrams || []) for (const pe of (d.plane && d.plane.planeElement) || []) if (pe.bpmnElement) has.add(pe.bpmnElement.id); return has; }
function planesByContainer(defs) { const map = new Map(); for (const d of defs.diagrams || []) if (d.plane && d.plane.bpmnElement) map.set(d.plane.bpmnElement.id, d.plane); return map; }
function makeShape(moddle, plane, el, x, y, width, height) { const shape = moddle.create('bpmndi:BPMNShape', { id: el.id + '_di', bpmnElement: el, bounds: moddle.create('dc:Bounds', { x, y, width, height }) }); (plane.planeElement || (plane.planeElement = [])).push(shape); return shape; }
function nudge(plane, box) { const others = (plane.planeElement || []).filter((pe) => pe.bounds).map((pe) => pe.bounds); let tries = 0; while (tries++ < 500 && others.some((o) => overlaps(box, o))) box.y += box.height + 30; return box; }

function placeNode(moddle, plane, el, flows) {
  const { width, height } = sizeFor(shortType(el));
  if (shortType(el) === 'BoundaryEvent' && el.attachedToRef) { const b = boundsOf(plane, el.attachedToRef.id); if (b) { makeShape(moddle, plane, el, b.x + b.width / 2 - width / 2, b.y + b.height - height / 2, width, height); return true; } }
  let up = null, down = null;
  for (const f of flows) { if (!up && f.targetRef && f.targetRef.id === el.id) up = boundsOf(plane, f.sourceRef && f.sourceRef.id) || null; if (!down && f.sourceRef && f.sourceRef.id === el.id) down = boundsOf(plane, f.targetRef && f.targetRef.id) || null; }
  if (up && down && down.x >= up.x) {
    const x = up.x + up.width + GAP, delta = width + GAP;
    for (const pe of plane.planeElement || []) if (pe.bounds && pe.bounds.x >= down.x) pe.bounds.x += delta;
    makeShape(moddle, plane, el, ...Object.values(nudge(plane, { x, y: up.y + up.height / 2 - height / 2, width, height }))); return true;
  }
  const anchor = up || down; if (!anchor) return false;
  const x = up ? anchor.x + anchor.width + GAP : anchor.x - GAP - width;
  makeShape(moddle, plane, el, ...Object.values(nudge(plane, { x, y: anchor.y + anchor.height / 2 - height / 2, width, height }))); return true;
}
function placeRightmost(moddle, plane, el) { const { width, height } = sizeFor(shortType(el)); let maxRight = 0; for (const pe of plane.planeElement || []) if (pe.bounds) maxRight = Math.max(maxRight, pe.bounds.x + pe.bounds.width); makeShape(moddle, plane, el, maxRight + GAP, 30, width, height); }
function addEdge(moddle, plane, flow) { const s = boundsOf(plane, flow.sourceRef && flow.sourceRef.id), t = boundsOf(plane, flow.targetRef && flow.targetRef.id); if (!s || !t) return; (plane.planeElement || (plane.planeElement = [])).push(moddle.create('bpmndi:BPMNEdge', { id: flow.id + '_di', bpmnElement: flow, waypoint: orthoWaypoints(moddle, s, t) })); }
const pointNearBounds = (p, b, tol = 12) => p.x >= b.x - tol && p.x <= b.x + b.width + tol && p.y >= b.y - tol && p.y <= b.y + b.height + tol;
function rerouteStaleEdges(defs, moddle) {
  const planeOf = planesByContainer(defs);
  for (const c of containersOf(defs)) { const plane = planeOf.get(c.id); if (!plane) continue; for (const pe of plane.planeElement || []) { if (localName(pe) !== 'BPMNEdge' || !pe.bpmnElement || shortType(pe.bpmnElement) !== 'SequenceFlow') continue; const s = boundsOf(plane, pe.bpmnElement.sourceRef && pe.bpmnElement.sourceRef.id), t = boundsOf(plane, pe.bpmnElement.targetRef && pe.bpmnElement.targetRef.id); if (!s || !t) continue; const wp = pe.waypoint || []; const ok = wp.length >= 2 && pointNearBounds(wp[0], s) && pointNearBounds(wp[wp.length - 1], t); if (!ok) pe.waypoint = orthoWaypoints(moddle, s, t); } }
}
function addDI(defs, moddle) {
  const has = diIndex(defs); const planeOf = planesByContainer(defs);
  for (const c of containersOf(defs)) {
    const plane = planeOf.get(c.id); if (!plane) continue;
    const flows = (c.flowElements || []).filter((el) => shortType(el) === 'SequenceFlow');
    let pending = (c.flowElements || []).filter((el) => !has.has(el.id) && isFlowNode(el));
    let guard = pending.length + 2;
    while (pending.length && guard-- > 0) { const still = pending.filter((el) => !placeNode(moddle, plane, el, flows)); if (still.length === pending.length) { for (const el of still) placeRightmost(moddle, plane, el); break; } pending = still; }
    for (const fe of flows) if (!has.has(fe.id)) addEdge(moddle, plane, fe);
  }
}

export async function validateModel(xml) {
  const { defs, warnings } = await parseBpmn(xml);
  const diIds = new Set(); const planeContainers = new Set(); const expandedById = new Map(); const planeShapeSets = [];
  for (const d of defs.diagrams || []) {
    const plane = d.plane; if (!plane) continue;
    if (plane.bpmnElement) { diIds.add(plane.bpmnElement.id); planeContainers.add(plane.bpmnElement.id); }
    const shapes = [];
    for (const pe of plane.planeElement || []) { if (pe.bpmnElement) diIds.add(pe.bpmnElement.id); if (localName(pe) === 'BPMNShape' && pe.bounds && pe.bpmnElement) { shapes.push({ type: shortType(pe.bpmnElement), id: pe.bpmnElement.id, b: pe.bounds }); expandedById.set(pe.bpmnElement.id, pe.isExpanded === true); } }
    planeShapeSets.push(shapes);
  }
  const isAtom = (t) => ((/Event$/.test(t) && t !== 'BoundaryEvent') || /Task$/.test(t) || /Gateway$/.test(t) || t === 'CallActivity');
  const overlapsFound = [];
  for (const shapes of planeShapeSets) { const atoms = shapes.filter((s) => isAtom(s.type)); for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) if (overlaps({ ...atoms[i].b }, atoms[j].b, 2)) overlapsFound.push(`${atoms[i].type}#${atoms[i].id} <> ${atoms[j].type}#${atoms[j].id}`); }
  const missing = [];
  const walk = (container) => { for (const el of container.flowElements || []) { const core = isFlowNode(el) || shortType(el) === 'SequenceFlow'; if (core && !diIds.has(el.id)) missing.push(label(el)); const detailed = isSubProcess(el) && (expandedById.get(el.id) === true || planeContainers.has(el.id)); if (el.flowElements && (!isSubProcess(el) || detailed)) walk(el); } };
  for (const root of rootDefs(defs, 'Process')) walk(root);
  return { ok: !(warnings.length || missing.length || overlapsFound.length), warnings: warnings.map((w) => w.message), missing, overlaps: overlapsFound };
}

function addArtifactEdge(moddle, plane, el, srcId, tgtId) { const a = boundsOf(plane, srcId), b = boundsOf(plane, tgtId); if (!a || !b) return; plane.planeElement.push(moddle.create('bpmndi:BPMNEdge', { id: el.id + '_di', bpmnElement: el, waypoint: orthoWaypoints(moddle, a, b) })); }
function dataAnchor(container, dataId, plane) { for (const el of container.flowElements || []) { for (const a of el.dataOutputAssociations || []) if (a.targetRef && a.targetRef.id === dataId) { const b = boundsOf(plane, el.id); if (b) return b; } for (const a of el.dataInputAssociations || []) for (const s of a.sourceRef || []) if (s.id === dataId) { const b = boundsOf(plane, el.id); if (b) return b; } } return null; }
function annotationAnchor(container, annId, plane) { for (const ar of container.artifacts || []) { if (shortType(ar) !== 'Association') continue; if (ar.targetRef && ar.targetRef.id === annId) { const b = boundsOf(plane, ar.sourceRef && ar.sourceRef.id); if (b) return b; } if (ar.sourceRef && ar.sourceRef.id === annId) { const b = boundsOf(plane, ar.targetRef && ar.targetRef.id); if (b) return b; } } return null; }

async function placeExtras(xml) {
  const { defs, moddle } = await parseBpmn(xml);
  const has = diIndex(defs); const planeOf = planesByContainer(defs); let changed = false;
  for (const c of containersOf(defs)) {
    const plane = planeOf.get(c.id); if (!plane) continue;
    for (const el of c.flowElements || []) {
      const t = shortType(el); if ((t !== 'DataObjectReference' && t !== 'DataStoreReference') || has.has(el.id)) continue;
      const size = t === 'DataStoreReference' ? { width: 50, height: 50 } : { width: 36, height: 50 };
      const anchor = dataAnchor(c, el.id, plane);
      const b = nudge(plane, { ...(anchor ? { x: anchor.x + anchor.width / 2 - size.width / 2, y: anchor.y + anchor.height + 50 } : { x: 100, y: 250 }), ...size });
      makeShape(moddle, plane, el, b.x, b.y, b.width, b.height); changed = true;
    }
    for (const el of c.artifacts || []) {
      if (shortType(el) !== 'TextAnnotation' || has.has(el.id)) continue;
      const size = { width: 120, height: 40 }; const anchor = annotationAnchor(c, el.id, plane);
      const b = nudge(plane, { ...(anchor ? { x: anchor.x + anchor.width + 50, y: Math.max(0, anchor.y - 50) } : { x: 100, y: 0 }), ...size });
      makeShape(moddle, plane, el, b.x, b.y, b.width, b.height); changed = true;
    }
    for (const el of c.artifacts || []) { if (shortType(el) !== 'Association' || has.has(el.id)) continue; addArtifactEdge(moddle, plane, el, el.sourceRef && el.sourceRef.id, el.targetRef && el.targetRef.id); changed = true; }
    for (const el of c.flowElements || []) {
      for (const a of el.dataOutputAssociations || []) { if (has.has(a.id)) continue; addArtifactEdge(moddle, plane, a, el.id, a.targetRef && a.targetRef.id); changed = true; }
      for (const a of el.dataInputAssociations || []) { if (has.has(a.id)) continue; addArtifactEdge(moddle, plane, a, a.sourceRef && a.sourceRef[0] && a.sourceRef[0].id, el.id); changed = true; }
    }
  }
  return changed ? (await moddle.toXML(defs, { format: true })).xml : xml;
}

export async function layoutModel(xml, opts = {}) {
  const { defs, moddle } = await parseBpmn(xml);
  const hasDI = (defs.diagrams || []).length > 0;
  let out;
  if (opts.rebuild || !hasDI) out = await generateLayout(xml);
  else { pruneDI(defs); addDI(defs, moddle); rerouteStaleEdges(defs, moddle); out = (await moddle.toXML(defs, { format: true })).xml; }
  return await placeExtras(out);
}
