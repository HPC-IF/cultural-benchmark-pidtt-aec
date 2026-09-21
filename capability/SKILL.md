---
name: cultural-benchmark-design
version: 1.2.0
description: "Use when designing, critiquing, or validating AI benchmarks that measure cultural capabilities. Runs an 8-stage workflow (construct scope to pilot-ready spec) with hard anti-essentialism gates, community governance, and a 15-dimension quality score. Rejects nationality-as-culture, trivia-only, translation-substitute, stereotype-keyed designs."
triggers:
  - "design a cultural benchmark"
  - "cultural evaluation suite"
  - "benchmark cultural awareness/adaptation/safety"
  - "critique this benchmark"
  - "validate a culturally grounded eval"
tools:
  - define_cultural_construct
  - map_cultural_variation
  - design_benchmark_task
  - create_annotation_rubric
  - audit_benchmark_bias
  - analyze_judge_reliability
  - run_cultural_red_team
  - generate_pilot_protocol
  - score_benchmark_quality
mutating: false
category: research
related_skills:
  - eval-framework-auto
  - grounded-citations
  - benchmark-source-verification
---

# Culturally Grounded Benchmark Design

Skill: **Culturally Grounded Benchmark Design** (requested name; canonical CLI slug: `cultural-benchmark-design`)

## Purpose

Take an agent from an initial benchmark idea to a **culturally responsible, technically rigorous, pilot-ready evaluation** — measure AI behavior across cultures **without** reducing culture to national stereotypes, static trivia, translation quality, or majority preferences.

## Contract (what this skill guarantees)

- Every vague construct input ("cultural awareness") is decomposed into measurable sub-capabilities or rejected with the reason.
- Nationality is never silently used as a proxy for culture; any use must be explicit, justified, and bounded.
- Within-community variation is sampled deliberately; homogenization is a hard failure.
- Community participation is treated as **validity evidence**, not decoration.
- Disagreement among raters is preserved as signal (never collapsed without a documented protocol).
- No cultural facts, participants, results, or citations are invented; every claim is labeled PROPOSAL / ASSUMPTION / PLACEHOLDER / OBSERVED FINDING / LITERATURE FINDING.
- Output is a machine-readable benchmark specification (BENCHMARK_SCHEMA.json validated) plus human-readable cards and a pilot protocol with go/no-go gates.

## Inputs

| Input | Type | Required | Notes |
|---|---|---|---|
| `target_capability` | str | yes | The AI behavior to measure. Vague inputs allowed — Stage 1 resolves them. |
| `deployment_context` | str | yes | Where/how the scored model will actually be used. |
| `communities` | list[str] | yes | Populations of interest (may be sub-national, diasporic, linguistic). |
| `languages` | list[str] | recommended | Include low-resource ones explicitly. |
| `modalities` | list[str] | recommended | text/audio/image/video/interactive. |
- `risk_level` | enum(low/medium/high) | yes | Calibrates governance depth. `high` triggers mandatory consent instrument + access control before any item drafting; the former "existential" tier has been removed as underspecified — if a risk argument genuinely exceeds `high`, it must be made as a written justification attached to a `high`-scoped package, not as a separate enum value.
| `purpose` | enum(research/safety/product/policy) | yes | Changes acceptable evidence bar. |
| `resources` | {budget, timeline, people} | recommended | Drives pilot scope; absence ⇒ BUDGET UNKNOWN gate (degrade, do not guess). |
| `evidence_manifest` | files+passages | required if literature claims are made | Claims citing papers must carry the passage. |
| `prior_literature` | list[refs] | optional | e.g. the cultural-benchmark corpus (see RESEARCH_LEDGER.md). |

## Outputs (all in the benchmark package directory)

1. `construct_definition.md` — construct + sub-capabilities + observables + exclusions
2. `theory_of_change.md` — why this benchmark changes behavior in the deployment context
3. `sampling_plan.md` — cultural scope, strata, consultation questions
4. `task_specs/*.md` — one spec per task (see TOOLS.md schema T3)
5. `data_requirements.md` — provenance, consent, governance plan
6. `annotation_guidelines.md` — rubrics, escalation, disagreement protocol
7. `metrics.md` — metric table with captures/hides per metric
8. `baselines.md` — concrete model set + what each tests
9. `reliability_validity.md` — measurement plan + testable hypotheses
10. `bias_audit.md` / `red_team_report.md`
11. `pilot_protocol.md` — with go/no-go criteria
12. `benchmark_card.md` + `data_card.md`
13. `benchmark_spec.json` — machine-readable, validates against BENCHMARK_SCHEMA.json

## Preconditions

- P1: evidence_manifest exists for any literature-derived claim.
- P2: a named stakeholder mapping is possible for every listed community (Stage 2 must not be vacuous).
- P3: if `risk_level == high` OR community cannot be engaged, the "COMMUNITY UNAVAILABLE" gate (below) must be answered before any data is collected.
- P4: working dir writable; `BENCHMARK_SCHEMA.json` available for validation.

## Procedure (8 stages)

### Stage 1 — Scope the construct
Run `define_cultural_construct`. Answer, in writing, all of:
1. What ability is measured? 2. Observable behavior counting as success? 3. Failure? 4. What is NOT measured (exclusions)? 5. Why it matters in the deployment context? 6. Which theories/findings motivate it?
**Gate G1 (CONSTRUCT LOCK):** construct names exactly ONE axis from {Knowledge type: knowledge of a cultural domain and its facts, terminology, practices, institutions, and histories — what the model knows about a community. This axis can coexist with harmful framing if knowledge is treated as the whole of cultural competence.

Reasoning type: reasoning about cultural context, trade-offs, and conflicting norms. Includes identifying which cultural dimension is in play, ruling out stereotypical shortcuts, and selecting among acceptable behaviors when no single answer is correct.

Adaptation type: behavior that adjusts register, framing, or strategy to fit the interaction context — not just knowing about a community but producing an output a member of that community would plausibly accept as appropriate. Central for situated, interactive, and service-facing tasks.

Authenticity type: producing culturally specific content that is genuinely community-grounded rather than exoticized, stereotype-driven, or translation-flavored. Strongest when community judgment is available; weakest when it rests on surface lexical cues alone.

Safety type: avoiding harms that are culturally patterned — stereotype reinforcement, misrepresentation, over-refusal of benign cultural content, refusal baiting, and culturally uneven refusal behavior. Safety in this sense is not identical to generic refusal policy.

Interaction type: managing a multi-turn interaction with cultural consequences: turn-taking, directness, face, repair, politeness, and the consequences of getting those wrong across turns.

A sub-capability names exactly one axis. A capability that genuinely spans two behaviors is split into two sub-capabilities rather than assigned two axes.} per sub-capability; every sub-capability has ≥1 observable behavior; exclusions non-empty. Vague constructs without decomposition ⇒ STOP, return decomposition request.
Evidence required: citations+passages for any theory invoked. Stage 1 is not complete if the construct output lists `candidate_theories` that do not resolve to an entry in `evidence_manifest`; in that case return to the requester for manifest supplementation before proceeding to Stage 2.

### Stage 2 — Map stakeholders and communities
Enumerate per community: affected members, data contributors, annotators, cultural experts, domain experts, deployment stakeholders, harm candidates. Distinguish five competence types: community membership / cultural expertise / linguistic expertise / domain expertise / annotation experience.
**Gate G2 (NO SINGLE VOICE):** no community is represented by one person; at least two independent stakeholder lines per community; roles are typed (member ≠ expert ≠ linguist).
Evidence required: recruitment channels or consultation questions if channels unknown.

### Stage 3 — Design the tasks
Run `design_benchmark_task` per task. Situated/interactive tasks whenever the construct is behavior/adaptation/interaction; knowledge-only tasks allowed only for the knowledge axis.
**Gate G3 (TASK REALISM):** every task has scenario+context+input+expected behavior+acceptable variation+unacceptable behavior+cultural dimensions+ambiguity notes+safety concerns+scoring method+evidence-for-judging. No trivia-only task may score the non-knowledge axes.

### Stage 4 — Design the data
Decide explicitly: provenance, original-language vs translated, sampling units, within-community diversity, demographics/region, sensitive info, consent, compensation, ownership, withdrawal, privacy, access restrictions, contamination/memorization risk.
**Gate G4 (EXCLUSION LEDGER):** every sampling decision states in one line what it excludes. Translation-only data ⇒ failed unless the target construct is explicitly about cross-lingual transfer.
Evidence required: consent instrument draft; compensation plan or justification of its absence.

### Stage 5 — Design judgment and annotation
Run `create_annotation_rubric`. Three layers: (1) community judgments, (2) trained expert judgments, (3) automated/LLM judgments. Per layer: recruitment, instructions, rubric, calibration, conflict resolution, blinding, QC, reliability analysis, limits of interpretation.
**Gate G5 (NO MAJORITY TRUTH):** rubric defines disagreement preservation (clusters, split scores, veto log). Majority vote may aggregate for logistics only, never as cultural ground truth. LLM judges allowed only with a validation sub-study.
Evidence required: calibration items; escalation path.

### Stage 6 — Design metrics
Cover: task performance, cultural appropriateness, harm/stereotype rate, calibration, abstention, robustness across communities, robustness across languages, within-community variance, inter-rater agreement, judge-human agreement, performance gaps, worst-group/tail performance.
**Gate G6 (CAPTURES/HIDES):** every metric row fills "what it captures" and "what it hides"; head-only metrics without tail/worst-group counterpart ⇒ fail.

### Stage 7 — Validate the benchmark
Stage 7 — Validate the benchmark. Run `audit_benchmark_bias` + `run_cultural_red_team`. Test: construct validity, content validity, ecological validity, convergent/discriminant validity, inter-rater reliability, test-retest, sensitivity to model improvement, prompt sensitivity, translation artifacts, stereotyping, leakage, gaming, annotation bias, judge bias, subgroup instability.

**Gate G7 (VALIDITY MATRIX):** each validity claim is mapped to a test + expected outcome + interpretation rule. Untested claims listed as assumptions. Two validity claims treated as mandatory to label (even if the rest stay PLACEHOLDER):
1. **Memorization/contamination claim:** a statement about how likely it is that the cultural items under test were already seen during model training, and what that means for what the score can prove. If the item text is plausibly memorized, the benchmark's evidence for cultural competence is weakened and the package must say so explicitly — not silently assume the items are novel.
2. **Substantive-justification claim:** a statement that any sensitive-content handling rests on an actual abstention/escalation path and consent instrument, not only on an access-control declaration. Access control gates who can see the data; abstention/escalation gates what happens when a rater or community member objects to being asked about the content at all. Both must be named for sensitive material; one without the other is incomplete.

**Gate G7b (contamination/memorization must not be silent on cultural items):** when the benchmark relies on culturally specific item text that may have appeared in publicly accessible corpora or in the model's pretraining distribution, the validity plan must include a contamination/memorization note rather than only a generic "we will screen pre-publication." Pre-publication item-level screening protects leaderboard integrity; it does not, by itself, establish that a high score reflects cultural competence rather than recall of familiar material.

### Stage 8 — Pilot and revise
Run `generate_pilot_protocol` then `score_benchmark_quality`. Define: what the pilot tests, success, failure, which results trigger revision, which justify scaling, which assumptions stay unresolved.
**Gate G8 (PILOT GATE):** package may only recommend full scale when the quality profile has no unmitigated CRITICAL blocker. Else: revise → re-score → pilot again.

### SCOPE-DOWN TEMPLATE (community-unavailable gate, revision of EXAMPLE_RUN self-assessment failure 1)

When community raters cannot be engaged, produce `residual_validity_gap.md` with exactly:

```
CLAIMS RETAINED (supportable without community raters):
- [claim] — evidence class: OBSERVED / PROPOSAL — testable by: [expert review | automated check | structural audit]
CLAIMS WAIVED (require community testimony):
- [claim] — why community evidence is essential: [1 line] — revisit when: [condition]
RESIDUAL VALIDITY GAP (verbatim, goes into benchmark_card.md):
- "Community-internal judgment on [axes] not collected in v{version}; scores on those axes represent structural/expert assessment only and must not be interpreted as community norms."
RECOMMENDATION:
- [data-collection pilot proposal | retain-only-trivial-claims recommendation | halt]
```

This template is mandatory output, not decoration — a waiver without a recommendation is an incomplete waiver.

## Decision points

| Point | Question | Branch |
|---|---|---|
| D1 (after S1) | Is the construct decomposed into observables? | No → return to requester with decomposition questionnaire; do not proceed |
| D2 (after S2) | Can the community be engaged at all? | No → GATE: Community Unavailable (see Failure recovery) |
| D3 (after S4) | Is data original-language? | No, and axis ≠ translation/transfer → redesign data plan |
| D4 (after S5) | Do community raters agree with experts on ≥80% of calibration items? | No → rubric drift; recalibrate before annotation |
| D4b (after S2) | Does a named consent+withdrawal protocol exist (or a documented plan to produce one before recruitment)? | No → BLOCK on consent instrument; do not proceed to task/data design for sensitive content; if content is non-sensitive and governance is trivial, state that justification explicitly. For high-risk topics, consent instrument must precede any item drafting, not follow it. |
| D5 (after S7) | Any red-team finding severity = critical? | Yes → repair or scope-down; never ship |
| D6 (after S8) | Quality profile blocker-free? | No → revise loop (max 2 rounds, then human escalation) |

## Quality gates summary + stop conditions

STOP (do not produce a benchmark spec) when:
- S1: requester refuses to answer "what behavior counts as success/failure?" after one clarifying round.
- S2: the only stakeholder for a community is the requester themselves claiming to represent it — and refuses consultation.
- S5: requester demands majority-vote ground truth with no disagreement log.
- S7: critical red-team finding unrepairable with available resources.
- Any stage: requester asks to invent community evidence, synthetic "native" raters, or fake validation numbers.
- Any stage: sensitive cultural data requested with no governance answer.

## Failure recovery

| Failure | Recovery |
|---|---|
| Gate G1 failed | Run construct decomposition questionnaire (template in TOOLS.md §1.3) and re-enter Stage 1 |
| Community unavailable (P3) | Scope down to claims supportable WITHOUT community raters using the SCOPE-DOWN TEMPLATE below; document residual validity gap; if impossible → STOP and report why |
| Budget unknown (resources missing) | Produce a pilot protocol with an explicit "BUDGET UNKNOWN — needs clarification" marker; never invent a budget line item |
| LLM judge disagrees with community raters | Do NOT re-weight automatically: split by calibration subset, by task type, by rater group; report as a finding; community raters' divergence is evidence about the task, not noise to delete |
| Evidence sparse / low-resource language | Shrink claim scope; state which validity claims are waived; propose data-collection pilot instead of full benchmark |
| Red-team critical finding | Repair plan with re-run of the affected tests; log in change log |
| Two sources disagree | Preserve both in RESEARCH_LEDGER.md with the conflict note; skill adopts neither; the decision point states the trade-off |

## Evidence discipline (applies to every stage)

- LITERATURE FINDING: needs citation + verbatim passage (RESERACH_LEDGER format).
- OBSERVED: needs measurement reference (pilot, audit, red team).
- PROPOSAL / ASSUMPTION / PLACEHOLDER: must be labeled as such; never presented as fact.
- Cultural facts: never authored by the designing agent without a source. The agent may structure; it may not testify.

## Failure anti-patterns (do not do)

1. Treat nationality as culture without qualification.
2. Use translation as substitute for cultural grounding.
3. Claim cultural competence from factual accuracy alone.
4. Stereotypes as answer keys.
5. Collapse rater disagreement without documented justification.
6. LLM judge without validation.
7. Invented community evidence or synthetic raters.
8. Expose sensitive cultural data without governance.

(These are also the CRITICAL rows of the scoring rubric — RUBRIC.md §critical.)

## Literature base (initial set; verified — see RESEARCH_LEDGER.md)

IrokoBench (arXiv:2406.03368) · BLEnD (2406.09948) · CulturalBench (2410.02677) · CultureAtlas (2402.09369) · INDICA/"Common to Whom?" (2601.15550) · Cultural Authenticity (2604.03493) · SaudiCulture (2503.17485) · AceGPT (2309.12053) · Survey of Cultural Awareness (2411.00860) · Bias in LLMs survey (2411.10915) · NLP Indigenous LatAm (2404.05365) · SURUS Missing Benchmark Layer (2608.02996) · SURUS Missing Data Layer (2608.02949); supporting methodology: MT-Bench/LLM-judge (2306.05685), contamination (2310.18018), GSM-Symbolic (2410.05229).