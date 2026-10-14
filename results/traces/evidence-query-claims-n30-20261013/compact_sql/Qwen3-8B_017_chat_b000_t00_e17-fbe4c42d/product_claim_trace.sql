-- Purpose: Test whether B09NPML43M's medium/material/care/fit premise originated before step 8 and drove the step-9 buy despite a verification warning, versus UI/default or independent planning explanations.
WITH prior_claims AS (
  /* Trace product-specific disputed attribute assertions across all mental modules from steps 1-9 to find earliest supported origin, not just the suggested step 7. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('B09NPML43M', ('memory', 'reflection', 'plan'), 1, 9)
), attribute_claims AS (
  /* Search claim variants in earlier and anchor mental modules because modules may omit the product ID while asserting size, material, hand wash, or fit. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('medium', 'polyester spandex', 'hand wash', 'loose fit'), 'memory', 1, 9)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('medium', 'polyester spandex', 'hand wash', 'loose fit'), 'reflection', 1, 9)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('medium', 'polyester spandex', 'hand wash', 'loose fit'), 'plan', 1, 9)
), topic_claims AS (
  /* Discover verification, selection, state, result-assessment and decision-basis clauses across mental modules to compare assertion with qualification/correction. */
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('verification', 'selection', 'result_assessment'), 'reflection', 1, 9)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('decision_basis', 'verification', 'selection'), 'plan', 1, 9)
), product_observations AS (
  /* Retrieve independent original page/listing evidence for this exact product ID, including title/details beyond selected-option claims. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('B09NPML43M', 'observation', 1, 9)
), product_actions AS (
  /* Track actual click attempts and search actions to distinguish color/size selection and purchase from intentions. */
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION(('click', 'search'), 1, 9)
), medium_feedback AS (
  /* Compare original size-option and selected-size wording in page observations across the trajectory; availability alone does not establish selection. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('medium', 'observation', 1, 9)
), step9_claims AS (
  /* Compare step-9 verification warning and decision-basis language in peer modules, retaining the potential independent proximate planning contradiction. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('confirmation of product details', 'reflection', 9, 9)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('without further verification', 'buy now'), 'plan', 9, 9)
)
/* Return originating claims, related mental-module context, independent observations/actions, and step-9 decision evidence without reconstructing whole modules. */
SELECT
*
FROM prior_claims
UNION ALL BY NAME
SELECT
*
FROM attribute_claims
UNION ALL BY NAME
SELECT
*
FROM topic_claims
UNION ALL BY NAME
SELECT
*
FROM product_observations
UNION ALL BY NAME
SELECT
*
FROM product_actions
UNION ALL BY NAME
SELECT
*
FROM medium_feedback
UNION ALL BY NAME
SELECT
*
FROM step9_claims
ORDER BY
  step,
  module;
