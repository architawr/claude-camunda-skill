/**
 * Shared test builders. NOT a test file itself — the `test` script globs
 * `test/*.test.mjs`, so this is only ever imported, never run as a suite.
 *
 * These keep the XML fixtures terse and readable. To embed a literal JUEL
 * expression inside a template literal, write `${EXPR('ok')}` -> `${ok}`.
 */
import { lintModel } from '../scripts/lib.mjs';

export const EXPR = (body) => '${' + body + '}'; // literal ${body} without fighting template literals

export const defs = (body, roots = '') => `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
  xmlns:camunda="http://camunda.org/schema/1.0/bpmn" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  id="d" targetNamespace="t">${roots}${body}</bpmn:definitions>`;

export const proc = (inner, attrs = 'isExecutable="true" camunda:historyTimeToLive="P30D"') =>
  defs(`<bpmn:process id="p" name="P" ${attrs}>${inner}</bpmn:process>`);

// process + sibling root elements (errors/messages/signals/escalations).
export const procRoots = (inner, roots, attrs = 'isExecutable="true" camunda:historyTimeToLive="P30D"') =>
  defs(`<bpmn:process id="p" name="P" ${attrs}>${inner}</bpmn:process>`, roots);

export const lintMsgs = async (xml) => (await lintModel(xml)).map((f) => `${f.sev} ${f.msg}`).join('\n');
export const sev = async (xml, s) => (await lintModel(xml)).filter((f) => f.sev === s);

// A clean, fully-wired process used as the happy-path baseline.
export const CLEAN = proc(`
  <bpmn:startEvent id="S"><bpmn:outgoing>a</bpmn:outgoing></bpmn:startEvent>
  <bpmn:serviceTask id="Svc" name="Do" camunda:delegateExpression="${EXPR('do')}" camunda:asyncBefore="true"><bpmn:incoming>a</bpmn:incoming><bpmn:outgoing>b</bpmn:outgoing></bpmn:serviceTask>
  <bpmn:userTask id="U" name="Review" camunda:candidateGroups="g" camunda:formRef="f" camunda:formRefBinding="latest"><bpmn:incoming>b</bpmn:incoming><bpmn:outgoing>c</bpmn:outgoing></bpmn:userTask>
  <bpmn:endEvent id="E"><bpmn:incoming>c</bpmn:incoming></bpmn:endEvent>
  <bpmn:sequenceFlow id="a" sourceRef="S" targetRef="Svc"/>
  <bpmn:sequenceFlow id="b" sourceRef="Svc" targetRef="U"/>
  <bpmn:sequenceFlow id="c" sourceRef="U" targetRef="E"/>`);
