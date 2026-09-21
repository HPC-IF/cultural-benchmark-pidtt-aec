#!/usr/bin/env python3
"""audit_spec.py — T5 audit_benchmark_bias (static input).

Usage: python3 audit_spec.py <package_dir | spec.json>
Walks the package looking for bias red flags (T5 checks 1-11). Writes audits/bias_audit.json.
Human findings go into audits/bias_audit_overlay.json; this script only automates the checkable.
"""
import json, os, sys
from datetime import date

def has(spec, dotted):
    cur = spec
    for p in dotted.split('.'):
        if isinstance(cur, dict) and p in cur: cur = cur[p]
        else: return False
    return True

def audit(pkg, spec):
    f = []  # (id, severity, finding)
    t = json.dumps(spec, ensure_ascii=False)
    # 1 nationality proxy
    if not spec.get('communities', {}).get('nationality_proxy_statement'):
        f.append(("BIAS-1", "high", "no nationality_proxy_statement — nation-as-culture risk"))
    # 2 translation as grounding
    ts = spec.get('data_provenance', {}).get('translation_share', 0)
    if ts and 'native_subsample' not in t:
        f.append(("BIAS-2", "high", f"translation_share={ts} with no native_subsample plan"))
    # 3 stereo keys
    if 'correct_answer' in t or 'expected_answer' in t:
        f.append(("BIAS-3", "high", "answer-key phrasing in spec — stereo-key risk on community items"))
    # 4 single urban sample
    sp = spec.get('sampling_plan', {})
    strata = sp.get('strata', [])
    if strata and len(strata) == 1 and 'national' in t.lower():
        f.append(("BIAS-4", "high", "1 stratum + national claim — tokenism/overclaim"))
    # 5 majority aggregation
    dp = spec.get('annotation_protocol', {}).get('disagreement_policy', {})
    if dp.get('aggregation_rule', '').startswith('majority') and not dp.get('dissent_log'):
        f.append(("BIAS-5", "high", "majority aggregation without dissent_log"))
    # 6 unvalidated llm judge
    for layer in spec.get('annotation_protocol', {}).get('layers', []):
        if layer.get('layer') == 'llm_judge' and not layer.get('quality_control'):
            f.append(("BIAS-6", "high", "unvalidated llm_judge layer"))
    # 7 rater pool composition
    dp_desc = json.dumps(dp).lower()
    if 'rater' in dp_desc and 'single' in dp_desc:
        f.append(("BIAS-7", "medium", "rater pool described as single-source"))
    # 8 leakage
    if not spec.get('leakage_risks', {}).get('private_holdout'):
        f.append(("BIAS-8", "medium", "no private holdout declared"))
    # 9 consent
    cg = spec.get('consent_and_governance', {})
    for k in ('withdrawal_procedure', 'consent_instrument', 'ownership'):
        if not cg.get(k):
            f.append(("BIAS-9", "medium", f"consent_and_governance missing {k}"))
    # 10 communities section with no PLACEHOLDER may hide invented facts
    if isinstance(spec.get('communities'), dict):
        cs = json.dumps(spec['communities'])
        if 'PLACEHOLDER' not in cs:
            f.append(("BIAS-10", "low", "community section has no PLACEHOLDER — check no invented community fact exists"))
    # 11 unspecified escalations
    if 'escalation' not in t:
        f.append(("BIAS-11", "medium", "no escalation path for harmful/abstention cases"))
    return f

def main():
    if len(sys.argv) < 2: print(__doc__); sys.exit(2)
    target = sys.argv[1]
    if target.endswith('.json'):
        spec = json.load(open(target, encoding='utf-8')); pkg = os.path.dirname(target) or '.'
    else:
        pkg = target.rstrip('/')
        sp = os.path.join(pkg, 'benchmark_spec.json')
        if not os.path.exists(sp):
            print('no benchmark_spec.json in package'); sys.exit(1)
        spec = json.load(open(sp, encoding='utf-8'))
    findings = [{"id": i, "severity": s, "finding": x} for i, s, x in audit(pkg, spec)]
    os.makedirs(os.path.join(pkg, 'audits'), exist_ok=True)
    out = {"date": date.today().isoformat(), "target": target, "findings": findings,
           "note": "static audit only — human/community audit must be appended"}
    op = os.path.join(pkg, 'audits', 'bias_audit.json')
    json.dump(out, open(op, 'w', encoding='utf-8'), indent=2, ensure_ascii=False)
    print('findings:', len(findings), '->', op)
    for x in findings: print(' -', x['id'], x['severity'], x['finding'])

if __name__ == '__main__':
    main()