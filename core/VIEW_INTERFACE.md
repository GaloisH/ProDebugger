# Programmable evidence views

`view` is the reasoner's read interface over a compiled trajectory. The
reasoner writes a small declarative program; the executor returns deterministic
JSON. It is deliberately not Python and cannot create facts, run arbitrary
code, or decide the root cause.

The architecture separates three responsibilities:

1. The domain profile compiles text into entities, relations, requirements,
   intentions, and fact ids.
2. A view assembles those facts around one debugging question and may derive
   only narrow labels such as constraint match, recorded satisfaction, or local
   support.
3. The reasoner chooses the next view, records local semantic judgements,
   compares causal candidates, and makes the root-cause judgement.

Intention rows expose the parsed direct action, typed parameters, many-to-many
constraint links, preconditions, expected effects, and grounded
`execution_options`. An option may be a prerequisite substep (for example,
returning to the search page before submitting a refined query) or an explicit
alternative. The validator reports which option the actual action realized.

Every returned claim is traceable to fact ids. `status` always means "what the
compiled record establishes", not hidden environment truth.

The `requirements` source also returns `task_contract.verbatim`. It is the
authoritative request. Labelled fields become dynamic property constraints;
free-text qualifiers are retained as `semantic_match` constraints. Literal
containment in item-page evidence can verify them; other cases remain
`state:unresolved`. Coverage remains marked
`not_proven_exhaustive`: preserving a phrase is not the same as fully parsing
its internal semantics.

## Language

```text
<source> [| <stage>:<value>]...

source := requirements
        | scan
        | local_audits
        | candidates
        | candidate_families
        | packet
        | intentions
        | episodes
        | changes
        | assignments
        | process_notes
        | entity:<kind>:<index>

stage  := section:<name,...>
        | state:satisfied|unmet|unresolved
        | steps:<first>:<last>
        | event:<observation,claim,decision,change,initial_assignment>
        | support:<sat,viol,unk>
        | qualification:<yes,no,partial,unknown>
        | slot:<obs,mem,refl,plan,act,chk>
        | entity:<kind:index>
        | relation:<name,...>
        | side:<env,mind,task,dbg>
        | purpose:<kind:index>
        | constraint:<req:index>
        | mention:present|missing
        | commitment:<explore,inspect,select,navigate,commit,unknown>
        | binding:<full,verb_only,unbound,absent>
        | alignment:<sat,viol,unk>
        | precondition:<sat,viol,unk>
        | effect:<observed,missing,unk>
        | constraint_relation:<satisfies,substitutes,explicitly_preserves,
          already_satisfied,evidence_available_unverified,unmentioned,unmodeled>
        | signal:<invalid_action,alignment_violation,unbound_intention,
          failed_precondition,missing_effect,constraint_substitution,no_effect,
          state_change,task_state_change,new_task_evidence,no_new_task_evidence,
          repeated_action,near_duplicate_action,schema_repetition,
          claims_task_complete,contradicted_completion,
          commit,terminal_cutoff,task_decision,
          wrong_task_decision,satisfying_task_decision>
        | detail:summary|full
        | limit:<integer>
```

Stages compose from left to right. Invalid sources, filters, entities, and
sections fail explicitly instead of returning a plausible empty answer.

## Canonical questions

```text
# First pass: read every step in order without expanding the observation graph.
view "scan | detail:summary"

# Read deterministic observation -> action -> response notes for a step range.
view "process_notes | steps:3:4 | detail:summary"

# Complete global handoff without detector anchoring.
view "packet"

# Complete local-first pass in bounded pages.
view "local_audits | steps:1:3 | detail:summary"
view "local_audits | steps:4:6 | detail:summary"

# Full-fidelity local judgement after a step is selected.
view "local_audits | steps:6:6 | detail:full"

# Optional second-pass detector hints.
view "candidate_families"
view "candidates"

# Which constraints remain unmet, and why does the record say so?
view "requirements | state:unmet | section:definition,status,gaps"

# For size, show only offered values that satisfy the task constraint.
view "entity:req:size | section:evidence | event:observation | qualification:yes"

# For size, show contradicted or unresolved mental claims.
view "entity:req:size | section:evidence | event:claim | support:viol,unk"

# Show every explicit state transition involving the agent.
view "changes | entity:agent:self"

# Show all recorded assignments involving the size attribute.
view "assignments | entity:attribute:size"

# Did plans or actions explicitly mention the size constraint?
view "intentions | constraint:req:size | mention:missing | detail:summary"

# Show commits made with a violated precondition and the unresolved bindings.
view "intentions | commitment:commit | precondition:viol | detail:summary"

# Find intentions that substitute a required value or have unresolved effects.
view "intentions | constraint_relation:substitutes"
view "intentions | effect:missing,unk"

# Route to candidate steps, then inspect one temporal bracket in full.
view "episodes | signal:wrong_task_decision,contradicted_completion,failed_precondition,near_duplicate_action,schema_repetition | section:signals,before,at,after | detail:summary"
view "episodes | steps:6:8 | section:signals,before,at,after | detail:full"

# Assemble all evidence about one product or intention.
view "entity:product:b00o30jldk | section:assignments,page_visits"
view "entity:int:i4 | section:definition,execution"
```

Every successful DSL query also returns a flat `query_answer`. It answers the
current query before offering expansion routes:

```text
focus                    entity and kind named by the query
answer                   state, step, conclusion, evidence and decision counts
constraint_progress      one row per linked requirement: record state,
                         evidence_state, execution_state, verification mode,
                         evidence/decision fids, and last transition
relations                relation counts and latest fact for the focal entity
direct_evidence          flat fid/step/source/relation/value/text/meaning rows
step_progress            flat action x requirement execution rows
related_queries          executable follow-up queries, not expanded entity trees
coverage                 returned/selected counts and explicit truncation
```

`direct_evidence` is the default reasoning surface: every row prints the source
text and states only its role relative to the query. `constraint_progress`
separates relevant evidence from execution/discharge and reports whether the
constraint is selection-, observation-, or semantic-verified. `step_progress`
shows what action occurred while each linked constraint was satisfied, unmet,
or unresolved. Related entities are not recursively expanded; follow one of
the supplied queries only when needed. `detail:summary` also collapses repeated
offered values into counts plus matching/representative evidence. Use
`detail:full` for the uncompressed structure.

`process_notes` is built once after record compilation. Each step note preserves
the raw observation, all four agent modules, the emitted action, the next
environment response, requirement states/transitions, action admissibility,
functional assignments, touched entities, flags, and evidence fids. Flags such
as `constraint_unmet`, `constraint_unresolved`, `action_rejected`, and
`no_observed_effect` describe record state only. They do not name a faulty
module or choose a root cause.

`packet` is the coverage-complete global representation. It returns:

```text
contract              verbatim task and parser coverage boundary
requirements          terminal typed constraint ledger
feasibility           conservative contract-tension cues
linear_scan           one loss-bounded row for every step
supported_reasoning_routes
                      default local-first plus global/structural challenger
candidate_*_query     addresses for optional second-pass hints
```

Candidate families are deliberately absent from the packet. This lets the
reasoner form a global hypothesis without being anchored by frequent detector
cues. The candidate generator can propose but cannot rank root causes. Each
`candidate_family` groups every occurrence of one `(module, trigger)` pair and
returns its occurrence steps and fact ids. This prevents a frequent generic
signal from occupying many apparent ranking positions. `trigger`,
`local_repair`, first/last occurrence, list order, and
`ranking_status:unranked` are hypothesis scaffolding—not probability, severity,
or causal priority. The reasoner must compare families pairwise, reject
propagation and recovered anomalies, and resolve the exact repair-frontier step
and module from detailed evidence. It may add a candidate visible in the scan
even when no deterministic trigger proposed it.

`local_audits` is the complementary coverage-complete local representation.
For every step and each of memory, reflection, plan, and action, it returns:

```text
step_summary        readable observation -> modules -> next-response narrative
transition          lossless source text for observation, four modules, and response
recent_history      bounded preceding action/response pairs
shared_context      task state, parsed facts, targets, intention, and preconditions
outputs             compiled facts emitted by the module
review_context      actual input text, exact output, next feedback, evidence scope,
                    and the module-specific local review question
derived_checks      support, claims, constraint and exploration coverage
judgement           always not_computed; semantic classification belongs to the LLM
```

Its `coverage` object states both the included step/module range and the
important boundary: structured facts are complete over the compiled record;
the source envelope preserves exact module prose and environment turns without
claiming that the parser understood every semantic detail. The submission protocol
requires a complete local-first pass followed by a post-local global comparison.
Earlier global views remain available as orientation or as an independent
challenger, but cannot replace local module coverage. Long local-first reads should be paged with
`steps:a:b`; every page reports `returned_steps`,
`requested_range_complete`, and `whole_trajectory_complete`, so coverage can be
verified without putting the whole audit into one prompt.

## Workflow state

`view` returns evidence; it never stores an LLM judgement. The separate
`assess` operation records one `local-judgement/v2` object for all four modules
of a step:

```text
assess 6 '<JSON object with memory, reflection, plan, and action>'
```

Each module records `status`, `primary_fid`, `fault_class`, `proposition`,
`evidence_for`, `evidence_against`, `immediate_effect`, `requirement_links`,
`uncertainty`, and `reasoning`. Status is `correct`, `error`, `uncertain`, or
`not_applicable`. The executor validates shape, vocabulary, module ownership,
fact scope, and requirement identifiers. It does not decide whether the LLM's
semantic judgement is correct.

`protocol` exposes the auditable state machine:

```text
coverage.audit_read_steps
coverage.assessed_steps
coverage.missing_assessment_steps
coverage.local_complete
global_review_after_local
full_audit_steps_after_global
held_candidates
```

`global` is the stage-transition operation. It is available only after local
completion and returns `{local_error_ledger, local_instances,
local_status_counts, packet,
selection_protocol, protocol}`. `selection_protocol` follows the AgentDebugX
state-aware sequence: cluster repeated instances, determine repair and terminal
chain state, then select the earliest origin still in that chain. A plain packet
view is useful for orientation but cannot mark global review complete.

Submission requires complete assessments, a later `global` review, a held
candidate shortlist (two or more when multiple local errors exist), comparison
of held rivals, and a post-global full local audit of the selected step.

To reopen an occurrence or a short interval around it, use:

```text
view "candidates | steps:<first>:<last>"
view "episodes | steps:<first>:<last> | section:signals,before,at,after | detail:full"
```

The current general trigger vocabulary includes contradicted claims, candidate
dismissal, memory coverage loss, premature completion, constraint substitution,
acknowledged strategy failure, broad enumeration commitments, repeated
low-yield strategy, failed preconditions, invalid actions, plan/action mismatch,
wrong task decisions, contract-feasibility tension, and terminal cutoff. These
names describe why evidence was retrieved; they are not output fault classes.

`scan | detail:summary` is the packet's loss-bounded linear component. It
returns the task contract, terminal requirement states, and one compact row per
step containing all four agent modules, control validation, repetition and
budget history, target-kind availability, local outcome, partial product
candidates, and traceable fact ids. Plain `scan` retains longer text and four
product candidates for audit. Neither form chooses a diagnosis.

## Semantic boundaries

- An offered value is an available option, not a selection.
- A task-matching observation is qualifying evidence, not a discharged
  requirement.
- A mental claim is neither true nor causal merely because it mentions the
  required value; inspect its support and downstream use.
- `episodes.at.modules` exposes memory, reflection, plan, and action together.
  `module_analysis.contract_coverage.not_literal` is a cue to inspect whether a
  detail was lost and consumed, not proof of omission fault.
- `episodes.before.action_history` distinguishes exact repetition, repetition
  of an action schema, repetition over the same target family, and near-duplicate
  action text. These are routing facts, not anomaly scores.
- `episodes.before.budget_history` separates invalid, no-effect, productive,
  and unproductive prior steps. `after.budget_effect` reports the current
  step's observed budget consequence. A recovered command error still consumed
  a finite step; neither field decides whether that cost was critical.
- `episodes.before.available_targets` is a compact inventory of target kinds
  exposed so far. It deliberately does not rank them. The reasoner must compare
  alternatives using task dependencies, expected information gain, and domain
  semantics instead of assuming that systematic enumeration is efficient.
- `episodes.at.decision_boundary` records whether the action commits, which
  requirements remain unresolved, and which mental slot first turns a
  completion claim into authorization to commit. This helps distinguish a
  false premise from the later assessment that operationalizes it.
- `module_analysis.memory.exploration_coverage` compares previously acted-on
  entities with the entities retained in the current memory. Omission becomes
  causal evidence only if it drives a revisit or loses a needed option.
- `episodes.after.observed_products` compacts product attributes visible on the
  next page. Before accepting a claim that no relevant candidate exists,
  compare these partial candidates with the contract; incomplete verification
  is not the same as irrelevance.
- Missing literal text in a plan is not by itself proof that the plan dropped a
  constraint.
- `changes` returns transitions after an initial state. `assignments` includes
  both initial assignments and later transitions.
- Dynamic properties and values carry explicit types and source spans. A
  free-text qualifier is reported as unresolved rather than silently treated as
  satisfied.
- Price observations currently have no `chosen(price, value)` discharge fact;
  price status carries this limitation explicitly.
