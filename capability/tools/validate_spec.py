#!/usr/bin/env python3
"""validate_spec.py — schema + V-rule lint for cultural benchmark specs.

Usage: python3 validate_spec.py <benchmark_spec.json> [--schema <BENCHMARK_SCHEMA.json>]
Exit 0 = pass (warnings allowed), 1 = hard error.
Structural checks only (no jsonschema dependency): required top-level fields, PLACEHOLDER
discipline, and a small set of CF predicates from THREATS.md/RUBRIC.md.
"""
import json, sys, re, os

def load(p):
    with open(p, 'r', encoding='utf-8') as f:
        return json.load(f)

REQUIRED = ["benchmark_identity","research_question","construct","communities","languages",
"modalities","sampling_plan","data_provenance","consent_and_governance","task_definitions",
"annotation_protocol","metrics","baselines","reliability_plan","validity_plan","bias_audits",
"privacy_risks","leakage_risks","known_limitations","version_history","community_review_status"]

def err(msg): print("ERROR:", msg); return 1
def ok(msg): print("#", msg)

def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    spec = load(sys.argv[1])
    problems, warnings = [], []

    # 1. required top-level fields
    for k in REQUIRED:
        if k not in spec: problems.append(f"missing top-level field: {k}")
    if problems:
        print("HARD ERRORS:"); [print(" -", p) for p in problems]; return 1
    ok(f"all {len(REQUIRED)} required top-level fields present")

    # 2. PLACEHOLDER discipline: bare synonyms for placeholders are forbidden
    text = json.dumps(spec, ensure_ascii=False)
    for syn in ["\\bTBD\\b", "\\bFIXME\\b", "\\bto be determined\\b", "\\bapprox\\b"]:
        hits = re.findall(syn, text, re.IGNORECASE)
        if hits: problems.append(f"placeholder synonym {syn!r} used {len(hits)}x — use PLACEHOLDER + what_is_needed")
    if problems:
        print("HARD ERRORS:"); [print(" -", p) for p in problems]; return 1
    ok("placeholder discipline: only PLACEHOLDER tokens used")

    # 3. CF predicates (structural, static — findings are WARNINGS unless marked HARD)
    comm = spec.get("communities", {})
    npst = comm.get("nationality_proxy_statement", "")
    if not npst:
        warnings.append("CF-1 risk: no nationality_proxy_statement")
    geo = spec.get("data_provenance", {})
    if geo.get("translation_share", 0) > 0 and not comm.get("nationality_proxy_statement"):
        warnings.append("CF-2 risk: translation_share>0 without original-language provenance note")
    rubs = spec.get("annotation_protocol", {}).get("rubrics", [])
    if rubs:
        names = " ".join(json.dumps(r).lower() for r in rubs)
        if "factual" in names and "adaptation" not in names and "safety" not in names:
            warnings.append("CF-3 risk: rubrics only factual/accuracy — no adaptation/safety axis")
    dp = spec.get("annotation_protocol", {}).get("disagreement_policy", {})
    if dp.get("aggregation_rule", "").startswith("majority") and not dp.get("dissent_log"):
        problems.append("CF-5: majority aggregation without dissent_log")
    for layer in spec.get("annotation_protocol", {}).get("layers", []):
        if layer.get("layer") == "llm_judge" and not layer.get("quality_control"):
            problems.append("CF-6: llm_judge layer without quality_control/validation")
    lr = spec.get("leakage_risks", {})
    if not lr.get("private_holdout"):
        warnings.append("leakage: no private holdout declared")
    if problems:
        print("HARD ERRORS:"); [print(" -", p) for p in problems]; return 1
    if warnings:
        print("WARNINGS:"); [print(" -", w) for w in warnings]
    ok("CF predicates: " + ("clean" if not warnings else f"{len(warnings)} warning(s), see above"))
    json.dump({"spec": sys.argv[1], "warnings": warnings}, open(os.path.join(os.path.dirname(sys.argv[1]) or ".", ".validate_last.json"), "w"))
    print("PASS")
    return 0

if __name__ == "__main__":
    sys.exit(main())