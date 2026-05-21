/** Phase 5 — golden-corpus invariants over the shipped .bpmn files.
 * Catches engine regressions against real files (not just hand-built fixtures):
 *  - everything parses;
 *  - anything with DI validates;
 *  - camunda extensions survive a layout round-trip;
 *  - the shipped template lints clean and validates once laid out;
 *  - the intentionally-broken eval input still lints with an ERROR.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBpmn, validateModel, lintModel, layoutModel } from '../scripts/lib.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const evalDir = join(root, 'evals', 'files');
const assetDir = join(root, 'assets');
const bpmnIn = (d) => readdirSync(d).filter((f) => f.endsWith('.bpmn')).map((f) => join(d, f));
const files = [...bpmnIn(evalDir), ...bpmnIn(assetDir)];
const sevCount = (findings, s) => findings.filter((f) => f.sev === s).length;

test('corpus is non-empty (sanity)', () => {
  assert.ok(files.length >= 3, `expected shipped .bpmn files, found ${files.length}`);
});

for (const file of files) {
  const name = basename(file);
  test(`corpus[${name}]: parses, validates-if-laid-out, preserves camunda through layout`, async () => {
    const xml = readFileSync(file, 'utf8');
    const { warnings } = await parseBpmn(xml);
    assert.equal(warnings.length, 0, `${name} parses without warnings: ${warnings.map((w) => w.message)}`);

    const hasDI = /<\w*:?BPMNDiagram\b/.test(xml);
    if (hasDI) {
      const v = await validateModel(xml);
      assert.equal(v.ok, true, `${name} has DI so it should validate: ${JSON.stringify(v)}`);
    }
    if (xml.includes('camunda:')) {
      const out = await layoutModel(xml, { rebuild: true });
      assert.match(out, /camunda:/, `${name} must keep camunda extensions through layout`);
      assert.equal((await validateModel(out)).ok, true, `${name} validates after a clean layout`);
    }
  });
}

test('the shipped process template lints clean and validates once laid out', async () => {
  const xml = readFileSync(join(assetDir, 'process.template.bpmn'), 'utf8');
  const findings = await lintModel(xml);
  assert.equal(sevCount(findings, 'ERROR'), 0, 'template has no ERROR');
  assert.equal(sevCount(findings, 'WARN'), 0, 'template has no WARN');
  const out = await layoutModel(xml, { rebuild: true });
  assert.equal((await validateModel(out)).ok, true);
});

test('the intentionally-broken eval input lints with an ERROR', async () => {
  const xml = readFileSync(join(evalDir, 'order-process.bpmn'), 'utf8');
  assert.ok(sevCount(await lintModel(xml), 'ERROR') >= 1, 'order-process.bpmn should still be caught as broken');
});
