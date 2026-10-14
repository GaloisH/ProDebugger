-- Purpose: test whether step 16's cabinet-8 choice rests on an unsupported claim that cabinets 1–7 were opened, versus reasonable exploration, and trace prior claims, recorded searches, feedback, and later correction.
WITH claims /* Retrieve earlier cabinet-7/opening/sequence/ladle claims in all mental modules; step bounds cover the full lead-up rather than assuming step 15 is the origin. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('cabinet 7', ('memory', 'reflection', 'plan'), 1, 16)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('sequentially', ('memory', 'plan'), 1, 16)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('ladle', ('memory', 'reflection', 'plan'), 1, 16)
), peers /* Retrieve same-step peer reasoning wherever an earlier claim was found, to distinguish assertions, hypotheses, and decision rationale. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('cabinet', ('memory', 'reflection', 'plan'), 1, 16)
  WHERE
    step IN (
      SELECT
      step
      FROM claims
    )
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('decision_basis', 'plan', 1, 16)
  WHERE
    step IN (
      SELECT
      step
      FROM claims
    )
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('result_assessment', 'memory', 1, 16)
  WHERE
    step IN (
      SELECT
      step
      FROM claims
    )
), actions /* Track original cabinet movements and opening attempts through the lead-up; these action elements test whether cabinets were actually opened, not merely visited. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION(('go', 'open_action'), 1, 16)
), feedback /* Retrieve independent opening feedback and cabinet-7 observation excerpts through step 16; being on top of a cabinet is distinct from inspecting its interior. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('You open cabinet', 'cabinet 7', 'nothing on it'), 'observation', 1, 16)
), later_mind /* Trace subsequent cabinet decisions and ladle-related updates only for steps 17–30, checking for reliance, changed strategy, or recovery without assuming the final opening's result. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('cabinet', 'ladle'), ('memory', 'reflection', 'plan'), 17, 30)
), later_events /* Preserve later original cabinet actions and feedback as evidence of propagation or correction; post-step-16 evidence cannot establish earlier knowledge. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION(('go', 'open_action'), 17, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('ladle', 'cabinet'), 'observation', 17, 30)
)
SELECT
*
FROM claims
UNION ALL BY NAME
SELECT
*
FROM peers
UNION ALL BY NAME
SELECT
*
FROM actions
UNION ALL BY NAME
SELECT
*
FROM feedback
UNION ALL BY NAME
SELECT
*
FROM later_mind
UNION ALL BY NAME
SELECT
*
FROM later_events
ORDER BY
  step,
  module;
