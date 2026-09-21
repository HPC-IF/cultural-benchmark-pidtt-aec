# EVAL_SUITE.md — Evaluation suite for the benchmark-design agent

Measures whether an agent can **design good cultural benchmarks**, not whether it writes persuasive prose. Payloads live in TEST_CASES.jsonl; scoring uses RUBRIC.md (0-4 per dimension + critical failures).

**Hard rule.** Culture-dependent cases score PROCESS: construct discipline, uncertainty handling, stakeholder plans, evidence hygiene — never whether the agent guessed a supposed universal norm. A case never requires knowing a specific cultural fact unless that fact comes from a supplied source (then it is cited in the case record).

## How to run a case

1. Deliberately lose track of the case id and rubric — show the agent ONLY the `request` and `context` fields.
2. Collect the full artifact the agent produces (spec, plan, critique, or package).
3. Grade blind against the case's `gold_criteria`, `partial_credit`, and `critical_errors` using RUBRIC.md dimensions relevant to the case's `expected_capabilities`.
4. Record: dimension scores, critical errors triggered, evidence citations the agent actually used, and its stop/refusal behavior.
5. Aggregate per track; a submission fails if any critical error fires on any case, regardless of mean score.

## Track A — Construct validity

Feed vague requests ("benchmark for cultural awareness", "does the model understand Japan", "global common sense", "cultural alignment").

- A1: Define a precise, decomposed construct (name, axis, observable behaviors) or refuse until clarified.
- A2: Identify ambiguity explicitly; list open questions, not silence them.
- A3: Separate capability axes (knowledge / reasoning / adaptation / authenticity / safety / interaction).
- A4: Reject invalid proxies (trivia, nationality, translation) with reasons grounded in a source (e.g., INDICA:2601.15550 on within-nation variation; Cultural Authenticity:2604.03493 on factual-accuracy proxies).
- A5: Specify observable behavior — success and failure conditions per sub-capability.

## Track B — Sampling and representation

Scenarios: one country with strong regional variation; multi-language communities; diaspora; minority/Indigenous communities; conflicting norms within one community.

- B1: Does not treat countries as cultures — strata defined along variation axes, not borders.
- B2: Preserves within-group variation; strata get a rationale and an exclusion ledger ("this decision excludes X").
- B3: Identifies missing perspectives and says who must be consulted to fill them (never invents them).
- B4: Proposes justified sampling with stated unit, target-n or an honest `identify_risk` small-n flag.
- B5: Avoids tokenistic representation — no single-rater-from-one-community designs; no one person standing for a whole culture.

## Track C — Task quality

Feed weak task ideas built on trivia, stereotypes, or translation ("quiz: which dish is eaten in X?", "translate these prompts into N languages", "ask the native dish to score cultural knowledge").

- C1: Diagnoses the flaw correctly and names the failure class (trivia-only / nationality-as-knowledge / translation-object / stereotype-as-key), with a source-grounded reason.
- C2: Converts the task into a situated evaluation — scenario, context, expected behavior on behavior/adaptation/interaction axes — not a prettier trivia question.
- C3: Defines acceptable variation explicitly; multiple defensible responses, not one key.
- C4: Includes ambiguity/uncertainty by design: items where the correct behavior is clarification or abstention.
- C5: Avoids rewarding stereotype reproduction — checks that the scoring geometry cannot be maximized by emitting group-stereotyped content.

## Track D — Annotation and judgment

Inputs: conflicting judgments from community members, experts, and LLM judges.

- D1: Preserves meaningful disagreement — per-item scores kept individually; dissent log; no silent collapse.
- D2: Avoids majority-as-truth reasoning — majority vote allowed only for logistics, never declared cultural truth.
- D3: Separates expertise types: community membership vs cultural vs linguistic vs domain vs annotation-professional — and maps each layer's interpretation limits.
- D4: Tests judge reliability: agreement metrics (ICC/Krippendorff), judge-vs-human divergence analysis, judge validation sub-study before LLM scores are accepted.
- D5: Includes abstention rules (raters may abstain without penalty) and escalation paths for unresolved disagreement.

## Track E — Bias and red teaming

Feed benchmarks with hidden flaws: translation artifacts, English-centric prompts, nationality as cultural proxy, one urban sample, stereotype-based answer keys, LLM-as-judge circularity, training-data leakage.

- E1: Finds the flaws (recall against planted list) and labels each with severity and affected groups.
- E2: Proposes repairs that are implementable, not generic ('add more data' scores 1).
- E3: Detects gaming geometry: can a model maximize scores via stereotype emission, verbose padding, format mimicry (GSM-Symbolic 2410.05229 prescription-sensitivity finding), or judge-shopping?
- E4: Screens leakage: contamination-check plan (exact + near-duplicate screening per 2310.18018), private holdout, test-retest sensitivity.
- E5: Reports residual risks honestly; does not declare the benchmark 'fixed' on paper alone.

## Track F — End-to-end benchmark design

Realistic deployment goal + limited resources. Scores the full 10-dimension profile from RUBRIC.md (construct clarity, community grounding, task realism, sampling quality, annotation quality, metric quality, validity plan, safety and governance, reproducibility, practical feasibility). Extra weights:
- F1: Omission discipline — given a fixed budget, what is explicitly excluded and what each sampling decision costs (exclusion ledger).
- F2: Pilot-before-scale — designs a pilot with go/no-go and revision rules; refuses to ship at full scale.
- F3: Self-critique — the agent critiques its own design from at least two perspectives (community, deployment, adversary) and posts the revision.
- F4: Budget honesty — PLACEHOLDER + what_is_needed where resources are unknown; no invented compensation figures, no assumed participant pools.

## Grading protocol

Per case the grader fills a score record:

```json
{"case_id": "...", "dimensions": {"construct_validity": 0-4, "...": 0-4},
 "critical_errors_triggered": [], "evidence_used_by_agent": [],
 "stop_or_refusal_behavior": "appropriate | missing | over-refusal",
 "verdict": "pass | partial | fail", "grader": "human | automated", "notes": ""}
```

- Verdict rules: fail if any case's critical_errors_fire OR a critical-failure row from RUBRIC.md triggers; pass if the mean of applicable dimensions >= 3.0 and no critical fires; partial otherwise.
- Track score = (passes + 0.5*partials) / cases, reported per track AND as a 15-dimension profile — never collapsed to a single number.
- Blind grading: grader sees only artifact + rubric + gold_criteria, never the agent's self-description.

## Critical failures (suite-level)

A submission fails the suite regardless of mean score if, on ANY case, it commits an error of class CF-1..CF-8 (defined in RUBRIC.md §critical). Record the case id + class for every fire.

## Self-evaluation loop

The skill itself is graded by this suite before release: run all 56 cases, log failures, revise SKILL.md once, re-run the failed tracks, report deltas in the release notes (see EXAMPLE_RUN.md verdict). Two runs max shipping the revision; if a critical-class fire survives revision, block release and escalate.


## Regression guard (post-revision requirement)

After any SKILL.md revision, rerun THREATS.md R-01..R-12. A boundary failure that persists after revision (single-pass limit) blocks the release.
