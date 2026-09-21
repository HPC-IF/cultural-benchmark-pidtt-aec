# Cultural Benchmark Design Capability Package

Reusable capability for designing AI benchmarks that gauge cultural ability **without** reducing culture to national stereotypes, static trivia, translation artifact, or majority view.

## Deliverables (Part 8 checklist)

| # | Artifact | Here | Status |
|---|----------|------|--------|
| 1 | SKILL.md — 8-stage reusable workflow | SKILL.md (+ live copy: ~/.hermes/skills/research/cultural-benchmark-design/SKILL.md) | v1.1.0 — post-self-eval revision |
| 2 | TOOLS.md — typed 9-tool suite | TOOLS.md | done (S12 synthetic-rater appraiser added in revision) |
| 3 | BENCHMARK_SCHEMA.json — machine-readable spec format | BENCHMARK_SCHEMA.json + examples/example_benchmark_spec.json (complete fictitious specimen) | verified: 23/23 top-level props present/aligned |
| 4 | EVAL_SUITE.md — 6 tracks + grading protocol | EVAL_SUITE.md | done |
| 5 | TEST_CASES.jsonl — 56 case dataset | TEST_CASES.jsonl | being generated (final step) |
| 6 | RUBRIC.md — human + auto grading + comparison method | RUBRIC.md | done |
| 7 | EXAMPLE_RUN.md — walkthrough blank→pilot-ready + self-eval + single-pass revision | EXAMPLE_RUN.md | done |
| 8 | THREATS.md — threat catalog + R-01..R-12 regression suite | THREATS.md | done |
| 9 | IMPLEMENTATION_PLAN.md — 30-day plan | IMPLEMENTATION_PLAN.md | done |
| 10 | RESEARCH_LEDGER.md — all claims with literal excerpts | RESEARCH_LEDGER.md | 16 papers, all abstracts fetched live from arXiv 2026-09-04 |

## Literature base (16 papers, titles quoted from the verified arXiv record of 2026-09-04)

- arXiv:2601.15550 — Common to Whom? Regional Cultural Commonsense and LLM Bias in India — https://arxiv.org/abs/2601.15550
- arXiv:2604.03493 — Cultural Authenticity: Comparing LLM Cultural Representations to Native Human Expectations — https://arxiv.org/abs/2604.03493
- arXiv:2402.09369 — Massively Multi-Cultural Knowledge Acquisition & LM Benchmarking — https://arxiv.org/abs/2402.09369
- arXiv:2411.00860 — Survey of Cultural Awareness in Language Models: Text and Beyond — https://arxiv.org/abs/2411.00860
- arXiv:2411.10915 — Bias in Large Language Models: Origin, Evaluation, and Mitigation — https://arxiv.org/abs/2411.10915
- arXiv:2404.05365 — NLP Progress in Indigenous Latin American Languages — https://arxiv.org/abs/2404.05365
- arXiv:2608.02996 — On the missing benchmarks layer and a potential solution — https://arxiv.org/abs/2608.02996
- arXiv:2608.02949 — On the missing data layer and a potential solution — https://arxiv.org/abs/2608.02949
- arXiv:2406.03368 — IrokoBench: A New Benchmark for African Languages in the Age of Large Language Models — https://arxiv.org/abs/2406.03368
- arXiv:2406.09948 — BLEnD: A Benchmark for LLMs on Everyday Knowledge in Diverse Cultures and Languages — https://arxiv.org/abs/2406.09948
- arXiv:2410.02677 — CulturalBench: A Robust, Diverse, and Challenging Cultural Benchmark by Human-AI CulturalTeaming — https://arxiv.org/abs/2410.02677
- arXiv:2309.12053 — AceGPT, Localizing Large Language Models in Arabic — https://arxiv.org/abs/2309.12053
- arXiv:2503.17485 — SaudiCulture: A Benchmark for Evaluating Large Language Models Cultural Competence within Saudi Arabia — https://arxiv.org/abs/2503.17485
- arXiv:2306.05685 — Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena — https://arxiv.org/abs/2306.05685
- arXiv:2310.18018 — NLP Evaluation in trouble: On the Need to Measure LLM Data Contamination for each Benchmark — https://arxiv.org/abs/2310.18018
- arXiv:2410.05229 — GSM-Symbolic: Understanding the Limitations of Mathematical Reasoning in Large Language Models — https://arxiv.org/abs/2410.05229

Recheck: fetch_missing.py / fetch_abs.py (in research/) can regenerate the arXiv API check; the verified record is research/arxiv_verified.json.

## Top-priority implementation tasks (3)

1. **Wire up tools/validate_spec.py** (IMPLEMENTATION_PLAN D3-4): a JSON-schema validator + V-rule linter running as CI — unblocks all subsequent tool implementations and is needed for every future benchmark package to prove schema alignment.
2. **Build eval_suite/runner + auto_scorer.py and finish TEST_CASES.jsonl** (D15-18): this suite is the only check that prevents an agent from writing persuasive prose instead of a good benchmark, and everything else (self-eval, release gate) depends on it.
3. **Human rubric calibration** (D19-20): 2 graders × 12 sampled cases to determine kappa on the CF triggers; until kappa ≥ 0.7, the auto rubric cannot be trusted at release time.
