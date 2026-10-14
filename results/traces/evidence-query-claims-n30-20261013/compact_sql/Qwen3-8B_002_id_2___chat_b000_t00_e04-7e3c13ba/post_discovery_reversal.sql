-- Purpose: test whether step 27's desk-lamp reversal came from an earlier unsupported premise or reasonable search uncertainty, against direct lamp observations, the prior book-search history, and later reliance or correction.
WITH lamp_memory AS (
  /* Trace the desklamp claim backward through all memory text through step 27 to locate its source, not just the anchor wording. */
  SELECT
  step, module, source_id, text, source_kind
  FROM SEARCH_TEXT('desklamp', 'memory', 1, 27)
), lamp_reflection AS (
  /* Compare reflection claims about the same lamp across the pre-detour history and subsequent correction window. */
  SELECT
  step, module, source_id, text, source_kind
  FROM SEARCH_TEXT('desklamp', 'reflection', 1, 30)
), lamp_plan AS (
  /* Find plans concerning the lamp across the trajectory to test whether the desk hypothesis was tentative, justified, or relied upon. */
  SELECT
  step, module, source_id, text, source_kind
  FROM SEARCH_TEXT('desklamp', 'plan', 1, 30)
), book_memory AS (
  /* Check the earlier book-location/search premises that might independently explain the later detour. */
  SELECT
  step, module, source_id, text, source_kind
  FROM SEARCH_TEXT('book', 'memory', 1, 27)
), book_reflection AS (
  /* Compare earlier and later book-result assessments for a competing progress or causal explanation. */
  SELECT
  step, module, source_id, text, source_kind
  FROM SEARCH_TEXT('book', 'reflection', 1, 30)
), book_plan AS (
  /* Retrieve book-search plans to distinguish purposeful exploration from an unproductive repeated route. */
  SELECT
  step, module, source_id, text, source_kind
  FROM SEARCH_TEXT('book', 'plan', 1, 30)
), lamp_observations AS (
  /* Verify lamp location and feedback independently of mental claims; observations are evidence only for their recorded scope. */
  SELECT
  step, module, source_id, text, source_kind
  FROM SEARCH_TEXT('desklamp', 'observation', 1, 30)
), book_observations AS (
  /* Inspect book-specific observation evidence without treating an omitted inventory item as proof of global absence. */
  SELECT
  step, module, source_id, text, source_kind
  FROM SEARCH_TEXT('book', 'observation', 1, 30)
), movements AS (
  /* Track actual go actions to desk and dresser so memory claims and plans are checked against executed navigation. */
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('go', 1, 30)
), looks AS (
  /* Track actual look/examine action facts, which distinguish an attempted check from its observation feedback. */
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('look', 1, 30)
)
/* Preserve source excerpts and actual actions from all branches for chronological comparison. */
SELECT
*
FROM lamp_memory
UNION ALL BY NAME
SELECT
*
FROM lamp_reflection
UNION ALL BY NAME
SELECT
*
FROM lamp_plan
UNION ALL BY NAME
SELECT
*
FROM book_memory
UNION ALL BY NAME
SELECT
*
FROM book_reflection
UNION ALL BY NAME
SELECT
*
FROM book_plan
UNION ALL BY NAME
SELECT
*
FROM lamp_observations
UNION ALL BY NAME
SELECT
*
FROM book_observations
UNION ALL BY NAME
SELECT
*
FROM movements
UNION ALL BY NAME
SELECT
*
FROM looks
ORDER BY
  step,
  module;
