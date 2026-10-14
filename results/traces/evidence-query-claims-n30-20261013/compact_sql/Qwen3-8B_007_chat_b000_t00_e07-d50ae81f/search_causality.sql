-- Purpose: test whether c1's “no results” premise or c2's unimplemented refinement best explains query changes, against exact search actions, page feedback, and recovery.
WITH c1_claims /* Find early memory/reflection claims about the exact zest/tall query and how results were assessed; bound through c1's decision. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('zest', '3x-large tall'), 'memory', 1, 8)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('no results', 'reflection', 1, 8)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('result_assessment', 'reflection', 1, 8)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('hypothesis', 'memory', 1, 8)
), c1_peers /* Compare all same-step mental modules around discovered early claims, including the action rationale and exact-criteria correction language. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('zest', ('plan', 'reflection'), 1, 8)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('exact criteria', 'memory', 1, 8)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('yellow', 'plan', 1, 8)
), search_actions /* Track every original webshop search action to compare exact arguments, step-8 relaxation, and later restoration/repetition. */ AS (
  SELECT
  step, rel, args, span, source_kind
  FROM TRACK_ACTION('search', 1, 30)
), result_pages /* Retrieve independent result-page observations at each search sequence point; totals/listings distinguish empty pages from irrelevant visible items without asserting the whole product universe. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('Total results:', 'observation', 1, 30)
), c2_claims /* Trace c2's stated refinement and prior query/result assessments throughout the full preceding range, including alternative wording and retry rationale. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('dress shirt', 'plan', 1, 24)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('cotton spandex', 'reflection', 1, 24)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('zest', 'memory', 1, 24)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('result_assessment', 'memory', 1, 24)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('decision_basis', 'expected_gain'), 'plan', 1, 24)
), c2_peers /* Check related memory/reflection/plan wording at c2 claim steps for whether the stated refinement was implemented or a retry had a recorded purpose. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('dress shirt', ('memory', 'reflection'), 1, 24)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('cotton spandex', 'plan', 1, 24)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('repeat', 'reflection', 1, 24)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('results', 'plan', 1, 24)
), later_recovery /* Check subsequent exact-criteria query/recovery language after c1; later evidence can show correction or continued reliance, not earlier knowledge. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('zest', ('plan', 'reflection'), 9, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('3X Large Tall', 'action', 9, 30)
)
/* Preserve original excerpts and action spans, combining independent evidence branches without treating phrase absence as evidence of absence. */
SELECT
*
FROM c1_claims
UNION ALL BY NAME
SELECT
*
FROM c1_peers
UNION ALL BY NAME
SELECT
step, 'action' AS module, span AS text, source_kind
FROM search_actions
UNION ALL BY NAME
SELECT
*
FROM result_pages
UNION ALL BY NAME
SELECT
*
FROM c2_claims
UNION ALL BY NAME
SELECT
*
FROM c2_peers
UNION ALL BY NAME
SELECT
*
FROM later_recovery
ORDER BY
  step,
  module;
