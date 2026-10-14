-- Purpose: test whether step 6's claim that no complete match existed relied on an earlier mistaken Daily Ritual assessment, versus reasonable exploration because color/size selection remained unverified; trace later reliance or correction.
WITH prior_product_memory AS (
  /* Trace product-specific memory claims across the full trajectory to identify an earlier premise and later repetition. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('B07DKGJR74', 'memory', 1, 30)
), prior_match_claims AS (
  /* Discover memory result-assessment clauses through step 6, including claim variants that may omit the product ID. */
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('result_assessment', 'memory', 1, 6)
), prior_product_peer AS (
  /* Compare any product-specific earlier reflection or plan claims with the memory at their discovered steps. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('B07DKGJR74', ('reflection', 'plan'), 1, 30)
), assessment_decisions AS (
  /* Retrieve explicit match-gap and decision-basis language across plans/reflections to test whether it states fact or tentative concern. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('lack a product that matches all', 'plan', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('matches some criteria', 'reflection', 1, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('all criteria', 'plan', 1, 30)
), original_actions AS (
  /* Verify actual clicks and search navigation independently of agent memories; attempts do not establish selected options. */
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION(('click', 'search'), 1, 30)
), product_observations AS (
  /* Inspect original listing/detail excerpts for the same product, price, fit and sleeve evidence over the trajectory. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('B07DKGJR74', 'comfortable, relaxed fit'), 'observation', 1, 30)
), option_observations AS (
  /* Compare visible white and xx-large option evidence near the product-page interaction without treating availability as selection. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('xx-large', 'white'), 'observation', 1, 8)
), later_recovery AS (
  /* Check post-step-6 product and match-assessment language for correction, abandonment, or continued reliance. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('B07DKGJR74', 'memory', 7, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('result_assessment', 'reflection', 7, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('decision_basis', 'plan', 7, 30)
)
SELECT
*
FROM prior_product_memory
UNION ALL BY NAME
SELECT
*
FROM prior_match_claims
UNION ALL BY NAME
SELECT
*
FROM prior_product_peer
UNION ALL BY NAME
SELECT
*
FROM assessment_decisions
UNION ALL BY NAME
SELECT
*
FROM original_actions
UNION ALL BY NAME
SELECT
*
FROM product_observations
UNION ALL BY NAME
SELECT
*
FROM option_observations
UNION ALL BY NAME
SELECT
*
FROM later_recovery
ORDER BY
  step,
  module;
