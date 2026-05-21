#!/usr/bin/env python3
"""Programmatic grader for the camunda7 skill evals (assembly edition).

Checks: existing activities wired from the catalog, missing ones represented as
marked STUBs with an I/O contract, a follow-up spec produced, NO activity
implementation code generated, plus validate/lint and control-flow fixes.
Discovers config dirs dynamically (with_skill vs old_skill/without_skill).

Usage: python3 grade.py <iteration-dir>
"""
import json, re, subprocess, sys, math
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent  # repo root (this file lives in dev/)
TOOL = str(REPO / "skills" / "camunda7" / "scripts" / "camunda-tool.mjs")
EVAL_ORDER = ["text-to-executable-loan", "bpmn-to-executable-external",
              "extend-error-and-escalation", "validate-and-fix-order",
              "prompt-context-extends-catalog", "prompt-catalog-conflict",
              "assemble-dmn", "multi-instance-fulfilment", "collaboration-two-pools",
              "lanes-and-roles", "infer-conventions-no-catalog", "flexible-catalog-yaml",
              "explain-readonly", "scale-order-to-cash"]
EVAL_ID = {n: i for i, n in enumerate(EVAL_ORDER)}
PREFER = {"text-to-executable-loan": "loan", "bpmn-to-executable-external": "expense",
          "extend-error-and-escalation": "invoice", "validate-and-fix-order": "order",
          "prompt-context-extends-catalog": "notify", "prompt-catalog-conflict": "pay",
          "assemble-dmn": "risk", "multi-instance-fulfilment": "fulfilment",
          "collaboration-two-pools": "collab", "lanes-and-roles": "quote",
          "infer-conventions-no-catalog": "infer-base", "flexible-catalog-yaml": "notify",
          "explain-readonly": "invoice", "scale-order-to-cash": "o2c"}
CODE_EXT = {".java", ".js", ".ts", ".py", ".kt", ".rb", ".go", ".cs", ".php", ".groovy"}


def run_tool(cmd, f):
    p = subprocess.run(["node", TOOL, cmd, str(f)], capture_output=True, text=True)
    return p.returncode, (p.stdout + p.stderr)


def summarize(f):
    p = subprocess.run(["node", TOOL, "summarize", str(f), "--json"], capture_output=True, text=True)
    try:
        return json.loads(p.stdout)
    except Exception:
        return {"processes": []}


def find_bpmn(outputs, prefer):
    files = sorted(outputs.glob("*.bpmn")) if outputs.is_dir() else []
    if not files:
        return None
    bad = ("original", "input", "copy", "backup", "-old", ".orig", "source", "pristine")
    # exact <prefer>.bpmn wins
    for f in files:
        if f.name == prefer + ".bpmn":
            return f
    # a file mentioning prefer that isn't an obvious untouched copy of the input
    cand = [f for f in files if prefer in f.name and not any(b in f.name.lower() for b in bad)]
    if cand:
        return cand[0]
    cand = [f for f in files if not any(b in f.name.lower() for b in bad)]
    return cand[0] if cand else files[0]


def output_files(outputs):
    return [f for f in outputs.iterdir() if f.is_file()] if outputs.is_dir() else []


def spec_text(run_dir):
    cands = []
    for base in [run_dir / "outputs", run_dir]:
        if base.is_dir():
            for f in base.glob("*.md"):
                if f.name == "transcript.md":
                    continue
                cands.append(f)
    for f in cands:
        t = f.read_text(errors="replace")
        if len(t) > 50:
            return t
    return None


def acts_of(s):
    return [a for p in s.get("processes", []) for a in p.get("activities", [])]


def ends_of(s):
    return [e for p in s.get("processes", []) for e in p.get("end", [])]


def proc0(s):
    ps = s.get("processes", [])
    return ps[0] if ps else {}


def count_nodes(s):
    n = 0
    for p in s.get("processes", []):
        for k in ("start", "end", "intermediate", "boundary", "activities", "gateways", "subprocesses"):
            n += len(p.get(k, []))
    return n


def user_tasks(s):
    return [a for a in acts_of(s) if a.get("type") == "UserTask"]


def read_transcript(run_dir):
    for c in [run_dir / "transcript.md", run_dir / "outputs" / "transcript.md"]:
        if c.exists():
            return c.read_text(errors="replace").lower()
    return ""


def grade_explain(run_dir, assertions):
    """Read-only eval: grade the explanation; assert the input wasn't rewritten."""
    transcript = read_transcript(run_dir)
    outputs = run_dir / "outputs"
    bpmns = list(outputs.glob("*.bpmn")) if outputs.is_dir() else []
    orig = REPO / "evals" / "files" / "invoice.bpmn"
    orig_text = orig.read_text(errors="replace") if orig.exists() else None
    impl = any(k in transcript for k in ["delegate", "chargecustomer", "asyncbefore", "candidategroups", "topic", "external task", "${"])
    risk = any(k in transcript for k in ["risk", "wait", "retry", "boundary", "error", "узк", "ждет", "ретрай", "ожида", "осторож", "watch", "deadlock"])
    readonly = (len(bpmns) == 0) or (orig_text is not None and all(b.read_text(errors="replace") == orig_text for b in bpmns))
    R = [
        (impl, f"explanation covers runtime implementation={impl}"),
        (risk, f"flags a runtime risk/watch-out={risk}"),
        (readonly, f"read-only (input not rewritten); bpmn outputs={[b.name for b in bpmns] or 'none'}"),
    ]
    exps = [{"text": assertions[i], "passed": bool(p), "evidence": ev} for i, (p, ev) in enumerate(R)]
    return write_grading(run_dir, exps)


def grade_run(eval_name, run_dir):
    outputs = run_dir / "outputs"
    meta = json.loads((run_dir.parent / "eval_metadata.json").read_text())
    assertions = meta["assertions"]
    if eval_name == "explain-readonly":
        return grade_explain(run_dir, assertions)
    bpmn = find_bpmn(outputs, PREFER[eval_name])
    if not bpmn:
        return write_grading(run_dir, [{"text": a, "passed": False, "evidence": "No .bpmn output found."} for a in assertions])

    text = bpmn.read_text(errors="replace")
    s = summarize(bpmn)
    vrc, _ = run_tool("validate", bpmn)
    lrc, lout = run_tool("lint", bpmn)
    valid, lint_ok = vrc == 0, lrc == 0
    httl = proc0(s).get("historyTimeToLive")
    executable = proc0(s).get("executable")
    has_cam = "http://camunda.org/schema/1.0/bpmn" in text
    no_zeebe = "zeebe" not in text.lower()
    acts, ends = acts_of(s), ends_of(s)
    stubs = [a for a in acts if a.get("stub")]
    has_io = "inputParameter" in text or "outputParameter" in text
    files = output_files(outputs)
    code_files = [f.name for f in files if f.suffix.lower() in CODE_EXT]
    spec = spec_text(run_dir)
    transcript = ""
    for c in [run_dir / "transcript.md", outputs / "transcript.md"]:
        if c.exists():
            transcript = c.read_text(errors="replace").lower(); break

    R = []
    if eval_name == "text-to-executable-loan":
        R.append((has_cam and bool(executable) and httl is not None, f"camunda={has_cam}, isExecutable={executable}, httl={httl}"))
        w1 = 'delegateExpression="${creditScoring}"' in text
        w2 = 'delegateExpression="${disburseFunds}"' in text
        R.append((w1 and w2, f"creditScoring wired={w1}, disburseFunds wired={w2}"))
        R.append((len(stubs) >= 1 and has_io, f"stubs={[a['name'] for a in stubs]}, io contract present={has_io}"))
        R.append((not code_files, f"code files in outputs={code_files or 'none'}"))
        R.append((bool(spec) and ("input" in spec.lower() or "stub" in spec.lower()), f"spec present={bool(spec)}"))
        gw_default = bool(re.search(r"exclusiveGateway[^>]*\sdefault=", text))
        R.append((gw_default and "credit-analysts" in text and len(ends) >= 2, f"gw default={gw_default}, credit-analysts={'credit-analysts' in text}, ends={len(ends)}"))
        fw = 'formRef="loanReviewForm"' in text
        R.append((fw, f"loanReviewForm wired to review user task={fw}"))
        conds = [fl.get("condition") for p in s.get("processes", []) for fl in p.get("flows", []) if fl.get("condition")]
        juel = all("${" in c for c in conds) if conds else True
        R.append((valid and lint_ok and no_zeebe and juel, f"validate={vrc}, lint={lrc}, no_zeebe={no_zeebe}, juel={juel}"))
        cv_ttl = 'historyTimeToLive="P90D"' in text
        cv_retry = "R5/PT10M" in text
        cv_vars = "applicantId" in text and "creditScore" in text and "approved" in text
        R.append((cv_ttl and cv_retry and cv_vars, f"P90D={cv_ttl}, R5/PT10M={cv_retry}, catalog vars={cv_vars}"))

    elif eval_name == "bpmn-to-executable-external":
        names = " | ".join([(a["name"] or "") for a in acts] + [(g["name"] or "") for p in s.get("processes", []) for g in p.get("gateways", [])])
        struct = all(k.lower() in names.lower() for k in ["Check policy", "Manager approval", "Reimburse"]) and len(ends) >= 2
        R.append((has_cam and struct, f"camunda={has_cam}; nodes=[{names}]; ends={len(ends)}"))
        R.append(('topic="check-policy"' in text, f'check-policy wired={chr(39)+"topic=" + chr(34) + "check-policy" + chr(34)+chr(39) in text}'))
        reimburse_stub = any("reimburse" in (a["name"] or "").lower() and a.get("stub") for a in acts)
        R.append((reimburse_stub and has_io, f"Reimburse is stub={reimburse_stub}, io={has_io}"))
        R.append((not code_files, f"code files in outputs={code_files or 'none'}"))
        R.append((bool(spec), f"spec present={bool(spec)}"))
        mgr = bool(re.search(r'candidateGroups="[^"]*managers', text))
        R.append((mgr and httl is not None and bool(executable), f"managers={mgr}, httl={httl}, exec={executable}"))
        fstub = 'name="formStub"' in text and "formRef" in text
        R.append((fstub, f"Manager approval form-stub present (formStub marker + formRef)={fstub}"))
        R.append((valid and lint_ok and no_zeebe, f"validate={vrc}, lint={lrc}, no_zeebe={no_zeebe}"))
        cv_ttl = 'historyTimeToLive="P90D"' in text
        cv_vars = "expenseId" in text and "policyOk" in text
        R.append((cv_ttl and cv_vars, f"P90D={cv_ttl}, catalog vars={cv_vars}"))

    elif eval_name == "extend-error-and-escalation":
        err = 'errorCode="PAYMENT_FAILED"' in text and "errorEventDefinition" in text and "boundaryEvent" in text
        pf_end = any("payment failed" in (e["name"] or "").lower() for e in ends)
        R.append((err and pf_end, f"PAYMENT_FAILED boundary={err}, 'Payment failed' end={pf_end}"))
        R.append(('topic="notify-customer"' in text, f"notify-customer wired={'topic=' + chr(34) + 'notify-customer' in text}"))
        timer = 'cancelActivity="false"' in text and "timerEventDefinition" in text and bool(re.search(r"<bpmn:timeDuration[^>]*>\s*P", text))
        mgr_stub = len(stubs) >= 1
        R.append((timer and mgr_stub, f"non-interrupting ISO timer={timer}, manager stub present={mgr_stub} ({[a['name'] for a in stubs]})"))
        R.append((not code_files and bool(spec), f"code files={code_files or 'none'}, spec present={bool(spec)}"))
        keep = ('delegateExpression="${chargeCustomer}"' in text and 'asyncBefore="true"' in text and 'candidateGroups="finance"' in text and httl is not None)
        R.append((keep, f"chargeCustomer/asyncBefore/finance/httl preserved={keep} (httl={httl})"))
        fw = 'formRef="invoiceApprovalForm"' in text
        R.append((fw, f"invoiceApprovalForm wired to Approve invoice={fw}"))
        R.append((valid and lint_ok and has_cam and no_zeebe, f"validate={vrc}, lint={lrc}, camunda={has_cam}, no_zeebe={no_zeebe}"))
        cv = 'errorCode="PAYMENT_FAILED"' in text and "invoiceId" in text
        R.append((cv, f"PAYMENT_FAILED + invoiceId from catalog={cv}"))

    elif eval_name == "validate-and-fix-order":
        pgw = len(re.findall(r"<bpmn:parallelGateway", text))
        R.append((pgw >= 2, f"parallelGateway count={pgw} (>=2 means XOR join changed to parallel); lint={lrc}"))
        w1 = 'delegateExpression="${reserveStock}"' in text
        w2 = 'topic="charge-card"' in text
        R.append((w1 and w2, f"reserveStock wired={w1}, charge-card topic={w2}"))
        R.append(("2 days" not in text and bool(re.search(r"<bpmn:timeDuration[^>]*>\s*P", text)), "timer fixed to ISO"))
        R.append((httl is not None, f"historyTimeToLive={httl}"))
        R.append((valid and lint_ok and has_cam, f"validate={vrc}, lint={lrc}, camunda={has_cam}"))
        cats = {
            "duplication": any(k in transcript for k in ["token", "duplicat", "дважды", "два раза", "двойн"]),
            "wiring": any(k in transcript for k in ["реализац", "implement", "wire", "привяз", "каталог", "delegate", "topic", "топик"]),
            "timer": any(k in transcript for k in ["timer", "таймер", "2 days", "iso", "p2d", "duration", "длительност"]),
            "httl": any(k in transcript for k in ["historytimetolive", "history time", "ttl", "истори"]),
        }
        R.append((sum(cats.values()) >= 3, f"explanation covers {sum(cats.values())}/4: {cats}"))
        cv_ttl = 'historyTimeToLive="P90D"' in text
        cv_retry = "R5/PT10M" in text
        R.append((cv_ttl and cv_retry, f"catalog defaults applied: P90D={cv_ttl}, R5/PT10M={cv_retry}"))

    elif eval_name == "prompt-context-extends-catalog":
        p90 = 'historyTimeToLive="P90D"' in text
        R.append((has_cam and bool(executable) and p90, f"camunda={has_cam}, exec={executable}, P90D={p90}"))
        wv = 'delegateExpression="${validateOrder}"' in text
        R.append((wv, f"validateOrder wired from catalog={wv}"))
        sms = 'topic="send-sms"' in text
        R.append((sms, f"send-sms used from prompt context={sms}"))
        msg = "PaymentConfirmed" in text and "messageEventDefinition" in text
        R.append((msg, f"PaymentConfirmed message + catch event from prompt={msg}"))
        pv = "customerPhone" in text and "smsId" in text
        R.append((pv, f"prompt-provided variables used (customerPhone, smsId)={pv}"))
        R.append((valid and lint_ok, f"validate={vrc}, lint={lrc}"))
        flagged = any(k in transcript for k in ["from the prompt", "из промпт", "не в каталог", "not in the catalog", "add to the catalog", "добавить в каталог", "to the catalog"])
        R.append((flagged, f"flags prompt-origin / suggests adding to catalog={flagged}"))

    elif eval_name == "prompt-catalog-conflict":
        p90 = 'historyTimeToLive="P90D"' in text
        R.append((has_cam and p90, f"camunda={has_cam}, P90D={p90}"))
        tc = 'topic="charge-card"' in text
        dc = "chargeCardBean" in text
        R.append((tc != dc, f"exactly one charge impl (topic charge-card={tc}, delegate bean={dc})"))
        conflict = any(k in transcript for k in ["конфликт", "conflict", "противореч", "disagree", "несоответств", "catalog says", "catalog defines"]) or ("charge-card" in transcript and "chargecardbean" in transcript)
        R.append((conflict, f"conflict surfaced={conflict}"))
        deliberate = any(k in transcript for k in ["source of truth", "источник истины", "used the catalog", "использовал каталог", "подтверд", "confirm", "уточн", "override", "переопредел"])
        R.append((deliberate, f"deliberate resolution + confirm/flag={deliberate}"))
        R.append((valid and lint_ok and has_cam, f"validate={vrc}, lint={lrc}, camunda={has_cam}"))

    elif eval_name == "assemble-dmn":
        cv_ttl = 'historyTimeToLive="P90D"' in text
        R.append((has_cam and bool(executable) and cv_ttl, f"camunda={has_cam}, exec={executable}, P90D={cv_ttl}"))
        dmn = 'decisionRef="riskDecision"' in text and "businessruletask" in text.lower() and "resultvariable" in text.lower()
        R.append((dmn, f"BusinessRuleTask wired to DMN decisionRef riskDecision + resultVariable={dmn}"))
        R.append(('delegateExpression="${validateApplication}"' in text, "validateApplication wired from catalog"))
        gw = bool(re.search(r"exclusiveGateway[^>]*\sdefault=", text)) and "risk-team" in text and 'formRef="riskReviewForm"' in text
        R.append((gw, f"gateway default + risk-team group + riskReviewForm={gw}"))
        no_gen = not any(f.suffix.lower() == ".dmn" for f in files) and not code_files
        R.append((no_gen, f"no DMN table / code authored (assembler): files={[f.name for f in files]}"))
        R.append((valid and lint_ok and no_zeebe, f"validate={vrc}, lint={lrc}, no_zeebe={no_zeebe}"))

    elif eval_name == "multi-instance-fulfilment":
        cv_ttl = 'historyTimeToLive="P90D"' in text
        R.append((has_cam and cv_ttl, f"camunda={has_cam}, P90D={cv_ttl}"))
        mi = ("multiInstanceLoopCharacteristics" in text
              and bool(re.search(r'collection="(\$\{)?lineItems\}?"', text))
              and bool(re.search(r'elementVariable="(\$\{)?item\}?"', text)))
        R.append((mi, f"multi-instance collection=lineItems + elementVariable=item={mi}"))
        wired = 'delegateExpression="${reserveStock}"' in text and 'delegateExpression="${confirmOrder}"' in text
        R.append((wired, f"reserveStock + confirmOrder wired from catalog={wired}"))
        R.append((valid and lint_ok and no_zeebe, f"validate={vrc}, lint={lrc}, no_zeebe={no_zeebe}"))

    elif eval_name == "collaboration-two-pools":
        parts = len(re.findall(r"<bpmn:participant\b", text))
        mflows = len(re.findall(r"<bpmn:messageFlow\b", text))
        R.append((has_cam and parts >= 2 and mflows >= 1, f"participants={parts}, messageFlows={mflows}"))
        R.append(('delegateExpression="${processOrder}"' in text, "processOrder wired from catalog"))
        msgs = "OrderPlaced" in text and "OrderConfirmed" in text
        R.append((msgs, f"catalog messages OrderPlaced+OrderConfirmed present={msgs}"))
        R.append((valid and lint_ok and no_zeebe, f"validate={vrc}, lint={lrc}, no_zeebe={no_zeebe}"))

    elif eval_name == "lanes-and-roles":
        cv_ttl = 'historyTimeToLive="P90D"' in text
        lanes = len(re.findall(r"<bpmn:lane\b", text))
        R.append((has_cam and cv_ttl and lanes >= 2, f"camunda={has_cam}, P90D={cv_ttl}, lanes={lanes}"))
        groups = bool(re.search(r'candidateGroups="[^"]*sales', text)) and bool(re.search(r'candidateGroups="[^"]*finance', text))
        forms = 'formRef="quoteReviewForm"' in text or 'formRef="discountApprovalForm"' in text
        R.append((groups and forms, f"sales+finance groups={groups}, catalog form wired={forms}"))
        R.append(('delegateExpression="${generateQuote}"' in text, "generateQuote wired from catalog"))
        R.append((valid and lint_ok and no_zeebe, f"validate={vrc}, lint={lrc} (no unassigned), no_zeebe={no_zeebe}"))

    elif eval_name == "infer-conventions-no-catalog":
        R.append(('delegateExpression="${archiveOrder}"' in text, "Archive order wired as delegate ${archiveOrder}"))
        conv = text.count("R3/PT5M") >= 2 and text.count('asyncBefore="true"') >= 2
        R.append((conv, f"inferred conventions applied (R3/PT5M x{text.count('R3/PT5M')}, asyncBefore x{text.count(chr(34).join(['asyncBefore=', 'true', '']))})"))
        R.append(('historyTimeToLive="P120D"' in text, "P120D historyTimeToLive preserved (inferred, not reset)"))
        inferred = any(k in transcript for k in ["infer", "existing process", "convention", "конвенц", "из существ", "из процесс", "вывел", "вывед", "по образц"])
        R.append((inferred, f"follow-up states conventions were inferred={inferred}"))
        R.append((valid and lint_ok and has_cam, f"validate={vrc}, lint={lrc}, camunda={has_cam}"))

    elif eval_name == "flexible-catalog-yaml":
        cv_ttl = 'historyTimeToLive="P90D"' in text
        R.append((has_cam and bool(executable) and cv_ttl, f"camunda={has_cam}, exec={executable}, P90D={cv_ttl}"))
        wired = 'delegateExpression="${validateOrder}"' in text and 'delegateExpression="${notifyCustomer}"' in text
        R.append((wired, f"validateOrder + notifyCustomer wired from YAML catalog={wired}"))
        R.append((valid and lint_ok and no_zeebe, f"validate={vrc}, lint={lrc}, no_zeebe={no_zeebe}"))

    elif eval_name == "scale-order-to-cash":
        nodes = count_nodes(s)
        cv_ttl = 'historyTimeToLive="P90D"' in text
        R.append((has_cam and cv_ttl and nodes >= 12, f"camunda={has_cam}, P90D={cv_ttl}, nodes={nodes}"))
        wiring = (all(('delegateExpression="${' + r + '}"') in text for r in ["validateOrder", "reserveStock", "shipOrder"])
                  and 'topic="charge-card"' in text and 'topic="send-invoice"' in text and 'decisionRef="shippingDecision"' in text)
        R.append((wiring, f"all catalog steps wired (delegates+external topics+DMN)={wiring}"))
        charge_err = "CHARGE_FAILED" in text
        uts = user_tasks(s)
        ut_forms = all((a.get("impl") and "form" in a["impl"].lower()) or a.get("formStub") for a in uts) if uts else True
        R.append((charge_err and ut_forms, f"CHARGE_FAILED handled={charge_err}, user tasks formed={ut_forms} ({len(uts)} user task(s))"))
        R.append((ut_forms, f"every user task has a form or form-stub={ut_forms}"))
        R.append((valid and lint_ok and no_zeebe, f"validate={vrc}, lint={lrc}, no_zeebe={no_zeebe}"))

    exps = [{"text": assertions[i], "passed": bool(p), "evidence": ev} for i, (p, ev) in enumerate(R)]
    return write_grading(run_dir, exps)


def write_grading(run_dir, exps):
    passed = sum(1 for e in exps if e["passed"]); total = len(exps)
    g = {"expectations": exps, "summary": {"passed": passed, "failed": total - passed, "total": total,
                                           "pass_rate": round(passed / total, 4) if total else 0.0}}
    tj = run_dir / "timing.json"
    if tj.exists():
        t = json.loads(tj.read_text())
        g["timing"] = {"total_duration_seconds": t.get("total_duration_seconds", 0.0)}
        g["execution_metrics"] = {"output_chars": t.get("total_tokens", 0)}
    (run_dir / "grading.json").write_text(json.dumps(g, indent=2))
    return g


def stats(v):
    if not v:
        return {"mean": 0, "stddev": 0, "min": 0, "max": 0}
    n = len(v); m = sum(v) / n
    sd = math.sqrt(sum((x - m) ** 2 for x in v) / (n - 1)) if n > 1 else 0.0
    return {"mean": round(m, 4), "stddev": round(sd, 4), "min": round(min(v), 4), "max": round(max(v), 4)}


def main():
    it = Path(sys.argv[1]).resolve()
    runs, lines = [], []
    for name in EVAL_ORDER:
        ed = it / name
        if not ed.is_dir():
            continue
        configs = sorted([d.name for d in ed.iterdir() if (d / "outputs").is_dir()])
        for cfg in configs:
            rd = ed / cfg
            g = grade_run(name, rd)
            t = json.loads((rd / "timing.json").read_text()) if (rd / "timing.json").exists() else {}
            runs.append({"eval_id": EVAL_ID[name], "eval_name": name, "configuration": cfg, "run_number": 1,
                         "result": {"pass_rate": g["summary"]["pass_rate"], "passed": g["summary"]["passed"],
                                    "failed": g["summary"]["failed"], "total": g["summary"]["total"],
                                    "time_seconds": t.get("total_duration_seconds", 0.0),
                                    "tokens": t.get("total_tokens", 0), "tool_calls": 0, "errors": 0},
                         "expectations": g["expectations"], "notes": []})
            lines.append(f"  {name:32s} {cfg:14s} {g['summary']['passed']}/{g['summary']['total']}")

    by = {}
    for r in runs:
        by.setdefault(r["configuration"], []).append(r)
    rs = {c: {"pass_rate": stats([r["result"]["pass_rate"] for r in v]),
              "time_seconds": stats([r["result"]["time_seconds"] for r in v]),
              "tokens": stats([r["result"]["tokens"] for r in v])} for c, v in by.items()}
    primary = "with_skill" if "with_skill" in rs else (list(rs)[0] if rs else None)
    baseline = next((c for c in rs if c != primary), None)
    if primary and baseline:
        rs["delta"] = {
            "pass_rate": f"{rs[primary]['pass_rate']['mean']-rs[baseline]['pass_rate']['mean']:+.2f}",
            "time_seconds": f"{rs[primary]['time_seconds']['mean']-rs[baseline]['time_seconds']['mean']:+.1f}",
            "tokens": f"{rs[primary]['tokens']['mean']-rs[baseline]['tokens']['mean']:+.0f}"}
    order = {"with_skill": 0}
    runs.sort(key=lambda r: (r["eval_id"], order.get(r["configuration"], 1)))
    bench = {"metadata": {"skill_name": "camunda7", "skill_path": str(Path(TOOL).parent.parent),
                          "executor_model": "claude-opus-4-7", "analyzer_model": "claude-opus-4-7",
                          "timestamp": "2026-05-21", "evals_run": sorted(set(r["eval_id"] for r in runs)),
                          "runs_per_configuration": 1},
             "runs": runs, "run_summary": rs, "notes": []}
    (it / "benchmark.json").write_text(json.dumps(bench, indent=2))
    print("Per-run pass counts:"); print("\n".join(lines))
    if primary and baseline:
        print(f"\n{primary}: {rs[primary]['pass_rate']['mean']*100:.0f}%   {baseline}: {rs[baseline]['pass_rate']['mean']*100:.0f}%   delta {rs['delta']['pass_rate']}")
    print(f"benchmark.json -> {it/'benchmark.json'}")


if __name__ == "__main__":
    main()
