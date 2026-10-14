-- Purpose: test whether step 29's proposed broadening changed required shirt attributes or was an indexing rephrase, and whether an earlier incompatibility premise caused it.
WITH searches AS (
  /* Track every original search action through step 29 to compare the operative query at steps 12, 22 and 29. */
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION('search', 1, 29)
), fit_claims AS (
  /* Find fit-type claims across the full prior trajectory; these may reveal the origin or correction of a fit adjustment. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('fit type', ('memory', 'reflection', 'plan'), 1, 29)
), women_claims AS (
  /* Search for explicit women's-fit decisions or preservation across mental modules, not mere query-token absence. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('women', ('memory', 'reflection', 'plan'), 1, 29)
), qualifier_claims AS (
  /* Locate mentions of the task's distinctive sleeve/material constraints and any critical-attribute broadening rationale. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('needle sleeve', ('memory', 'reflection', 'plan'), 1, 29)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('critical attributes', 'broadening the search'), 'plan', 1, 29)
), result_feedback AS (
  /* Retrieve immediate result-page feedback after the key search steps; later results cannot establish earlier knowledge. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('Page 1 (Total results:', 'observation', 13, 13)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('Page 1 (Total results:', 'observation', 23, 23)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('Page 1 (Total results:', 'observation', 30, 30)
), peer_reasoning AS (
  /* Compare the reasoning, reflection and memory at discovered key-search steps with the actual action sequence. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('refine the search query', 'adjust the fit type'), 'plan', 1, 29)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('limited success', 'reflection', 1, 29)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('fit type', 'memory', 1, 29)
)
SELECT
*
FROM searches
UNION ALL BY NAME
SELECT
*
FROM fit_claims
UNION ALL BY NAME
SELECT
*
FROM women_claims
UNION ALL BY NAME
SELECT
*
FROM qualifier_claims
UNION ALL BY NAME
SELECT
*
FROM result_feedback
UNION ALL BY NAME
SELECT
*
FROM peer_reasoning
ORDER BY
  step,
  module;
