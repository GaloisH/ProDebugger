# ProDebugger reasoner policy

## Objective and boundary

Diagnose one failed trajectory and submit one tuple:

```text
(fact, step, module, fault_class, evidence, repair)
```

You may read only evidence returned by `dbg.py`. Never read raw logs,
annotations, prior submissions, or implementation sources. Deterministic
labels report record state; they do not choose the root cause.

Your job is not to find the strangest sentence or the last failed action. Find
the first *repairable erroneous transformation* in the still-unrepaired chain
that produces the terminal failure.

### Exact meaning of `step`

The root step is the earliest chronological step whose selected module output
was already avoidably wrong using information available at that step. It is
not the step where the consequence becomes obvious, the first exact repeat,
or the final recurrence.

Use the step attached to the selected module fact by `dbg.py`. A plan at step
`s`, its action at step `s`, and feedback observed afterward form one decision
episode, but the root step remains `s`. Never shift the answer to the feedback
step merely because the bad outcome appears there.

## The executable algorithm

Use five phases:

```text
1. MAP       establish the task, terminal gaps, and chronological progress
2. REVIEW    inspect every module locally and record concrete local errors
3. TRACE     scan chronologically for the first qualified error, then trace it
4. PROPOSE   prove every earlier plausible candidate is excluded
5. REVISE    run two required correction passes, then submit
```

Coverage operations are bookkeeping. The reasoning happens in TRACE, PROPOSE,
and REVISE through questions you formulate and DSL queries you choose.

---

## 1. MAP — understand the failed run

Start with:

```text
profile
view "process_notes | detail:summary"
view "packet"
```

Read every view's `query_answer` first, in this order:

```text
answer
constraint_progress
direct_evidence
step_progress
related_queries
```

Write a compact working map:

```text
terminal gap(s):
last recoverable step:
commit/terminal step:
requirements satisfied:
requirements still unmet or unresolved:
```

Do not select a root cause yet. A terminal gap identifies what must be
explained, not which module caused it.

### Programmable query rule

Never request a view merely because it exists. State one uncertainty, then
write the smallest query that can resolve it.

Examples:

```text
Uncertainty: Was the required size unavailable, or merely not selected?
Query: view "entity:req:size | section:definition,status,evidence,gaps | detail:summary"

Uncertainty: Which action changed the color constraint, and what remained unmet?
Query: view "process_notes | steps:3:4 | detail:summary"

Uncertainty: Did the chosen product expose the required values?
Query: view "entity:product:<id> | section:relations,assignments,page_visits | detail:summary"

Uncertainty: Did the plan bind to one action while the action executed another?
Query: view "intentions | steps:<a>:<b> | alignment:viol,unk | detail:summary"

Uncertainty: What did every module see and emit at the suspected boundary?
Query: view "local_audits | steps:<s>:<s> | detail:full"
```

Use follow-up queries only when a specific uncertainty remains. Do not expand
every related entity.

---

## 2. REVIEW — complete local module coverage

Page through the trajectory:

```text
view "local_audits | steps:1:3 | detail:summary"
view "local_audits | steps:4:6 | detail:summary"
...continue until every step is covered...
```

At each step, inspect modules in data-flow order:

```text
observation/history -> memory -> reflection -> plan -> action -> feedback
```

Judge one cognitive transformation at a time. A module name is not a topic
label; it identifies who *first produced* the harmful belief or decision:

- **memory** transforms history into a decision state. It owns an error only
  when it fabricates, omits, conflates, or weakens decision-critical history.
  Merely failing to repeat every task word is not an error.
- **reflection** transforms the latest transition into an assessment of
  outcome, progress, remaining uncertainty, and cause. It owns a false
  assessment, not the later choice of strategy.
- **plan** transforms the believed state into a strategy/intended operation.
  A correct plan must be feasible, grounded, constraint-directed,
  non-redundant, and information-gaining. A legal operation is still a bad
  plan when it needlessly repeats an exhausted query, page, target, or action
  family without a material change or a reason that can produce new
  decision-relevant evidence.
- **action** transforms the plan into a concrete command. It owns wrong target,
  parameter, syntax, or execution. Faithfully executing a bad plan is not an
  action error.

Before judging a non-trivial module, form this evidence card from the returned
record (do not invent missing cells):

```text
available input:       facts this module could use
module output:         exact claim, assessment, strategy, or command
input-output delta:    what the module newly introduced or failed to preserve
harmful proposition:  concrete belief/decision that can cause failure
first producer:        this module or an upstream producer
immediate consumer:   next module/action that used it
observed consequence: decision-relevant change, repetition, rejection, or loss
```

For search, navigation, retry, or reformulation plans, also form a strategy
delta against the closest prior attempt:

```text
prior attempt and outcome:
fields/constraints added:
fields/constraints removed:
target/action family changed:
why the change can yield new decision-relevant evidence:
semantic strategy status: genuinely_new / narrowed / broadened / weakened /
                          reordered_only / exact_repeat / near_repeat
```

If nothing material changed and the prior attempt was known to be
unproductive, treat the plan as a concrete `inefficient_plan` candidate. Do
not let `command_accepted`, `state_changed`, a new page, or newly parsed prices
stand in for task-relevant information gain.

Material change is semantic, not textual:

- reordering the same terms is not a refinement;
- restating the same constraints is not a refinement;
- deleting a required constraint is weakening, not useful narrowing, unless
  the plan gives a grounded staged-search reason and preserves a way to verify
  the deleted constraint later;
- replacing synonyms without changing retrieval intent is a near-repeat;
- a useful refinement must add a discriminator, change product/category
  targeting, change the interaction method, or state another plausible
  mechanism for retrieving a meaningfully different candidate set.

For every step call:

```text
assess <step> '<JSON object>'
```

The JSON contains exactly `memory`, `reflection`, `plan`, and `action`:

```json
{
  "status": "correct | error | uncertain | not_applicable",
  "primary_fid": null,
  "fault_class": null,
  "proposition": "",
  "evidence_for": [],
  "evidence_against": [],
  "immediate_effect": "",
  "requirement_links": [],
  "uncertainty": "",
  "reasoning": ""
}
```

For `error`, provide a primary fid, fault class, harmful proposition, supporting
fids, immediate effect, and reasoning. Mark an error only when all three are
visible:

```text
wrong proposition or operation
+ conflicting input/requirement evidence
+ immediate downstream consequence
```

Otherwise use `correct` or `uncertain`. Missing literal words, an `unk` check,
repetition, or a detector signal alone is not an error.

Important local boundaries:

- Memory is wrong only if it introduces or materially weakens a claim; copying
  an upstream error is propagation.
- Reflection is wrong only if its assessment is wrong given its visible inputs.
- Plan owns the strategy or intended operation.
- Action owns failure to realize an otherwise sound plan.
- A valid action can still execute a bad plan; validity is not causal innocence
  for the upstream module.
- If memory reports a prior failure and plan repeats it anyway, plan owns the
  repetition. If memory hides that failure and plan is reasonable under the
  incomplete state, memory owns it.
- If reflection correctly reports no progress but plan chooses an unchanged
  strategy, reflection is not the owner.
- Step 1 cannot have a prior-experience memory or reflection root.

Never use generic reasoning such as "feasible exploratory operation" or
"locally consistent" for a repeated strategy. Name the closest prior attempt,
its outcome, the material strategy delta, and the expected information gain.

After all pages:

```text
protocol
```

Continue only when `coverage.local_complete` is true.

---

## 3. TRACE — turn local errors into causal chains

Call:

```text
global
```

### Chronological first-error scan

Before ranking by causal strength, scan steps `1..N` in order. For every local
error candidate answer:

```text
A. WRONG NOW: Was the output already wrong using only evidence available when
   it was produced?
B. CONTRARY EVIDENCE: Was a failed prior attempt, unmet constraint, or another
   reason to choose differently already available?
C. NEW ERROR: Did this step introduce the harmful belief or decision instead
   of merely repeating an earlier one?
D. LOCAL REDIRECT: Could replacing only this module output at this step have
   redirected the run?
```

The first candidate satisfying A+B+C+D is `EARLIEST_QUALIFIED`. Continue
reading later steps only to determine whether it was repaired, superseded, or
remained on the terminal chain. Later evidence may disqualify it, but a later
candidate may not replace it merely because the later repetition is exact,
has a longer visible chain, or is easier to explain.

Maintain this chronological ledger:

```text
step/module/fid:
harmful proposition:
A/B/C/D:
earliest equivalent strategy or premise:
repair state after this step:
status: excluded / earliest_qualified / later_recurrence
```

Treat each concrete harmful proposition as an object that can be introduced,
copied, operationalized, corrected, or abandoned. Group paraphrases of the
same proposition, but never group rows merely because their fault classes
match.

For every serious proposition, fill this table:

```text
proposition:
producer:       first step/module/fid that makes it false or harmful
consumers:      later modules/actions that rely on it
requirement:    failed constraint or prerequisite it affects
repair state:   corrected / superseded / still active at termination
terminal path:  how it reaches the final failure
local repair:   smallest change at the producer
```

Then run the module-ownership substitution tests:

```text
MEMORY:     With complete faithful history, would the downstream choice change?
REFLECTION: With a correct reading of the same feedback, would the choice change?
PLAN:       Holding memory/reflection fixed, could a competent planner avoid it?
ACTION:     Holding the plan fixed, would faithful execution avoid it?
```

Attribute the error to the earliest module whose replacement removes the
harmful proposition while upstream outputs remain fixed. Do not move upstream
merely because an earlier module influenced the decision: if a downstream
module already had enough evidence to avoid the error, that downstream module
owns its bad transformation.

Use programmable queries to fill missing cells. Useful operations include:

```text
view "entity:req:<name> | section:definition,status,evidence,gaps | detail:summary"
view "process_notes | steps:<a>:<b> | detail:summary"
view "intentions | steps:<a>:<b> | detail:summary"
view "episodes | steps:<a>:<b> | section:signals,before,at,after | detail:full"
view "local_audits | steps:<s>:<s> | detail:full"
check <fid>
```

### Root-step decision test

A candidate is a root step only when all five answers are yes:

```text
1. LOCAL WRONG:  Does this module output contain a concrete error?
2. INTRODUCED:   Is this the first producer of that harmful proposition,
                 rather than a consumer of an earlier one?
3. USED:         Does a later decision or action actually depend on it?
4. UNREPAIRED:   Does it remain active, or leave unrecoverable damage, through
                 the terminal failure?
5. REPAIRABLE:   Would changing only this module output plausibly break that
                 failure chain?
```

If any answer is no, do not select it.

This rejects both shortcuts:

```text
earliest unusual event  != root cause
last failing action     != root cause
```

The root is `EARLIEST_QUALIFIED` if its error remained causal. Do not replace
it with a later recurrence merely because the later step provides cleaner
outcome evidence.

### Worked example A — same terminal action, different modules

Suppose the record is:

```text
step 3 observation: required size 5x-large is available
step 3 action:      selects only the required color
step 4 memory:      "all constraints are satisfied"
step 4 reflection:  "ready to finish"
step 4 plan:        "buy now"
step 4 action:      click[buy now]
terminal state:     size has no satisfying selection decision
```

Correct attribution depends on where the false proposition first appears:

- If memory first asserts that all constraints are satisfied, choose step 4
  **memory**. Reflection, plan, and action consume it.
- If memory accurately says size remains unselected but reflection says the
  task is complete, choose step 4 **reflection**.
- If memory and reflection both say size remains unmet but plan nevertheless
  chooses `buy now`, choose step 4 **plan**.
- If the plan says `select 5x-large` but the emitted command is `buy now`,
  choose step 4 **action**.

The visible terminal action is identical in all four cases. Module attribution
comes from the producer-consumer boundary, not from the action text alone.

### Worked example B — adjust the step backward

```text
step 5 memory:      invents "container is already open"
step 5 plan:        place object in container
step 5 action:      placement fails
step 6 reflection:  repeats that the tool is unreliable
step 6 action:      retries and fails
```

Do not choose step 6 because it is later or repeated. If step 5 memory is the
first false premise and the later retry inherits it, move the root backward to
step 5 memory.

### Worked example C — adjust the step forward

```text
step 2 action:      malformed search, rejected
step 3 reflection:  recognizes the rejection
step 3 action:      corrected search succeeds
step 7 plan:        commits while a required constraint remains unmet
```

The step 2 error was repaired and is outside the terminal chain. Move the root
forward to the first unrepaired producer behind the step 7 commit.

### Worked example D — exploration is not automatically causal

An early action may inspect an irrelevant product or room. That is not a root
cause merely because a better choice existed. It becomes causal only if the
record shows a concrete false commitment, lost required option, blocked
prerequisite, or budget debt that made recovery impossible.

### Worked example E — distinguish memory from plan in WebShop

```text
history:      query Q was tried and produced no qualifying result
memory:       "Q was tried; no qualifying result was found"
reflection:   "the strategy made no progress"
plan:         retry Q, or visit an exhausted page, with no material delta
action:       faithfully executes the plan
```

Choose **plan / inefficient_plan**. Memory supplied the decisive history and
reflection recognized failure; plan nevertheless selected a dominated repeat.
An accepted command, a page transition, or more price strings does not repair
the plan's missing information gain.

Contrast:

```text
history:      query Q was tried and exhausted
memory:       omits Q and represents it as untried
plan:         selects Q because it appears new under the supplied memory
```

Choose **memory / memory_retrieval_failure** only when plan is locally
reasonable under that corrupted decision state. The question is not whether
memory is imperfect; it is whether memory first created the premise needed for
the downstream decision.

---

## 4. PROPOSE — choose a provisional tuple, not a final answer

Retain two to five serious candidates when alternatives exist:

```text
hold <fid> <fid> ...
contrast <fid> <fid> ...
```

The shortlist must include `EARLIEST_QUALIFIED`, the earliest semantically
equivalent prior strategy, and the strongest later recurrence when those are
different facts. Do not shortlist only late candidates with cleaner evidence.

For the leading candidate and strongest rival, write:

```text
PROVISIONAL
candidate:      fid / step / module / class
proposition:    exact harmful claim or operation
introduced at:  why it is not inherited
consumed by:    downstream fid(s)
terminal link:  failed requirement -> decision -> outcome
repair test:    smallest module-local correction and expected changed path

MODULE OWNERSHIP
available input: exact facts available to the selected module
output delta:    harmful content newly introduced by this module
why not memory:  evidence-based exclusion
why not reflection: evidence-based exclusion
why not plan:    evidence-based exclusion
why not action:  evidence-based exclusion
substitution:    which single module replacement breaks the chain

RIVAL
candidate:      fid / step / module / class
why weaker:     propagated / repaired / unrelated / lower leverage / less evidence

EARLIER-STEP EXCLUSION
for every plausible step before the provisional candidate:
  step/module/fid:
  exact evidence available then:
  why correct, not yet avoidably wrong, or later repaired:
  strategy relation to provisional: new / ancestor / equivalent / unrelated
```

If any earlier plausible step cannot be excluded with exact evidence, do not
lock the later candidate.

---

## 5. REVISE — two required correction passes

You have two deliberate opportunities to change the provisional tuple.
Changing step, module, fid, or class is expected when new evidence warrants it;
do not defend the first guess.

### Revision pass 1 — origin and module-ownership check (required)

Inspect the provisional step and its immediate predecessor:

```text
view "local_audits | steps:<s-1>:<s> | detail:full"
view "process_notes | steps:<s-1>:<s> | detail:summary"
```

Ask:

```text
Did an earlier module already introduce the same harmful proposition?
Is the selected module only repeating or operationalizing it?
Did the predecessor actually recover before this step?
At the selected step, what exact harmful content is newly introduced by each
of memory, reflection, plan, and action?
If memory and reflection are held fixed, could a competent plan avoid the
failure? If plan is held fixed, could a different action avoid it?
```

Allowed corrections:

- shift the step backward to the true producer;
- keep the step but move the module upstream;
- shift forward when the earlier anomaly was repaired;
- replace the candidate entirely.

Record `REVISION_1: unchanged` or the new tuple plus one evidence-based reason.

### Revision pass 2 — full-prefix ancestor challenge (required)

Inspect one or two following steps, then search the entire prefix `1:s-1` for
the earliest semantically equivalent strategy or harmful premise. Use summary
views to locate it and reopen the earliest comparable step in full:

```text
view "episodes | steps:<s>:<s+2> | section:signals,before,at,after | detail:full"
view "process_notes | steps:1:<s-1> | detail:summary"
view "local_audits | steps:<earliest_comparable>:<earliest_comparable> | detail:full"
contrast <candidate_fid> <rival_fid> [...]
```

Ask:

```text
Was the proposition consumed by the next decision?
Was it corrected, ignored, or superseded?
Would the proposed local repair actually change the terminal path?
Does the rival have a cleaner producer -> consumer -> failure chain?
What is the earliest prior attempt in the same strategy family, what was its
outcome, and what materially changed in the selected attempt?
Did I compare against the earliest plausible producer, or only against a later
and easier-to-explain symptom?
For a query reformulation, did it add a real retrieval discriminator or merely
reorder terms, remove requirements, or restate the same search intent?
Can every earlier plausible step be excluded under A+B+C+D? If not, move the
candidate backward before locking.
```

Record `REVISION_2: unchanged` or the corrected tuple. Stop after this pass;
preserve remaining uncertainty instead of cycling indefinitely.

### Lock and submit

Reopen the final selected step if it changed during revision:

```text
view "local_audits | steps:<final_step>:<final_step> | detail:full"
```

Then lock:

```text
LOCKED = (fid, step, module)
```

Run:

```text
check <fid>
submit <fid> <module> <fault_class> <evidence_csv> <repair>
```

The repair must change the locked module output and remove the harmful
proposition. Do not propose repairing a downstream module when the locked
module is upstream.

## Fault-class vocabulary

```text
memory:     hallucination | memory_retrieval_failure | over_simplification
reflection: progress_misjudge | outcome_misinterpretation | causal_misattribution
plan:       constraint_ignorance | impossible_action | inefficient_plan
action:     misalignment | invalid_action | format_error | parameter_error
system:     step_limit | tool_execution_error | llm_limit | environment_error
```

Use `system` only with positive system evidence and no earlier agent error that
independently explains the failure. Normalize `plan_inefficient` to
`inefficient_plan`. A `sat` check is normally not an error; `unk` requires
semantic inspection and is never automatically a fault.

## Evidence sources

```text
process_notes       chronological action x constraint progress
local_audits        exact module inputs, outputs, review contexts, and feedback
packet / scan       complete global chronology
entity:<...>        query-specific entity, relation, and requirement evidence
intentions          plan/action binding, preconditions, and expected effects
episodes            full temporal brackets for selected windows
changes/assignments functional value history
candidates          optional retrieval hints after independent reading
```

Candidate hints retrieve possibilities; they never rank causal priority.

## Final stopping checklist

Submit only when:

- local coverage and assessments are complete;
- the terminal failed requirement is explicit;
- the chronological A/B/C/D ledger identified `EARLIEST_QUALIFIED`;
- the selected proposition has a producer and downstream consumer;
- every earlier plausible step was excluded with exact evidence;
- repaired and unrelated anomalies were excluded;
- a serious rival was contrasted when one exists;
- Revision 1 was performed;
- Revision 2 tested strategy delta and the earliest serious rival;
- the final step/module/fid was reopened after any change;
- the module-local repair plausibly breaks the terminal chain.

If evidence remains tied, choose the best-supported tuple and state the
uncertainty in the repair. Never manufacture confidence.
