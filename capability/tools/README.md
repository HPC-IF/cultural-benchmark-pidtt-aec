# tools/ — executable implementation map

The 9 typed tools are defined in `TOOLS.md` (input/output schemas). Executable forms below.
Python 3.10+, stdlib only.

| # | Tool (TOOLS.md) | Executable | Usage |
|---|---|---|---|
| T1 | `define_cultural_construct` | `scaffold.py <pkg> construct` | emits 01_construct.md skeleton (agent fills from evidence manifest; refuses vague inputs) |
| T2 | `map_cultural_variation` | `scaffold.py <pkg> spec` | emits benchmark_spec.json skeleton incl. sampling_plan.strata; enforce with `validate_spec.py` (V1/V2/V3) |
| T3 | `design_benchmark_task` | `scaffold.py <pkg> task <ID>` | emits tasks/<ID>.md with required realism fields + annotation_hooks |
| T4 | `create_annotation_rubric` | `scaffold.py <pkg> rubric` | emits RUBRIC.md with required disagreement handling |
| T5 | `audit_benchmark_bias` | `audit_spec.py <pkg|spec.json>` | static bias checks BIAS-1..11 -> audits/bias_audit.json |
| T6 | `analyze_judge_reliability` | `compare_judgments.py <judgments.jsonl>` | agreement/overlap/kappa by layer; abstention/repetition monitor |
| T7 | `run_cultural_red_team` | `red_team_checklist.py <spec|pkg>` | static findings + the 7 attack prompts to run manually |
| T8 | `generate_pilot_protocol` | `scaffold.py <pkg> pilot` | emits 08_pilot.md with required pilot sections |
| T9 | `score_benchmark_quality` | `score_quality.py <pkg>` | 15-dimension profile + overall readiness; static portion, never guesses |

Extras:
- `validate_spec.py <spec.json|pkg>` — schema conformance + R-rules + checksum placeholders (Block CF-1..CF-6, CF-12)
- `scaffold.py <pkg> init` — creates package README + card dir

Static checks are only proxies. Scoring dimensions whose validity depends on community input
(T6 human layers, T7 live attacks, T9 content quality) stay placeholders until human execution.

## Quick smoke test

```bash
D=$(mktemp -d)/pkg
python3 scaffold.py $D init && python3 scaffold.py $D construct && python3 scaffold.py $D rubric
cp examples/example_benchmark_spec.json $D/benchmark_spec.json
python3 validate_spec.py $D/benchmark_spec.json
python3 audit_spec.py $D | tail -5
python3 score_quality.py $D | head
```