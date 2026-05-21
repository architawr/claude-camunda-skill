#!/usr/bin/env node
/**
 * camunda-tool.mjs - CLI for the `camunda7` skill. Thin wrapper around lib.mjs,
 * which holds all the mechanics (Camunda 7 aware: camunda: extensions are parsed,
 * preserved through layout, and lint checks engine execution-readiness).
 *
 *   summarize <file.bpmn> [--json]      Outline + per-node camunda implementation, stubs, async, historyTTL
 *   layout    <in.bpmn> [out] [--rebuild]
 *                                       Safe layout (preserves camunda: extensions AND existing DI);
 *                                       --rebuild forces a full regeneration from scratch.
 *   validate  <file.bpmn>               Parse; flag missing shapes, overlaps, parse warnings
 *   lint      <file.bpmn>               Control-flow + structural + Camunda execution problems
 *   diff      <a.bpmn> <b.bpmn>         Semantic + implementation diff
 *   find      <file.bpmn> <term>        Find flow elements by name/type
 *
 * Run `npm install` once in the skill root before using.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import {
  summarizeText, summarizeJson, layoutModel, validateModel, lintModel,
  diffModels, findModel,
} from './lib.mjs';

async function summarize(path, asJson) {
  const xml = readFileSync(path, 'utf-8');
  if (asJson) console.log(JSON.stringify(await summarizeJson(xml), null, 2));
  else console.log(await summarizeText(xml));
}

async function layout(inPath, outPath, rebuild) {
  const xml = readFileSync(inPath, 'utf-8');
  const hadDI = /<\w*:?BPMNDiagram\b/.test(xml);
  const out = await layoutModel(xml, { rebuild });
  const dest = outPath || inPath;
  writeFileSync(dest, out, 'utf-8');
  const mode = rebuild || !hadDI ? 'generated from scratch' : 'preserved & re-synced existing DI';
  console.log(`Layout ${mode}, camunda: extensions preserved -> ${dest}`);
}

async function validate(path) {
  const xml = readFileSync(path, 'utf-8');
  let r;
  try { r = await validateModel(xml); }
  catch (err) { console.error(`INVALID: parse failed - ${err.message}`); process.exit(1); }
  if (r.warnings.length) { console.log(`Warnings (${r.warnings.length}):`); for (const w of r.warnings) console.log(`  ! ${w}`); }
  if (r.missing.length) { console.log(`Missing layout for ${r.missing.length} element(s) - run \`layout\` to fix:`); for (const m of r.missing) console.log(`  - ${m}`); }
  if (r.overlaps.length) { console.log(`Overlapping shapes (${r.overlaps.length}) - re-run \`layout --rebuild\`:`); for (const o of r.overlaps.slice(0, 12)) console.log(`  - ${o}`); }
  if (r.ok) console.log('VALID: parses cleanly, every flow element has a shape, and no shapes overlap.');
  else process.exit(1);
}

async function lint(path) {
  const xml = readFileSync(path, 'utf-8');
  const findings = await lintModel(xml);
  if (!findings.length) { console.log('No problems found: control flow is sound and every activity/event is Camunda-executable.'); return; }
  const errs = findings.filter((f) => f.sev === 'ERROR').length;
  const warns = findings.filter((f) => f.sev === 'WARN').length;
  console.log(`Found ${findings.length} issue(s): ${errs} error(s), ${warns} warning(s), ${findings.length - errs - warns} info.`);
  for (const f of findings) console.log(`  [${f.sev}] ${f.msg}`);
  if (errs + warns > 0) process.exit(1); // ERROR/WARN block "done"; INFO is advisory
}

async function diff(aPath, bPath) {
  const d = await diffModels(readFileSync(aPath, 'utf-8'), readFileSync(bPath, 'utf-8'));
  const desc = (e) => `${e.name ? JSON.stringify(e.name) + ' ' : ''}[${e.type} #${e.id}]`;
  const out = [];
  if (d.added.length) { out.push(`Added (${d.added.length}):`); for (const e of d.added) out.push(`  + ${desc(e)}`); }
  if (d.removed.length) { out.push(`Removed (${d.removed.length}):`); for (const e of d.removed) out.push(`  - ${desc(e)}`); }
  if (d.renamed.length) { out.push(`Renamed (${d.renamed.length}):`); for (const r of d.renamed) out.push(`  ~ #${r.id}: ${JSON.stringify(r.from)} -> ${JSON.stringify(r.to)}`); }
  if (d.retyped.length) { out.push(`Retyped (${d.retyped.length}):`); for (const r of d.retyped) out.push(`  ~ #${r.id}: ${r.from} -> ${r.to}`); }
  if (d.rewired.length) { out.push(`Rewired flows (${d.rewired.length}):`); for (const r of d.rewired) out.push(`  ~ #${r.id}: ${r.from} => ${r.to}`); }
  if (d.implChanged.length) { out.push(`Implementation changed (${d.implChanged.length}):`); for (const r of d.implChanged) out.push(`  ~ #${r.id}: ${r.from || '(none)'} => ${r.to || '(none)'}`); }
  console.log(out.length ? `Diff ${aPath} -> ${bPath}\n${out.join('\n')}` : 'No semantic differences.');
}

async function find(path, term) {
  const hits = await findModel(readFileSync(path, 'utf-8'), term);
  if (!hits.length) { console.log(`No elements match ${JSON.stringify(term || '')}.`); return; }
  console.log(`${hits.length} match(es):`);
  for (const h of hits) console.log(`  - ${h.name ? JSON.stringify(h.name) + ' ' : ''}[${h.type} #${h.id}]`);
}

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flags = argv.filter((a) => a.startsWith('--'));
  const [a, b] = argv.slice(1).filter((a) => !a.startsWith('--'));
  try {
    if (cmd === 'summarize' && a) await summarize(a, flags.includes('--json'));
    else if (cmd === 'layout' && a) await layout(a, b, flags.includes('--rebuild'));
    else if (cmd === 'validate' && a) await validate(a);
    else if (cmd === 'lint' && a) await lint(a);
    else if (cmd === 'diff' && a && b) await diff(a, b);
    else if (cmd === 'find' && a) await find(a, b);
    else {
      console.error('Usage:');
      console.error('  node camunda-tool.mjs summarize <file.bpmn> [--json]');
      console.error('  node camunda-tool.mjs layout    <in.bpmn> [out.bpmn] [--rebuild]');
      console.error('  node camunda-tool.mjs validate  <file.bpmn>');
      console.error('  node camunda-tool.mjs lint      <file.bpmn>');
      console.error('  node camunda-tool.mjs diff      <a.bpmn> <b.bpmn>');
      console.error('  node camunda-tool.mjs find      <file.bpmn> <term>');
      process.exit(2);
    }
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

main();
