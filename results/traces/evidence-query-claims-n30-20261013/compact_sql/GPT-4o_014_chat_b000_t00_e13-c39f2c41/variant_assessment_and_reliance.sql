-- Purpose: test whether step 12 converted unseen color/size variants into product-level absence and whether that premise, versus reasonable listing-level uncertainty or another cause, drove later decisions.
WITH prior_claims AS (
  /* Trace explicit negative color/size assessments and their variants in mental sources from steps 1-12 to locate an origin rather than assume step 12 began it. */
  SELECT
  *
  FROM SEARCH_TEXT('r.brown2626', ('memory', 'reflection', 'plan'), 1, 12)
  UNION ALL BY NAME
  SELECT
  *
  FROM SEARCH_TEXT(('not found in the relevant products', 'lacked the specific attributes'), 'reflection', 1, 12)
), later_claims /* Compare later reflection and plan language about those same attributes to test reliance, qualification, or correction through step 30. */ AS (
  SELECT
  *
  FROM SEARCH_TEXT('r.brown2626', ('memory', 'reflection', 'plan'), 13, 30)
  UNION ALL BY NAME
  SELECT
  *
  FROM SEARCH_TEXT('specific color', ('reflection', 'plan'), 13, 30)
), actions /* Retrieve actual search and click actions across the trajectory so stated reliance can be compared with performed searches and product-page navigation. */ AS (
  SELECT
  fid, step, 'action' AS module, span AS text, value AS matched, source_kind, parse_status
  FROM TRACK_ACTION(('search', 'click'), 1, 30)
), observations /* Check independent result and product-page observations for the named plausible loafers and exposed variant fields; listing snippets alone cannot settle variant availability. */ AS (
  SELECT
  *
  FROM SEARCH_TEXT(('MCICI Mens Loafers', 'B07S7HDC88', 'Select Size', 'Color:'), 'observation', 1, 30)
)
/* Preserve claim, action and observation provenance together; later modules are evidence of recovery or consequence, not earlier knowledge. */
SELECT
*
FROM prior_claims
UNION ALL BY NAME
SELECT
*
FROM later_claims
UNION ALL BY NAME
SELECT
*
FROM actions
UNION ALL BY NAME
SELECT
*
FROM observations
ORDER BY
  step,
  module;
