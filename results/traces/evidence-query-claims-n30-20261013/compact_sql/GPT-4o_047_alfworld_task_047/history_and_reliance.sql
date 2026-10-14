-- Purpose: Test whether step 21's return to drawer 1 depended on a materially incomplete drawer history, versus broad exploratory intent or a different premise; also check independent feedback, later correction, and the c1 semantic-only examine sequence.
WITH mem_drawer /* Trace drawer-1 and closed-state mentions in memory before the step-21 choice; absence of a phrase is not treated as proof of omission. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('drawer 1', 'memory', 1, 21)
), mem_variants /* Find alternative memory wording about closure and the requested objects that could supply a different origin. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('closed', 'alarm clock', 'desk lamp'), 'memory', 1, 21)
), refl_claims /* Inspect reflection's drawer history and decision rationale through the anchor, including alternative task premises. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('drawer', 'closed', 'alarm clock'), 'reflection', 1, 21)
), plan_claims /* Compare plans about drawer exploration and the goal objects before the action, distinguishing specific choice from generic exploration. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('drawer', 'exploring', 'alarm clock'), 'plan', 1, 21)
), plan_topics /* Retrieve source-bound decision-basis/hypothesis clauses on drawer exploration to catch relevant wording beyond exact phrase searches. */ AS (
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('decision_basis', 'hypothesis'), 'plan', 1, 21)
), closed_feedback /* Verify drawer-1 feedback independently across the trajectory; these excerpts report state, not whether opening was possible. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('drawer 1 is closed', 'observation', 1, 30)
), visits /* Track actual movement targets, retaining only drawer 1, to compare the memory's history with recorded visits and later recurrence. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('go', 1, 30)
  WHERE
    JSON_EXTRACT(args, '$[0]') = 'drawer:1'
), late_mind /* Check post-anchor mental text for explicit drawer-1 correction or continued rationale without treating later claims as earlier knowledge. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('drawer 1', ('memory', 'reflection', 'plan'), 22, 30)
), c1_sequence /* Compare c1's semantic examine actions and feedback through step 6; quotation formatting itself is excluded. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('examine desk 1', 'action', 1, 6)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('desk 1', 'observation', 1, 6)
)
/* Preserve original step/module excerpts and action provenance for causal comparison. */
SELECT
*
FROM mem_drawer
UNION ALL BY NAME
SELECT
*
FROM mem_variants
UNION ALL BY NAME
SELECT
*
FROM refl_claims
UNION ALL BY NAME
SELECT
*
FROM plan_claims
UNION ALL BY NAME
SELECT
*
FROM plan_topics
UNION ALL BY NAME
SELECT
*
FROM closed_feedback
UNION ALL BY NAME
SELECT
*
FROM visits
UNION ALL BY NAME
SELECT
*
FROM late_mind
UNION ALL BY NAME
SELECT
*
FROM c1_sequence
ORDER BY
  step,
  module;
