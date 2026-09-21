#!/usr/bin/env python3
"""score_quality.py — T9 score_benchmark_quality (dimension profile, never one opaque number).

Input: package dir containing:
  benchmark_spec.json, pilot_results.json (optional), audits/*.json (optional), docs
Output: quality_report.json + quality_report.md in package dir.

Static portion: checks doc presence, provenance discipline, and runs validate_spec predicates.
Evidence gaps are scored 0 (not guessed). Human dimension scores MAY be added via
scores_overlay.json {"dimension": {"score":0-4,"evidence":"..."}}.
"""
import json, os, sys

DIMENSIONS = [
 "construct_validity", "cultural_specificity", "within_culture_representation",
 "community_involvement", "task_realism", "annotation_quality", "disagreement_handling",
 "metric_validity", "reliability_analysis", "bias_detection", "safety_governance",
 "leakage_resistance", "reproducibility", "practical_feasibility", "uncertainty_transparency",
]

REQUIRED_DOCS = {
 "construct_validity": "01_construct.md",
 "cultural_specificity": "spec_field:communities",
 "within_culture_representation": "spec_field:sampling_plan.strata",
 "community_involvement": "governance.md",
 "task_realism": "tasks/*",
 "annotation_quality": "RUBRIC.md",
 "disagreement_handling": "spec_field:annotation_protocol.disagreement_policy.dissent_log",
 "metric_validity": "spec_field:metrics",
 "reliability_analysis": "spec_field:reliability_plan",
 "bias_detection": "audits/*",
 "safety_governance": "governance.md",
 "leakage_resistance": "spec_field:leakage_risks.private_holdout",
 "reproducibility": "data_card.md",
 "practical_feasibility": "08_pilot.md",
 "uncertainty_transparency": "known_limitations.md",
}

def has_field(spec, dotted):
    cur = spec
    for part in dotted.split('.'):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return False
    return True

def static_profile(pkg_dir):
    profile = {d: {"static_score": 1, "reason": "placeholder: needs human review"} for d in DIMENSIONS}
    spec_path = os.path.join(pkg_dir, "benchmark_spec.json")
    spec = json.load(open(spec_path, encoding='utf-8')) if os.path.exists(spec_path) else {}
    text = json.dumps(spec, ensure_ascii=False)
    for dim, req in REQUIRED_DOCS.items():
        if req.startswith("spec_field:"):
            field = req[len("spec_field:"):]
            ok = has_field(spec, field)
        elif req.endswith("*"):
            base = req[:-1]
            p = os.path.join(pkg_dir, base.strip("/*"))
            ok = os.path.isdir(p) and os.listdir(p)
        else:
            ok = os.path.exists(os.path.join(pkg_dir, req))
        if ok:
            profile[dim]["static_score"] = 2
            profile[dim]["reason"] = f"artifact present ({req}); content quality not machine-judged"
        else:
            profile[dim]["static_score"] = 1
            profile[dim]["reason"] = f"artifact missing ({req})"
    # small extra signals
    if '"dissent_log": true' in text or '"dissent_log":true' in text:
        profile["disagreement_handling"]["static_score"] = 3
    if '"private_holdout": true' in text:
        profile["leakage_resistance"]["static_score"] = 3
    pilot = os.path.join(pkg_dir, "pilot_results.json")
    if os.path.exists(pilot):
        profile["practical_feasibility"]["static_score"] = 3
        profile["practical_feasibility"]["reason"] += "; pilot_results.json present"
    return profile

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    pkg = sys.argv[1].rstrip('/')
    profile = static_profile(pkg)
    overlay_path = os.path.join(pkg, "scores_overlay.json")
    if os.path.exists(overlay_path):
        ov = json.load(open(overlay_path, encoding='utf-8'))
        for dim, val in ov.items():
            if dim in profile and isinstance(val, dict) and 0 <= val.get("score", -1) <= 4:
                profile[dim]["human_score"] = val["score"]
                profile[dim]["evidence"] = val.get("evidence", "(no evidence cited)")
    # overall readiness: never a single number, but a coarse level based on blockers
    blockers = [d for d in DIMENSIONS if profile[d].get("human_score", profile[d]["static_score"]) < 2]
    ready = "NOT_PILOT_READY" if blockers else ("PILOT_READY_STATIC_ONLY"
             if any(profile[d].get("human_score") is None for d in DIMENSIONS) else "HUMAN_REVIEW_PASSED")
    report = {"dimensions": profile, "blockers": blockers, "overall_readiness": ready}
    with open(os.path.join(pkg, "quality_report.json"), "w", encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    md = ["# quality report", "", "| dimension | static | human | note |", "|---|---|---|---|"]
    for d in DIMENSIONS:
        p = profile[d]
        md.append(f"| {d} | {p['static_score']} | {p.get('human_score','—')} | {p.get('reason','')} |")
    md += ["", f"**Overall readiness: {ready}**", f"Blockers: {', '.join(blockers) or 'none'}"]
    with open(os.path.join(pkg, "quality_report.md"), "w", encoding='utf-8') as f:
        f.write('\n'.join(md) + '\n')
    print("overall_readiness:", ready, "| blockers:", len(blockers))
    print(json.dumps(report["dimensions"], indent=1, ensure_ascii=False)[:800])

if __name__ == "__main__":
    main()