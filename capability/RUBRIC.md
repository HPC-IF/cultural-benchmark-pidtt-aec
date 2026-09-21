# RUBRIC.md — Scoring system for benchmark-design submissions

Two parallel graders over the same 15 dimensions: a **human rubric** (prose anchors, judgment) and an **automated rubric** (checkable predicates). They score independently, then get compared (human-rubric == tiebreak). 0-4 scale identical for both.

## Scale

- 0 — Missing or fundamentally invalid
- 1 — Mentions the issue but gives no usable method
- 2 — Partially usable, major methodological gaps
- 3 — Strong and implementable
- 4 — Excellent: nuanced, evidence-grounded, operational

## Dimensions (15)

| # | Dimension | Human anchor for 3 | Automated predicate (score 3 requires) |
|---|-----------|--------------------|------------------------------------------|
| 1 | Construct validity | named construct, axis, observable success+failure per sub-capability | regex: construct block with >=1 named sub-capability AND each has 'observable behaviors' |
| 2 | Cultural specificity | constructs scoped to named communities, not global monoliths | communities referenced >=1; 'global/universal' unqualified claims flagged |
| 3 | Within-culture representation | strata along variation axes + rationale | sampling block has >=2 strata OR explicit justified "single-stratum + identify_risk" note |
| 4 | Community involvement | recruitment of community raters/experts named with consent + comp policy | annotation.layers contains 'community' with non-PLACEHOLDER consent+compensation |
| 5 | Task realism | situated scenario/context/expected-behavior structure | tasks have scenario+context+expected_behavior; no trivia-only items disguised |
| 6 | Annotation quality | rubric with calibration, blinding, conflict-resolution | rubric block has calibration+blinding fields |
| 7 | Disagreement handling | dissent preserved via aggregation rule + escalation | annotation.disagreement_policy has aggregation + dissent_log + escalation |
| 8 | Metric validity | metrics with captures/hides per metric | each metric has 'captures' and 'hides' |
| 9 | Reliability analysis | ICC/test-retest thresholds + prompt sensitivity probe | reliability block has inter_rater + test_retest + prompt_sensitivity |
| 10 | Bias detection | audit findings tied to planted flaws (Track E recall) | >=1 finding with severity+affected_group+repair |
| 11 | Safety and governance | consent, access control, sensitive-content policy | governance block non-PLACEHOLDER consent+access_control |
| 12 | Leakage resistance | contamination screen + private holdout + gaming defense | leakage block has screening_method + private_holdout:true |
| 13 | Reproducibility | artifact versions + config + seed discipline | benchmark_identity.version + reproducibility note present |
| 14 | Practical feasibility | budget/timeline honest with PLACEHOLDERs where unknown | no invented numerosities; 'PLACEHOLDER' + what_is_needed for unknown resource numerics |
| 15 | Transparency of uncertainty | labeled assumptions/placeholders; uncertainty quantified per claim | strings PLACEHOLDER/PROPOSAL/ASSUMPTION present; no unflagged claims in uncertainty-required positions |

## Human grading rubric (full anchors)

For each dimension apply the 0-4 scale to the SUBMISSION artifact for the case. Record the score + evidence quote.

### Per-dimension 0/1/2/4 anchors (3 = the table anchor above)

- **0**: absent, or so misapplied it is harmful (e.g., nationality-as-culture stated as design principle).
- **1**: gesture only — names the dimension, no method ("we should involve the community").
- **2**: method present but not implementable: missing who/how/thresholds/consent; or method copied generically without fit to the task.
- **4**: 3 plus one of: cites a verified source (arxiv_verified.json ids only), quantifies a threshold with rationale, documents an exclusion ledger, or explicitly preserves a disagreement that the grader finds non-obvious.

## §critical — Critical failure rules (no-pass triggers)

A submission CANNOT pass any case, regardless of dimensional scores, if any of these fire:

|| CF-1 | Treats nationality as culture without qualification. |
| CF-1a | If a national-language tag (e.g. `es`) is used as a benchmark axis without an explicit statement that it stands for a bounded linguistic variant rather than the whole language community, treat as CF-1. |
- **CF-2** Uses translation as a substitute for cultural grounding.
- **CF-3** Claims cultural competence from factual accuracy alone.
- **CF-4** Uses stereotypes as answer keys (or scoring geometry that rewards them).
- **CF-5** Collapses community disagreement without justification (majority-as-truth).
- **CF-6** Uses an LLM judge without a validation sub-study.
- **CF-7** Invents community evidence, participants, raters, or empirical results.
- **CF-8** Exposes sensitive cultural data without governance/consent controls.

Each fire is logged: `{case_id, class: CF-n, evidence_quote}`. A single fire => verdict fail.

## Automated scoring rubric

Implementation: `eval_suite/auto_scorer.py` (plan item, IMPLEMENTATION_PLAN.md). It runs on a submission artifact (A) a JSON-schema check against BENCHMARK_SCHEMA.json, (B) structural predicates per dimension (table above), (C) class CF-1..CF-8 detectors:

- CF-1: sampling/communities block missing AND nationality tokens appear as strata IDs without a `nationality_proxy_statement` qualifier.
- CF-2: `translation_share` > 0 AND no original-language provenance stratum.
- CF-3: rubric dimensions only 'factual_accuracy'/'knowledge' AND axis exclusion of adaptation/safety/interaction.
- CF-4: answer-key field with one correct option per item on membership-like fields (region/ethnicity/religion) AND no acceptable_variation.
- CF-5: aggregation_rule == 'majority_vote' (literal) without dissent_log:true.
- CF-6: llm_judge layer present AND no validation sub-study field.
- CF-7: regex scan for invented agentes/earnings patterns + detection of synthetic-rater artifacts (no community-permission documentation).
- CF-8: sensitive-content-flagged items with `access_control` unset OR without an abstention+escalation path (acceptance rule: a sensitive item without rater abstention/escalation on record is treated as CF-8, even if access_control is set; access control alone is necessary but not sufficient)

Detector false positives are EXPECTED and feed the comparison method below: mechanical correct writing that tripped a predicate is manually counter-checked before the verdict.

## Comparing the two graders

1. Both graders score every case blind and independently.
2. Per dimension compute: (a) absolute difference, (b) sign (who scores systematically higher), (c) Cohen's kappa on the 3/4-pass binary + critical trigger agreement.
3. Calibration rule: if absolute diff > 1 on the same dimension, an adjudicator (third reader) decides with access to both rationales; adjudication gets fed back into both rubrics (predicate fix for the auto-rubric, anchor clarification for the human-rubric).
4. Agreement targets: kappa >= 0.7 on critical triggers, kappa >= 0.6 on dimensional pass/fail boundary. Below target => both rubrics are revised before using the suite for release.
5. Task-oriented metric: the suite's own quality = frequency of adjudications + kappa; log as `rubric_health` in release notes.
