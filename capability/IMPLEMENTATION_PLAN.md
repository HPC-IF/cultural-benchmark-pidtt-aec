# IMPLEMENTATION_PLAN.md — 30-day plan for the skill + tools

Goal: skill and tool suite operational and pilot-ready. Benchmarks created with the skill are NOT designed on Day 30 — only the capability package is ready for its first real benchmark.

## Week 1 — Foundation (days 1-7)

- D1-2: Freeze SKILL.md + TOOLS.md + BENCHMARK_SCHEMA.json (this package). Register skill (skill_manage create). ✓ done today (draft v1.0.0).
- D3-4: Build `tools/validate_spec.py` — JSON-schema validation + V-rule lint (PLACEHOLDER discipline, CF predicates). CI-gate on the package directory.
- D5-7: Build `eval_suite/auto_scorer.py` (RUBRIC.md automated scoring) + run once against the example package; fix schema quirks. Own QA: 50-case dry run of the suite against the skill.
- Owner: eval engineer. Exit criteria: validate_spec.py passes on example_benchmark_spec.json and auto_scorer.py issues zero false CF triggers on the example package.

## Week 2 — Tool implementation (days 8-14)

- D8-9: `define_cultural_construct` + `map_cultural_variation` — construct validation contract.
- D10-11: `design_benchmark_task` + `create_annotation_rubric` — task + rubric contracts with disagreement protocol.
- D12: `audit_benchmark_bias` + `run_cultural_red_team` — bias predicates + attack case generation.
- D13-14: `generate_pilot_protocol` + `score_benchmark_quality` + `analyze_judge_reliability`. Integration test: run the full 8-stage workflow against the example benchmark spec end-to-end.
- Exit criteria: each tool has an example input/output pair serialized under `tools/examples/`; full workflow completes on the example spec.

## Week 3 — Evaluation harness (days 15-21)

- D15-16: Finalize TEST_CASES.jsonl (56 cases, quotas 10E/22M/12H/12 Adv) + validate all fields.
- D17-18: Build the runner: feeds `request`+`context` only (blind), collects the artifact, invokes auto_scorer, stores verdicts.
- D19-20: Human rubric calibration: 2 graders × 12 sample cases; compute kappa; adjust anchors if kappa < 0.7 on CF triggers.
- D21: Run the suite once against SKILL v1; log failures; produce the first self-eval report.
- Exit criteria: runner works end-to-end; self-eval verdict exists with every CF fire documented.

## Week 4 — Self-eval, revision, pilot ready (days 22-30)

- D22-23: Revise SKILL.md once based on self-eval failures (single-pass rule: do not loop forever).
- D24: Re-run failed tracks; document deltas.
- D25-26: `circle opening`: first real benchmark (propose Registration Service) — Stage 1-3 only; go to pilot stage; lineage plan drafted; community-consult questions drafted (do not send until a contact person is confirmed).
- D27-28: Threats + governance walkthrough: CF predicates against a real spec; consent-tool draft; trigger-identifier policy check.
- D29: Documentation day: EXAMPLE_RUN.md updated with the real walkthrough; binder + data card template finalized.
- D30: Release v1.1.0: SKILL + TOOLS + schema + evaluation + leaderboard + implementation plan. Publish inside skill directory + link from references. Announce.

## DoD checklist

- [ ] validate_spec.py green on the example package
- [ ] auto_scorer.py zero false CF triggers on the example package
- [ ] 56 test cases parse, quotas met, fields complete
- [ ] kappa >= 0.7 on CF triggers (human vs auto)
- [ ] self-eval run complete; one revision done; deltas reported
- [ ] pilot protocol for the first real benchmark (Registration Service) drafted
- [ ] RESEARCH_LEDGER.md complete with verified sources only
- [ ] no invented cultural facts anywhere (grep audit for non-sourced assertions)
