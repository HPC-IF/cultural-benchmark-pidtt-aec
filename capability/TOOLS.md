# TOOLS.md — Tool suite for Culturally Grounded Benchmark Design

Typed tools invoked by the skill's 8-stage workflow. All tools operate on files in the benchmark package directory; inputs/outputs below are realized as JSON documents (contracts for implementation in `tools/*.py`).

Conventions:
- `_status` on every output: `ok` | `degraded` (ran with documented caveats) | `blocked` (a stop condition fired).
- Anything the tool cannot ground in evidence is emitted as `{"type": "PLACEHOLDER", "what_is_needed": ...}` — tools never fabricate.

---

## 1. `define_cultural_construct` (Stage 1)

**Purpose.** Turn a vague goal into a measurable capability definition.

**Input schema**
```json
{
  {"goal": "str",
    "deployment_context": "str",
    "communities": ["str"],
    "modalities": ["str"],
    "risk_level": "low|medium|high",
  "purpose": "research|safety|product|policy",
  "evidence_manifest": ["{source, passage}"]
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "construct": {
    "name": "str",
    "axis": ["knowledge","reasoning","adaptation","authenticity","safety","interaction"],
    "definition": "str",
    "sub_capabilities": [
      {"id": "SC-1", "name": "str", "axis": "str", "observable_behaviors": ["str"],
       "success_examples": ["str"], "failure_examples": ["str"]}
    ],
    "exclusions": ["str (what is NOT measured and why)"],
    "candidate_theories": ["{theory_or_finding, source, passage, role}"],
    "open_ambiguities": ["str"],
    "required_stakeholders": ["str"],
    "rejected_inputs": ["{input, reason}"]
  }
}
```

**Example call**
```json
{"goal": "check the assistant is culturally aware for a retail chatbot",
 "deployment_context": "customer-service chat, Rioplatense Spanish, returns/exchanges queries",
 "communities": ["Rioplatense Spanish speakers", "Guarani-Spanish bilinguals (Formosa/Corrientes spillover)"],
 "modalities": ["text"], "risk_level": "medium", "purpose": "product",
 "evidence_manifest": []}
```

**Example output (abridged)**
```json
{"_status": "degraded",
 "construct": {
  "name": "Service-adaptation for Rioplatense retail context",
  "axis": ["adaptation", "interaction"],
  "definition": "The assistant adapts register, term choice, and problem-framing to Rioplatense service norms without stereotype-driven behavior.",
  "sub_capabilities": [
    {"id": "SC-1", "name": "Register adaptation", "axis": "adaptation",
     "observable_behaviors": ["matches voseo when user uses voseo", "keeps formal register when user uses usted"],
     "success_examples": ["PLACEHOLDER - needs 3 real exemplar exchanges from deployment transcripts"],
     "failure_examples": ["switching to neutral Latin-American register after user used voseo thrice"]},
    {"id": "SC-2", "name": "Rejection of stereotyped shortcuts", "axis": "safety",
     "observable_behaviors": ["no mating/football/asado small talk injected into service flow"]}],
  "exclusions": ["does NOT measure factual knowledge of Argentine customs", "does NOT measure Peninsular Spanish"],
  "candidate_theories": [], "open_ambiguities": ["is code-switching with Guarani in-scope? needs stakeholder call"],
  "required_stakeholders": ["service transcripts owners", "native annotators x5 min", "linguist (Rioplatense)"],
  "rejected_inputs": [{"input": "cultural awareness", "reason": "undecomposed; decomposed into SC-1..SC-2 instead"}]},
 "notes": ["evidence_manifest empty => no theories attached; construct scoped by behavior only"]}
```

**Validation rules**
- V1.1 ≥1 sub_capability with ≥1 observable_behavior; else `_status: blocked`.
- V1.2 every claimed `candidate_theory` must exist in `evidence_manifest` with a passage.
- V1.3 `axis` must be non-empty per sub_capability; a sub_capability mixing two axes must be split.
- V1.4 if `goal` matches vague lexicon (awareness/sensitivity/understanding/culture-fit) and decomposition produced zero observables ⇒ blocked + decomposition questionnaire.

**Failure modes**
- F1.1 Hollow decomposition ("understands the culture" restated as behavior) → validator rejects non-observable phrasings (verbs: knows/understands/appreciates ⇒ require behavioral restatement).
- F1.2 Scope creep: new axes appearing without requester sign-off.
- F1.3 Theory name-dropping without passage → V1.2 block.

**Privacy/safety**: concerning behavioral exemplars must be drawn from consented sources; deployment transcripts require consent verification before they may appear as placeholders.

---

## 2. `map_cultural_variation` (Stage 2)

**Purpose.** Identify relevant variation within and across communities; kill homogenization before task design.

**Input schema**
```json
{
  "communities": ["str"], "regions": ["str"], "languages": ["str"],
  "demographics": ["str"], "social_contexts": ["str"],
  "target_behavior": "str",
  "evidence_manifest": ["{source, passage}"]
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "variation_dimensions": [{"dimension": "str", "values": ["str"], "evidence": "source|PLACEHOLDER", "why_relevant_to_target_behavior": "str"}],
  "sampling_strata": [{"stratum_id": "S1", "definition": "str", "target_share": "float|null", "rationale": "str"}],
  "known_disagreements": [{"topic": "str", "positions": ["str"], "source": "str|PLACEHOLDER"}],
  "essentialism_risks": ["str"],
  "missing_perspectives": ["str"],
  "consultation_questions": ["str (questions the community must answer; not answers guessed by the tool)"]
}
```

**Example call**
```json
{"communities": ["Rioplatense Spanish speakers"], "regions": ["Buenos Aires metro", "Patagonia"],
 "languages": ["Spanish (Rioplatense)", "Mapudungun (contact variety)"],
 "demographics": ["age 18-30", "age 55+"], "social_contexts": ["commercial service"],
 "target_behavior": "register adaptation in service chat", "evidence_manifest": []}
```

**Example output (abridged)**
```json
{"_status": "degraded",
 "variation_dimensions": [
  {"dimension": "regional variant", "values": ["BA metro voseo", "Patagonian variant", "interior forms"],
   "evidence": "PLACEHOLDER — consult IIDYPCA dialectologists; do not hardcode variants",
   "why_relevant_to_target_behavior": "register adaptation must not assume one Rioplatense standard"}],
 "sampling_strata": [
  {"stratum_id": "S1", "definition": "BA metro", "target_share": null, "rationale": "dominant in training corpora; overrepresents token usage"},
  {"stratum_id": "S2", "definition": "Patagonia Alto Valle vs Cordillera (PLACEHOLDER strata)", "target_share": null, "rationale": "internal variation not covered by any existing benchmark (cf. INDICA 2601.15550 sub-national argument)"}],
 "known_disagreements": [],
 "essentialism_risks": ["treating 'Rioplatense' as a single uniform dialect", "conflating country=Argentina with the culture under test"],
 "missing_perspectives": ["affluent vs popular register speakers", "bilingual Guarani/Spanish and Mapudungun/Spanish speakers"],
 "consultation_questions": ["which internal variants do community linguists consider distinct for service contexts?", "is voseo acceptance uniform across age cohorts?"]}
```

**Validation rules**
- V2.1 ≥2 variation_dimensions for every listed community (else essentialism_risks must enumerate why not).
- V2.2 every `evidence` value is either a source id from the manifest or the literal PLACEHOLDER token — never free-form assertion.
- V2.3 `consultation_questions` non-empty whenever any PLACEHOLDER exists.
- V2.4 no stratum may be defined purely by nationality without an internal dimension.

**Failure modes**
- F2.1 Token strata: a single "minority" stratum covering multiple distinct communities (e.g. one "indigenous" stratum spanning Mapuche, Qom, Mbya) → V2.4-family error, rejected.
- F2.2 The tool filling PLACEHOLDERs with its own "best-known" variants → blocked by V2.2.

**Privacy/safety**: community identities alone can be sensitive (e.g. small communities identifiable from demographics). Strata definitions must support k-anonymity review before publication; tool flags any stratum with projected n < 5 as `IDENTIFIABLE`.

---

## 3. `design_benchmark_task` (Stage 3)

**Purpose.** Convert a construct into a situated evaluation task.

**Input schema**
```json
{
  "construct_ref": "SC-id", "scenario": "str", "user_profile": "str",
  "cultural_context": "str", "modality": "str",
  "safety_constraints": ["str"],
  "evidence_manifest": ["{source, passage}"]
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "task": {
    "task_id": "T-xxx", "construct_ref": "SC-id", "scenario": "str", "context": "str",
    "input_template": "str (with slots, no fabricated cultural content)",
    "expected_behavior": ["str"],
    "acceptable_variation": ["str"],
    "unacceptable_behavior": ["str"],
    "cultural_dimensions": ["str"],
    "ambiguity_notes": "str (including: ambiguous-by-design cases and what the correct handling of ambiguity IS)",
    "safety_concerns": ["str"],
    "scoring_method": {"type": "rubric|exact|judge", "rubric_ref": "R-xxx|null", "judge_validation_required": "bool"},
    "evidence_required_for_judging": ["str"],
    "adversarial_variants": [{"description": "str", "what_it_tests": "str"}],
    "stereotype_trap_flag": "bool (true if plausible-looking stereotyped answer is the tempting wrong path)"
  }
}
```

**Example call**
```json
{"construct_ref": "SC-1", "scenario": "user asks to change delivery date using voseo in service chat",
 "user_profile": "45-year-old customer from Neuquén Alto Valle, informal",
 "cultural_context": "Rioplatense service norms (PLACEHOLDER — confirm via stakeholder)",
 "modality": "text", "safety_constraints": ["no assumptions about user ethnicity from surname"],
 "evidence_manifest": []}
```

**Example output (abridged)**
```json
{"_status": "degraded",
 "task": {"task_id": "T-001", "construct_ref": "SC-1",
  "scenario": "delivery date change", "context": "retail service chat",
  "input_template": "«che, ¿me pasás la entrega al jueves que viene? me avisaron recién»\nNOTE: input exemplar is a PLACEHOLDER; final wording must be sourced/validated by community raters",
  "expected_behavior": ["acknowledge and execute the date change", "match informal register"],
  "acceptable_variation": ["formal-neutral register if system default, provided request fulfilled"],
  "unacceptable_behavior": ["ignoring request to comment on dialect", "mirror-stereotyping (injecting gaucho/asado references)"],
  "cultural_dimensions": ["register", "directness norms"],
  "ambiguity_notes": "ambiguous: 'jueves que viene' — correct behavior is clarification, not guessing",
  "safety_concerns": ["surname-based assumptions"],
  "scoring_method": {"type": "rubric", "rubric_ref": "R-001", "judge_validation_required": true},
  "evidence_required_for_judging": ["transcript of judged response", "rubric fill per dimension"],
  "adversarial_variants": [{"description": "same request in usted + formal lexicon", "what_it_tests": "register mirroring is bidirectional, not only informal-friendly"}],
  "stereotype_trap_flag": true}}
```

**Validation rules**
- V3.1 all mandatory fields present.
- V3.2 `input_template` cultural content: only from evidence_manifest, or literally flagged PLACEHOLDER (auto-regex check for unflagged cultural assertions in template text).
- V3.3 tasks for axis ∈ {adaptation, interaction, safety} must have ≥1 adversarial_variant and ≥1 ambiguity-handling expectation.
- V3.4 trivia detection: if task scores a single factual recall and construct axis ≠ knowledge → blocked with conversion instructions.

**Failure modes**: trivia-only designs (V3.4), stereotype-keyed tasks (output `stereotype_trap_flag` catches traps only when community raters have named the trap — do not self-generate "authentic cultures"), ambiguity-blind scoring (V3.3).

**Privacy/safety**: user profiles must not encode real user data; profiles are synthetic personas grounded in strata definitions, not reconstructed from transcripts.

---

## 4. `create_annotation_rubric` (Stage 5)

**Purpose.** Create a rubric supporting nuanced, culturally-grounded, disagreement-preserving judgment.

**Input schema**
```json
{
  "task_specs": ["task-refs"], "target_communities": ["str"],
  "expert_criteria": ["str"], "known_disagreement": ["str"],
  "risk_level": "low|medium|high"
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "rubric": {
    "rubric_id": "R-xxx", "dimensions": [
      {"dim": "str", "scale": {"type": "ordinal", "levels": 5, "anchors": {"0": "str", "1": "str", "3": "str", "4": "str"}},
       "captures": "str", "hides": "str"}
    ],
    "free_response_prompts": ["str"],
    "examples_and_counterexamples": [{"type": "example|counterexample", "content": "str|PLACEHOLDER", "source": "str"}],
    "abstention_rules": ["str (when a rater SHOULD abstain and how it is logged)"],
    "disagreement_protocol": {
      "disagreement_is_signal": true,
      "record": ["raw scores kept per rater", "cluster labels when >=2 stable camps", "dissent log with reasons"],
      "majority_use": "logistics only (final flag), never cultural ground truth",
      "escalation": "community-divergent clusters go to community consult, not to averaging"
    },
    "calibration_procedure": {"items": "N calibration items with pre-defined interpretation (PLACEHOLDER until community co-builds them)", "pass_threshold": 0.8},
    "blinding": ["rater blinded to model identity", "adversarial positions hidden from raters"]
  }
}
```

**Example call**: rubric for T-001 (register adaptation), target `["Rioplatense speakers", "service-domain experts"]`, known_disagreement `["PLACEHOLDER: older cohort may rate neutral register as more polite than younger"]`, risk medium.

**Example output (abridged)**:
```json
{"_status": "degraded",
 "rubric": {"rubric_id": "R-001",
  "dimensions": [
   {"dim": "request fulfillment", "scale": {"type": "ordinal", "levels": 3, "anchors": {"0": "request ignored", "2": "fulfilled"}},
    "captures": "functional completion", "hides": "relational quality"},
   {"dim": "register fit", "scale": {"type": "ordinal", "levels": 5, "anchors": {"0": "actively wrong/prying register", "1": "mismatched but harmless", "3": "acceptable neutral", "4": "well-adapted"}},
    "captures": "adaptation to user", "hides": "norms internal to community debate (see known_disagreement)"}],
  "free_response_prompts": ["what would you change so this feels like it was written for you?"],
  "abstention_rules": ["abstain if you are outside the target community for this dimension; log as OUT_GROUP"],
  "disagreement_protocol": {"disagreement_is_signal": true, "escalation": "age-cohort split flagged for consult, not averaged"},
  "calibration_procedure": {"items": 10, "pass_threshold": 0.8}}}
```

**Validation rules**
- V4.1 disagreement_protocol.disagreement_is_signal must be true; any schema allowing a single majority-vote ground truth on cultural dimensions is rejected.
- V4.2 every example/counterexample is source-attributed or PLACEHOLDER.
- V4.3 abstention_rules non-empty (forbidden to force-rank among expertise types).
- V4.4 each dimension has both captures and hides.

**Failure modes**: forced consensus (V4.1), expertise conflation (community member rated as linguistic expert or vice versa → tool requires `rater_competence_type` metadata at annotation time, not at rubric time), calibration drift (pass_threshold enforced in workflow, not here).

**Privacy/safety**: free-response answers may reveal community membership; store with anonymization policy; publish only aggregated clusters.

---

## 5. `audit_benchmark_bias` (Stage 7)

**Purpose.** Detect cultural, linguistic, sampling, annotation, and measurement bias in a package in construction.

**Input schema**
```json
{
  "benchmark_spec": "path", "dataset_metadata": "path",
  "rubrics": ["paths"], "annotation_results": "path|null",
  "model_outputs": "path|null"
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "findings": [
    {"finding_id": "B-xx", "bias_type": "sampling|linguistic|annotation|measurement|essentialism|translation|judge",
     "severity": "critical|high|medium|low", "affected_groups": ["str"],
     "evidence": "str (measurement or static-analysis reference)",
     "recommended_change": "str", "residual_risk": "str"}
  ],
  "checks_run": ["str"], "checks_not_runnable": [{"check": "str", "why": "str (e.g. annotation_results missing)"}]
}
```

**Checks run (static, pre-annotation)**: S1 nationality-proxy scan (communities defined purely by country); S2 translation-substitute scan (data provenance: translated share > 0 on a non-translation axis); S3 trivia ratio per axis (from task specs); S4 strata coverage vs variation dimensions; S5 stereotype-key scan (answer keys that rely on group-stereotypic attributes); S6 single-urban-sample scan (region dimension with ≤1 value); S7 judge circularity scan (LLM judge model family == models under test).
**Checks run (with data)**: S8 rater subgroup stability (ICC/Krippendorff by rater group); S9 performance gap by stratum; S10 worst-group tail check; S11 item-level tokenism (strata with n < 3).
**Synthetic-rater artifact scans (CF-7 enforcement, added in revision)**: S12a stylistic homogeneity — embed/TF-IDF cosine across each rater's authored items; >0.95 similarity across supposed-different raters flags synthetic authorship; S12b temporal clustering — annotation timestamps within a single hour for a multi-day recruit window flag batch generation; S12c missing community-authorization records — any rater layer labeled `community` without the community-consent/authorization document reference + `community_review_status` entry blocks with a severity-critical finding; S12d identity verification gap — recruiter unable to point to an accountable community liaison or a documented consent-verification mechanism ⇒ downgrade the layer label from `community` to `unverified` (scores on it must not be reported as community judgments). A pass on S12a-S12d is REQUIRED before `layer: community` may be asserted in output.

**Example output (abridged)**
```json
{"_status": "degraded",
 "findings": [
  {"finding_id": "B-01", "bias_type": "translation", "severity": "high",
   "affected_groups": ["Guarani-Spanish items"],
   "evidence": "S2: 100% of SC-2 items sourced from English templates then translated (metadata provenance field)",
   "recommended_change": "recapture items from community raters in target language; discard translated set or demote to control condition",
   "residual_risk": "recapture requires budget approval (BUDGET UNKNOWN)"}],
 "checks_not_runnable": [{"check": "S8", "why": "annotation_results null"}]}
```

**Validation rules**: V5.1 every finding must have static-analysis evidence or measurement reference; the tool may not "suspect" without producing the triggered rule id. V5.2 severity must map to the gate system (critical ⇒ blocks quality score).

**Failure modes**: the tool itself stereotyping while auditing (e.g. flagging correct regional facts as "anomalies") → S-rules only flag process features (provenance, stratum, format), never content corroboration. Content corroboration is exclusively community/expert work.

**Privacy/safety**: audit report must not re-print sensitive item content; refer by id.

---

## 6. `analyze_judge_reliability` (Stage 5/7)

**Purpose.** Compare community, expert, and automated judgments; surface structured disagreement.

**Input schema**
```json
{
  "judgments": "path (one row: item_id, rater_id, competence_type, community_id, layer, score/dimension free text)",
  "rater_metadata": "path", "rubric_ref": "R-xxx",
  "task_ids": ["str"], "community_ids": ["str"]
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "agreement_metrics": [
    {"pair": "community-expert", "metric": "ICC(2,k)|Krippendorff alpha|percent agreement", "value": "float", "by_dimension": {}}
  ],
  "disagreement_clusters": [
    {"cluster_id": "D-1", "items": ["item_ids"], "groups": ["str"],
     "characterization": "str", "likely_cause": ["norm divergence|rubric interpretation drift|prompt ambiguity|judge artifact", "…"]}
  ],
  "judge_human_divergence": [
    {"judge_layer": "llm-judge", "divergent_dimensions": ["str"], "direction": "str",
     "validated": "bool (against calibration subset)", "interpretation": "str"}
  ],
  "rater_inconsistency": [{"rater_id": "de-identified", "intra_agreement": "float", "action": "retraining|review|none"}],
  "recommendations": ["str"]
}
```

**Example output (abridged)**: for R-001, hypothetical pilot JSON with 5 raters (PLACEHOLDER data — used for schema demonstration only; any real run must use collected judgments): community-expert ICC 0.72 on register fit; divergence cluster D-1 on age-cohort politeness (known_disagreement confirmed by data); LLM judge diverges on "request fulfillment" for ambiguous items — interpretation: judge resolves ambiguity by guessing, a behavior the rubric punishes; recommendation: add explicit ambiguity-handling anchor for judge.

**Validation rules**: V6.1 refuse to run with <2 raters per item per layer. V6.2 disagreement clusters must be preserved in the benchmark's change log (never silently averaged). V6.3 LLM-judge layer agreement reported against calibration subset, not against full set (avoids circularity).

**Failure modes**: treating low community-expert agreement as "community error" → the tool reports divergence symmetrically and always includes the rubric-interpretation-drift hypothesis.

**Privacy/safety**: rater ids de-identified; community_id retained only as coarse stratum (no personal community membership inference published).

---

## 7. `run_cultural_red_team` (Stage 7)

**Purpose.** Attack the benchmark: find gaming paths, shortcuts, stereotype traps, leakage.

**Input schema**
```json
{
  "benchmark_spec": "path", "evaluation_prompts": ["str"],
  "known_model_behaviors": ["str (e.g. sycophancy, position bias, refusal spirals)"],
  "cultural_risk_areas": ["str"]
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "attack_cases": [
    {"attack_id": "A-xx", "attack_type": "shortcut|stereotype_exploitation|translation_artifact|prompt_sensitivity|leakage_probe|judge_gaming|refusal_bait",
     "description": "str", "how_a_model_could_score_high_without_the_construct": "str",
     "severity": "critical|high|medium|low", "repair": "str", "retest": "str"}
  ],
  "leakage_risks": [{"source": "public web|shared corpora|prior benchmark reuse", "probe": "str"}],
  "shortcut_inventory": ["str"],
  "stereotype_traps_found": [{"task_id": "T-xxx", "tempting_stereotyped_path": "str", "note": "trap existence must be confirmed by community raters; the red-team proposes candidates only"}],
  "prompt_sensitivity_probes": [{"variant": "str", "expected_if_robust": "str"}],
  "proposed_repairs": ["str"]
}
```

**Attack generators (minimum set)**: A1 position/paraphrase probe (same item, structurally permuted); A2 stereotype-bait (plausible-sounding group-stereotypic option added to MCQs); A3 sycophancy probe ("I think the answer is X, right?"); A4 refusal-bait (benign cultural content co-occurring with sensitive lexicon); A5 leakage mimicry (near-duplicate of a known public benchmark item); A6 judge-gaming (verbose/fabricated-references response targeting the LLM judge); A7 translation-flip (same item presented in original language vs back-translation; score delta = artifact measure); A8 contamination canary (string-match probe against public benchmark corpora).

**Example output (abridged)**:
```json
{"_status": "degraded",
 "attack_cases": [
  {"attack_id": "A-02", "attack_type": "stereotype_exploitation",
   "description": "MCQ T-004 has only one non-stereotyped distractor pattern; a model that seat-belts stereotype-consistent heuristics gets an optical floor",
   "severity": "high", "repair": "rebalance distractors so stereotype-consistent choice is not systematically associated with correctness; community-rater confirmation required",
   "retest": "rerun A2 after rebalance"}],
 "leakage_risks": [{"source": "public web", "probe": "exact-match + near-dupe (minhash) of task text against CommonCrawl snapshot list, per Sainz et al. 2310.18018 protocol sketch"}]}
```

**Validation rules**: V7.1 all critical/high attacks require a repair + retest entry before go/no-go. V7.2 the red-team may not invent "authentic cultural traps" — it names candidate traps and routes them to community raters for confirmation. V7.3 at least one leakage probe is mandatory on any public benchmark plan.

**Failure modes**: red-team that only finds aesthetic issues (generator minimality enforces the attack set); false positives from the red-team that trigger needless item deletion (repair, don't delete, until retest).

**Privacy/safety**: attack cases referencing sensitive topics stayed with id references; never re-print sensitive content into the red-team report.

---

## 8. `generate_pilot_protocol` (Stage 8)

**Purpose.** Produce a small study validating the benchmark before scale-up.

**Input schema**
```json
{
  "benchmark_spec": "path", "available_communities": ["str"],
  "budget": {"amount": "float|null", "currency": "str", "note": "str"},
  "timeline_weeks": "int", "risk_level": "str"
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "pilot": {
    "objectives": ["str (each objective names which validity/reliability claim it tests)"],
    "design": {"items": "N", "models": "N (minimum 2: one expected strong, one expected weak)",
               "raters_per_item": "N", "layers": ["community", "expert", "llm-judge"]},
    "recruitment_plan": {"channels": ["str|PLACEHOLDER"], "compensation": "str|PLACEHOLDER",
                         "inclusion_criteria": ["str"], "exclusion_criteria": ["str"]},
    "annotation_plan": {"rubrics": ["R-xxx"], "calibration_first": true, "blinding": "as per R-xxx"},
    "sample_size_rationale": "str (power/precision argument or BUDGET UNKNOWN marker)",
    "analysis_plan": ["ICC by layer", "gap analysis by stratum", "worst-group report", "judge validation", "translation artifact delta", "leakage probe results"],
    "go_no_go": [
      {"criterion": "str", "threshold": "str", "decision": "go|revise|stop", "if_no": "str"}
    ],
    "revision_rules": ["which results trigger which spec changes"],
    "unresolved_assumptions": ["str"],
    "budget_assumption": "stated|BUDGET UNKNOWN"
  }
}
```

**Example output (abridged)**: 40-item pilot, 3 models (one open regional multilingual expected-strong, one English-centric expected-weak, one mid), 5 community + 2 expert raters per item, LLM judge on subset; go/no-go: (a) ICC community-expert ≥ 0.7 on ≥60% of dimensions else revise rubric; (b) ≥2 stereotyped traps confirmed by red-team confirmed by raters else re-itemize; (c) score gap strong/weak model in predicted direction else suspect construct validity rather than models; (d) translation artifact Δ ≤ 5 points else reprioritize original-language data. `budget_assumption: "BUDGET UNKNOWN — recruitment plan lists 2 channels as PLACEHOLDER; do not commit dates"`.

**Validation rules**: V8.1 ≥2 models with pre-registered expected ordering (sensitivity to model improvement). V8.2 go/no-go criteria must cover at least one reliability, one validity, one safety finding. V8.3 no invented budget numbers (if amount null ⇒ BUDGET UNKNOWN, consistent with Marian's cost discipline — no guessing costs). V8.4 pilot recruitment may not work without consent instrument (P3 linkage).

**Failure modes**: pilots that only test logistics (V8.1/V8.2 enforce science); pilots that treat themselves as the full benchmark (output must mark unresolved assumptions).

**Privacy/safety**: pilot rater data is research data: consent + withdrawal procedure must exist before the first recruit; the protocol includes an enumeration of withdrawal consequences.

---

## 9. `score_benchmark_quality` (Stage 8)

**Purpose.** Transparent, dimension-level quality assessment. Never a single opaque number.

**Input schema**
```json
{
  "benchmark_package": "path (dir)", "pilot_results": "path|null",
  "audit_results": "path", "documentation": "path"
}
```

**Output schema**
```json
{
  "_status": "ok|degraded|blocked",
  "dimension_profile": [
    {"dimension": "one of the 15 in RUBRIC.md", "score": 0,
     "evidence": "str (file/finding/pilot reference)", "blocker": "bool"}
  ],
  "critical_blockers": [{"rule": "RUBRIC.md §critical id", "where": "str", "required_action": "str"}],
  "readiness": "pilot-not-ready|pilot-ready|scale-ready",
  "next_steps": ["str"],
  "note": "overall level is computed from blocker set and min dimension score, not from an average; average is reported as a convenience statistic with an explicit warning against single-number use"
}
```

**Example output (abridged)**:
```json
{"_status": "ok",
 "dimension_profile": [
  {"dimension": "construct validity", "score": 3, "evidence": "construct_definition.md G1 gate passed", "blocker": false},
  {"dimension": "community involvement", "score": 1, "evidence": "no signed community consult; Stage 2 PLACEHOLDERs unresolved", "blocker": false},
  {"dimension": "safety governance", "score": 0, "evidence": "consent instrument missing", "blocker": true}],
 "critical_blockers": [{"rule": "C8 sensitive data w/o governance", "where": "data_requirements.md", "required_action": "draft consent + withdrawal"}],
 "readiness": "pilot-not-ready"}
```

**Validation rules**: V9.1 dimension scores 0-4 only; V9.2 every score must have evidence reference (no vibes); V9.3 readiness may not be scale-ready while any blocker is true regardless of average; V9.4 report includes the average with the anti-opaque warning text.

**Failure modes**: score inflation in absence of evidence (V9.2), hidden gamed averages (V9.4), blocker override (V9.3 — only a human escalation documented in change log may override, with recorded reason).

**Privacy/safety**: none additional beyond artifact references.

---

## Cross-tool implementation notes

1. Tools are file-in/file-out JSON processors; the skill's workflow is the orchestrator — tools do not call each other.
2. `evidence_manifest` threading through all tools is intentional: any output that references literature without manifest backing fails validation. This operationalizes the grounded-citations skill.
3. PLACEHOLDER discipline: the literal token `PLACEHOLDER` plus a `what_is_needed` note is the only sanctioned way to express missing cultural content. Synonyms (TBD, approx, ~) fail lint.
4. `tools/validate_spec.py` (implementation phase, see IMPLEMENTATION_PLAN.md) runs the V-rules as CI over package directories.
5. Contamination / memorization coverage: the skill is responsible for surfacing contamination risk and membership-inference risk on culturally sensitive data, not only for runtime leakage in the final package. Stage 4 and the `contamination_screening` schema field are the primary hooks; if a language/data source has undocumented web presence or the benchmark item text may plausibly have been seen during training, treat that as a validity claim to be labeled, not as a silent gap. A benchmark whose cultural items are plausibly memorized offers weak evidence about cultural competence even if item-level leakage screening passes.