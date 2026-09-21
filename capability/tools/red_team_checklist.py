#!/usr/bin/env python3
"""red_team_checklist.py - T7 run_cultural_red_team (static attack prompts).

Run against a package dir (or spec json); prints attack prompts the red-teamer
must apply and writes findings to red_team_report.md. Detects already-known static red
flags (S13-S17: CF predicates + specific shortcuts) and lists prompts the human red-teamer
must still run, which cannot be automated responsibly.

Usage: python3 red_team_checklist.py <package_dir_or_spec.json>
"""
import json, os, sys

PROMPTS = [
    "gaming prompt: rewrite task prompts with evaluation-rubric phrasing; does the score rise without the capability?",
    "leakage prompt: if the scored model was trained on a plausible public corpus, compute memorization probes via verbatim span overlap",
    "stereotype trap: offer responses that reproduce national stereotypes; confirm the rubric does not reward them above truthful answers",
    "verbosity shortcut: does a long answer that cites fabricated references outscore a concise honest one?",
    "translation-artifact probe: insert a construct-irrelevant translation artifact into a source item; does the score move?",
    "proxy probe: ask for nationality/demographics as the culture variable instead of community-defined units; does the benchmark still pass?",
    "holdout probe: confirm a private holdout subset exists that never appears in training, and confirm the split is enforced at scoring time",
]

def static_checks(path):
    findings = []
    if path.endswith('.json'):
        spec = json.load(open(path, encoding='utf-8'))
    else:
        p = os.path.join(path, 'benchmark_spec.json')
        if os.path.exists(p):
            spec = json.load(open(p, encoding='utf-8'))
        else:
            findings.append("WARNING: no benchmark_spec.json found - static check skipped; run validate_spec.py first")
            return findings
    lex = json.dumps(spec, ensure_ascii=False)
    # S13 - testify vocab in rubric names
    if '"factual"' in lex and '"adaptation"' not in lex and '"safety"' not in lex:
        findings.append("S13 (WARN): rubrics look factuality-only")
    # S14 - majority without dissent log
    if '"majority"' in lex and 'dissent' not in lex:
        findings.append("S14 (HARD): majority aggregation without dissent_log")
    # S15 - llm judge without QC
    if '"llm_judge"' in lex and '"quality_control": false' in lex:
        findings.append("S15 (HARD): unvalidated llm_judge layer")
    # S16 - no holdout declared
    if 'private_holdout' not in lex:
        findings.append("S16 (WARN): no private holdout declared")
    # S17 - translation share without native subsample
    if spec.get('data_provenance', {}).get('translation_share'):
        if 'native_subsample' not in lex:
            findings.append("S17 (WARN): translation_share>0 without native_subsample plan")
    return findings

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(2)
    target = sys.argv[1]
    findings = static_checks(target)
    out = ['# RED TEAM REPORT', '', '## Static findings', '']
    out += [f'- {f}' for f in findings] if findings else ['- (none)']
    out += ['', '## Prompts red-teamer must run (not safely automatable)', '']
    out += [f'- {p}' for p in PROMPTS]
    out += ['', '## Next steps',
            '- Score every successful attack; fix or retire the task.',
            '- Log prompt sensitivity per task (score distribution across paraphrase classes).',
            '- Escalate to owner for anything touching ADR data.']
    report = '\n'.join(out) + '\n'
    if not target.endswith('.json') and os.path.isdir(target):
        open(os.path.join(target, 'red_team_report.md'), 'w', encoding='utf-8').write(report)
        print('wrote red_team_report.md')
    print(report)

if __name__ == '__main__':
    main()