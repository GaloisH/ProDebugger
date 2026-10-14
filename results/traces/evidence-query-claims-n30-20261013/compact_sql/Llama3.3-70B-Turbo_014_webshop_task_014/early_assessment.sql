-- Purpose: Test whether step 2's “not perfectly matched” assessment means unknown listing attributes were failures, versus a scoped lack of exact-match evidence followed by useful pagination; also check earlier premises, independent listings/actions, and later correction or reliance.
WITH candidate_claims AS (
  /* Trace MCICI and GLOBALWIN claims across memory, reflection, and plan through step 30 to find origin and later reliance or correction. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('MCICI', 'GLOBALWIN'), 'memory', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('MCICI', 'GLOBALWIN'), 'reflection', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('MCICI', 'GLOBALWIN'), 'plan', 1, 30)
), assessment_claims AS (
  /* Search the disputed exact-match and unknown-versus-mismatch wording across the full relevant trajectory, not only at the anchor. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('not perfectly matched', 'reflection', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('match our criteria exactly', 'memory', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('result_assessment', 'reflection', 1, 30)
), listings AS (
  /* Retrieve independent original listing evidence for the two named candidates at and before step 2; titles/prices do not establish unshown attributes. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('B07HP6LVRS', 'B082MT9162'), 'observation', 1, 2)
), actions AS (
  /* Track actual click actions through step 30 to compare pagination with candidate inspection and identify any later inspection/recovery. */
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION('click', 1, 30)
), later_feedback AS (
  /* Inspect page-transition feedback and the named candidates' later appearances, which can show exploration outcomes but cannot establish earlier knowledge. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('Page 2', 'observation', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('B07HP6LVRS', 'B082MT9162'), 'observation', 3, 30)
)
/* Compare original mental claims with candidate listings, recorded clicks, page feedback and subsequent relevant claims. */
SELECT
*
FROM candidate_claims
UNION ALL BY NAME
SELECT
*
FROM assessment_claims
UNION ALL BY NAME
SELECT
*
FROM listings
UNION ALL BY NAME
SELECT
*
FROM actions
UNION ALL BY NAME
SELECT
*
FROM later_feedback
ORDER BY
  step,
  module;
