-- Purpose: test whether the step-21 shortened search was a deliberate refinement after a supported earlier assessment, or relied on an unsupported conclusion about full-constraint results; trace prior premise, actual searches/listings, and recovery at 29.
WITH mental_claims /* Discover result-assessment, decision-basis, expected-gain, and verification claims in all mental modules through 21, retaining clauses about constraints or search outcomes. */ AS (
  SELECT
  step, module, start, end, text, source_kind
  FROM FIND_CLAIMS(('result_assessment', 'decision_basis', 'verification'), 'memory', 1, 21)
  UNION ALL BY NAME
  SELECT
  step, module, start, end, text, source_kind
  FROM FIND_CLAIMS(('result_assessment', 'decision_basis', 'verification'), 'reflection', 1, 21)
  UNION ALL BY NAME
  SELECT
  step, module, start, end, text, source_kind
  FROM FIND_CLAIMS(('expected_gain', 'decision_basis', 'result_assessment'), 'plan', 1, 21)
), mental_text /* Retrieve original constraint/outcome wording through step 21 to locate claims missed by typed topic extraction. */ AS (
  SELECT
  step, module, start, end, text, source_kind
  FROM SEARCH_TEXT(('needle sleeve', 'classic fit', 'criteria were not met', 'no relevant products'), 'memory', 1, 21)
  UNION ALL BY NAME
  SELECT
  step, module, start, end, text, source_kind
  FROM SEARCH_TEXT(('needle sleeve', 'no relevant results'), 'reflection', 1, 21)
  UNION ALL BY NAME
  SELECT
  step, module, start, end, text, source_kind
  FROM SEARCH_TEXT(('criteria', 'needle sleeve', 'brown'), 'plan', 1, 21)
), searches /* Compare original search arguments including full-constraint searches, the disputed query, and restoration at 29. */ AS (
  SELECT
  step, fid, rel, args, span, source_kind, parse_status
  FROM TRACK_ACTION('search', 1, 30)
), listing_terms /* Inspect independent listing feedback for the requested sleeve/fit wording; matching titles alone do not verify all attributes. */ AS (
  SELECT
  step, module, start, end, text, source_kind
  FROM SEARCH_TEXT(('needle sleeve', 'classic fit'), 'observation', 1, 30)
), page_feedback /* Inspect first-page search feedback at the known full-search and disputed/recovery points; listings may be noisy or incomplete. */ AS (
  SELECT
  step, module, start, end, text, source_kind
  FROM SEARCH_TEXT('Page 1 (Total results: 50)', 'observation', 1, 30)
)
/* Return candidate mental premises and source excerpts with the independent action/listing timeline. */
SELECT
*
FROM mental_claims
WHERE
  LOWER(text) LIKE '%needle sleeve%'
  OR LOWER(text) LIKE '%classic fit%'
  OR LOWER(text) LIKE '%brown%'
  OR LOWER(text) LIKE '%women%'
  OR LOWER(text) LIKE '%xx-large%'
  OR LOWER(text) LIKE '%criteria%'
  OR LOWER(text) LIKE '%no relevant%'
  OR LOWER(text) LIKE '%no suitable%'
  OR LOWER(text) LIKE '%search%'
UNION ALL BY NAME
SELECT
*
FROM mental_text
UNION ALL BY NAME
SELECT
step, 'action' AS module, span AS text, source_kind
FROM searches
UNION ALL BY NAME
SELECT
*
FROM listing_terms
UNION ALL BY NAME
SELECT
*
FROM page_feedback
ORDER BY
  step,
  module;
