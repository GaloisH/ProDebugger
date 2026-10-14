-- Purpose: test whether the tentative cabinet-first rationale became a rigid cabinet-only policy that caused the cutoff, against the rival of reasonable exploration with drawer adaptation; separately inspect c1 actions without treating excluded serialization as a fault.
WITH mental /* Retrieve pan/cabinet/drawer decision language across memory, reflection, and plans from steps 1-30 to trace whether the basis changes or narrows. */ AS (
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM SEARCH_TEXT(('pan', 'cabinet', 'drawer'), 'memory', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM SEARCH_TEXT(('pan', 'cabinet', 'drawer'), 'reflection', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM SEARCH_TEXT(('pan', 'cabinet', 'drawer'), 'plan', 1, 30)
), claim_topics /* Discover decision-basis, hypothesis, result-assessment, and expected-gain clauses across the mental trajectory, including wording variants. */ AS (
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM FIND_CLAIMS(('decision_basis', 'hypothesis', 'expected_gain'), 'plan', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM FIND_CLAIMS(('decision_basis', 'result_assessment', 'hypothesis'), 'reflection', 1, 30)
), peer_text /* Retrieve same-step peer mental excerpts about the pan and alternatives at steps discovered by the decision-claim branches. */ AS (
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM SEARCH_TEXT(('pan', 'drawer'), 'plan', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM SEARCH_TEXT(('pan', 'drawer'), 'reflection', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM SEARCH_TEXT(('pan', 'drawer'), 'memory', 1, 30)
), actions /* Track original go/look/open_action elements over the full 30 steps to distinguish cabinet repetition, drawer exploration, and c1 semantic actions. */ AS (
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, fid, source_kind, rel, args
  FROM TRACK_ACTION(('go', 'look', 'open_action'), 1, 30)
), feedback /* Retrieve original feedback mentioning pan, drawers, cabinet outcomes, and countertop contents; these are action consequences, not earlier knowledge. */ AS (
  SELECT
  step, module, text, source_id, fid, source_kind
  FROM SEARCH_TEXT(('pan', 'drawer', 'countertop'), 'observation', 1, 30)
)
/* Combine mental origins, decision-topic clauses, same-step peers, recorded actions and observations without reconstructing full modules. */
SELECT
*
FROM mental
UNION ALL BY NAME
SELECT
*
FROM claim_topics
UNION ALL BY NAME
SELECT
*
FROM peer_text
UNION ALL BY NAME
SELECT
step, module, text, fid, source_kind
FROM actions
UNION ALL BY NAME
SELECT
*
FROM feedback
ORDER BY
  step,
  module;
