/** Phase 3 — CLI contract: exit codes, flags, and file writing the skill loop relies on. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proc, CLEAN, EXPR } from './builders.mjs';

const TOOL = fileURLToPath(new URL('../scripts/camunda-tool.mjs', import.meta.url));
const run = (...args) => spawnSync('node', [TOOL, ...args], { encoding: 'utf8' });

const ERROR_XML = proc(`
  <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
  <bpmn:serviceTask id="T" name="X"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
  <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
  <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/>`);
const INFO_XML = proc(`
  <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
  <bpmn:serviceTask id="T" name="Stubbed" camunda:type="external" camunda:topic="t">
    <bpmn:extensionElements><camunda:properties><camunda:property name="stub" value="true"/></camunda:properties></bpmn:extensionElements>
    <bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
  <bpmn:endEvent id="E"><bpmn:incoming>b</bpmn:incoming></bpmn:endEvent>
  <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="T"/><bpmn:sequenceFlow id="b" sourceRef="T" targetRef="E"/>`);

let dir, clean, errf, infof, laid;
before(() => {
  dir = mkdtempSync(join(tmpdir(), 'cam7-cli-'));
  clean = join(dir, 'clean.bpmn'); writeFileSync(clean, CLEAN);
  errf = join(dir, 'err.bpmn'); writeFileSync(errf, ERROR_XML);
  infof = join(dir, 'info.bpmn'); writeFileSync(infof, INFO_XML);
  laid = join(dir, 'laid.bpmn');
  run('layout', clean, laid); // produce a laid-out file for the validate test
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('lint exits 0 on a clean process', () => {
  const r = run('lint', clean);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /No problems found/);
});

test('lint exits 1 when there is an ERROR', () => {
  const r = run('lint', errf);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /error\(s\)/);
});

test('lint exits 0 when findings are INFO-only (advisory, not blocking)', () => {
  const r = run('lint', infof);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /info/);
});

test('validate exits 0 on a laid-out file and 1 when DI is missing', () => {
  const ok = run('validate', laid);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /VALID/);
  const bad = run('validate', clean); // CLEAN has no diagram
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /Missing layout/);
});

test('summarize --json emits parseable JSON', () => {
  const r = run('summarize', clean, '--json');
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.ok(Array.isArray(data.processes) && data.processes.length === 1);
});

test('layout writes to an out path and leaves the input untouched', () => {
  const out = join(dir, 'out.bpmn');
  const before = readFileSync(clean, 'utf8');
  const r = run('layout', clean, out);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out));
  assert.match(readFileSync(out, 'utf8'), /BPMNShape/);
  assert.equal(readFileSync(clean, 'utf8'), before, 'input file is unchanged when an out path is given');
  assert.match(r.stdout, /Layout/);
});

test('summarize (text mode) prints the process outline', () => {
  const r = run('summarize', clean);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Process "P"/);
  assert.match(r.stdout, /Activities:/);
});

test('diff prints the semantic delta between two files', () => {
  const r = run('diff', clean, errf);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Diff|No semantic differences/);
});

test('find lists matching elements and reports none gracefully', () => {
  const hit = run('find', clean, 'review');
  assert.equal(hit.status, 0, hit.stderr);
  assert.match(hit.stdout, /match/i);
  const miss = run('find', clean, 'zzz-nope');
  assert.equal(miss.status, 0);
  assert.match(miss.stdout, /No elements match/);
});

test('an unknown command exits 2 with usage', () => {
  const r = run('frobnicate', clean);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Usage/);
});
