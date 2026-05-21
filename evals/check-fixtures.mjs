#!/usr/bin/env node
/**
 * check-fixtures.mjs - deterministic pre-grader for the camunda7 eval fixtures.
 *
 * The behavioural cases in evals.json are LLM-graded, but their *inputs* must be
 * correct for the grading to mean anything: the "validate & fix" case is only
 * valid if its input actually fails to deploy, and an "assemble from the catalog"
 * case is only valid if the catalog parses and carries the conventions the run is
 * expected to follow. This script asserts those input invariants with the skill's
 * own tools (plus a JSON/YAML sanity check), so a broken fixture is caught without
 * spending an LLM run.
 *
 * Run from the repo root:  node evals/check-fixtures.mjs
 * (Requires `npm install` in skills/camunda7/ so the tools' deps are present.)
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseBpmn, validateModel, lintModel, layoutModel } from '../skills/camunda7/scripts/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const filesDir = join(here, 'files');
const read = (name) => readFileSync(join(filesDir, name), 'utf-8');

let failures = 0;
const check = (label, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) failures++;
};
const errors = (findings) => findings.filter((f) => f.sev === 'ERROR');

// A valid engine base must parse, validate, lint clean of ERRORs, and keep its
// camunda: extensions across a layout round-trip.
async function healthy(name) {
  const xml = read(name);
  check(`${name} parses without warnings`, (await parseBpmn(xml)).warnings.length === 0);
  check(`${name} validates`, (await validateModel(xml)).ok === true);
  check(`${name} lints with no ERROR`, errors(await lintModel(xml)).length === 0);
  const out = await layoutModel(xml, { rebuild: true });
  check(`${name} keeps camunda: extensions through layout`, /camunda:/.test(out));
  check(`${name} validates after a clean layout`, (await validateModel(out)).ok === true);
}

async function main() {
  // valid engine bases the cases extend / explain / infer from
  await healthy('invoice.bpmn');     // extend-error-and-escalation + explain-readonly
  await healthy('infer-base.bpmn');  // infer-conventions-no-catalog

  // expense.bpmn is a pre-engine plain process (no camunda: yet) the run makes executable
  check('expense.bpmn parses without warnings', (await parseBpmn(read('expense.bpmn'))).warnings.length === 0);
  check('expense.bpmn validates', (await validateModel(read('expense.bpmn'))).ok === true);

  // order-process.bpmn is the deliberately-broken "validate & fix" input
  check('order-process.bpmn lints with an ERROR (broken input)',
    errors(await lintModel(read('order-process.bpmn'))).length >= 1);

  // catalogs must parse and carry the conventions the assembly runs follow
  for (const name of readdirSync(filesDir).filter((f) => f.endsWith('-catalog.json')).sort()) {
    let cat = null;
    try { cat = JSON.parse(read(name)); } catch { /* cat stays null */ }
    check(`${name} is valid JSON with conventions + historyTimeToLive`,
      !!cat && typeof cat === 'object' && !!cat.conventions && JSON.stringify(cat).includes('historyTimeToLive'));
  }
  const yaml = read('notify-catalog.yaml');
  check('notify-catalog.yaml carries validateOrder + notifyCustomer + historyTimeToLive',
    ['validateOrder', 'notifyCustomer', 'historyTimeToLive'].every((k) => yaml.includes(k)));

  // every fixture referenced by evals.json must resolve from the repo root
  const evals = JSON.parse(readFileSync(join(here, 'evals.json'), 'utf-8'));
  const refs = evals.evals.flatMap((e) => e.files || []);
  const repoRoot = dirname(here);
  const missing = refs.filter((r) => !existsSync(join(repoRoot, r)));
  check(`all ${refs.length} fixtures referenced by evals.json resolve`, missing.length === 0);
  if (missing.length) console.log('   missing:', missing.join(', '));

  console.log(failures ? `\n${failures} FAILED` : '\nAll fixture invariants hold.');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
