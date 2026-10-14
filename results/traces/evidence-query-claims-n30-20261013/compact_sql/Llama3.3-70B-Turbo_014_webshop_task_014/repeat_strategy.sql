-- Purpose: test whether step 27's claimed slip-resistance refinement was a meaningful retry after known poor results, or whether an earlier rationale, changed search conditions, or later recovery better explains it.
WITH actions /* Track every original search action through the trajectory to compare step 21 and 27 and detect intervening query changes. */ AS (
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION('search', 1, 30)
), mental /* Find earlier decision language about failed pages, query refinement, alternative approaches, and product inspection as possible origins of the retry rationale. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('unproductive', 'five pages', 'refine the search', 'different approach'), 'reflection', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('unproductive', 'five pages', 'refine the search', 'different approach'), 'plan', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('unproductive', 'five pages', 'refine the search', 'different approach'), 'memory', 1, 30)
), peers /* Retrieve peer-module decision context at the discovered mental-claim and search-action steps; the phrase searches are targeted, not full module retrieval. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('slip resistant', ('plan', 'reflection', 'memory'), 1, 30)
), page_feedback /* Check independent page feedback at any step for repeated listings, unproductive pagination, and possible changed results or recovery. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('Page 1 (Total results: 50)', 'Page 5', 'Next >'), 'observation', 1, 30)
)
/* Align relevant peer reasoning with discovered decision steps while retaining all search actions and page feedback for temporal comparison. */
SELECT
*
FROM actions
UNION ALL BY NAME
SELECT
*
FROM mental
UNION ALL BY NAME
SELECT
*
FROM peers
WHERE
  step IN (
    SELECT
    step
    FROM mental
    UNION BY NAME
    SELECT
    step
    FROM actions
  )
UNION ALL BY NAME
SELECT
*
FROM page_feedback
ORDER BY
  step,
  module;
