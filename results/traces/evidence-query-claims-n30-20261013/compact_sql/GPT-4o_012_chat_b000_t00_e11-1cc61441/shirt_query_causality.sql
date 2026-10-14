-- Purpose: test whether the tentative men's-shirt/women's-fit conflict became the operative reason for dropping criteria at step 10, versus an exploratory refinement or separate search strategy, by comparing prior claims, actual searches/results, and later restoration.
WITH women_claims /* Retrieve every mental-module mention of women's fit across the full trajectory to locate any origin, promotion, or qualification before and after step 10. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('women', ('memory', 'reflection', 'plan'), 1, 30)
), conflict_claims /* Find explicit contradiction/specificity language across mental modules to distinguish tentative hypotheses from asserted decision premises. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('contradiction', 'specificity'), ('memory', 'reflection', 'plan'), 1, 30)
), search_actions /* Track the original search actions from steps 1-30 to compare omitted criteria at step 10 with restoration, recurrence, or other query changes. */ AS (
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION('search', 1, 30)
), result_pages /* Retrieve independent contemporaneous result-page excerpts, which can test claims about irrelevant results without treating search terms as product availability proof. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('Page 1 (Total results:', 'observation', 1, 30)
)
/* Preserve source step/module and distinguish agent claims, actual search strings, and observed result pages. */
SELECT
*
FROM women_claims
UNION ALL BY NAME
SELECT
*
FROM conflict_claims
UNION ALL BY NAME
SELECT
*
FROM search_actions
UNION ALL BY NAME
SELECT
*
FROM result_pages
ORDER BY
  step,
  module;
