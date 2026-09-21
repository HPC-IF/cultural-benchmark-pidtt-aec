#!/usr/bin/env python3
"""scaffold.py — fills Stage deliverables into a benchmark package dir.

Usage:
 python3 scaffold.py <package_dir> init
 python3 scaffold.py <package_dir> construct
 python3 scaffold.py <package_dir> sampling
 python3 scaffold.py <package_dir> task <task_id>
 python3 scaffold.py <package_dir> rubric
 python3 scaffold.py <package_dir> pilot
Every file is a skeleton with REQUIRED sections; the agent fills them from evidence/planning and NEVER invents cultural facts.
"""
import os, sys, datetime

TODAY = datetime.date.today().isoformat()

INIT = """# {name} — benchmark package
status: NOT_PILOT_READY
created: {today}
PLACEHOLDER(community_partner): no data-gate contacts are in this package yet.
"""

CONSTRUCT = """# 01_construct.md
## Construct (measurable definition)
PLACEHOLDER(construct_sentence)
## Sub-capabilities (knowledge / reasoning / adaptation / authenticity / safety / intercultural interaction)
## Observable success behaviors
## Observable failure behaviors
## Exclusions (what is NOT measured, reason)
## Theory/evidence basis (cite arXiv IDs or mark PROPOSAL)
## Open ambiguities and external questions
"""

SAMPLING = """# 02_sampling.md
## Communities and internal variation dimensions
## Strata
## Sampling units and why each excludes something
## Provenance and language provenance
## Consent / compensation / ownership / withdrawal
## Contamination-memorization risk
"""

TASK = """# Task {tid}
## Scenario / user profile
## Input template
## Expected behavior and tolerant range
## Failure categories
## Cultural dimensions involved (knowledge / adaptation / authenticity / safety)
## Ambiguity and abstention cases
## Safety constraints
## Scoring method and judging
## Adversarial variants
"""

RUBRIC = """# RUBRIC.md (annotation)
## Dimension rubric and rating scale
## Free-form post-cap items
## Examples/counterexamples
## Abstinence rule
## Disagreement protocol (no consensus forced; dissent log)
## Calibration procedure
"""

PILOT = """# 08_pilot.md
## Items tested and assumptions under test
## Success criteria (numeric, pre-registered)
## Failure criteria
## Results that force ABANDONMENT
## Results that justify SCALE
## Unresolved premises
## Sample-size rationale
"""

def w(base, rel, tmpl, **kw):
    path = os.path.join(base, rel)
    if path.endswith('.md'): os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and '--force' not in sys.argv:
        print('skip exists:', rel); return
    open(path, 'w', encoding='utf-8').write(tmpl.format(**kw))
    print('wrote:', rel)

def main():
    if len(sys.argv) < 3: print(__doc__); sys.exit(2)
    base, cmd = sys.argv[1], sys.argv[2]
    os.makedirs(base, exist_ok=True)
    if cmd == 'init':
        w(base, 'README.md', INIT, name=os.path.basename(base), today=TODAY)
    elif cmd == 'construct': w(base, '01_construct.md', CONSTRUCT)
    elif cmd == 'sampling': w(base, '02_sampling.md', SAMPLING)
    elif cmd == 'task':
        tid = sys.argv[3] if len(sys.argv) > 3 else 'T000'
        w(base, f'tasks/{tid}.md', TASK, tid=tid)
    elif cmd == 'rubric': w(base, 'RUBRIC.md', RUBRIC)
    elif cmd == 'pilot': w(base, '08_pilot.md', PILOT)
    else: print('unknown stage', cmd); sys.exit(2)

if __name__ == '__main__':
    main()