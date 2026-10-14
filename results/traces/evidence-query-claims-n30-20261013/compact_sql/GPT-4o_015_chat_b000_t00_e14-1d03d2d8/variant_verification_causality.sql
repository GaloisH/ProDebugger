-- Purpose: test whether step 25's Buy Now decision relied on an earlier unsupported selected/matching-variant or machine-washability claim, versus an independent later decision failure; compare strongest rival evidence of actual selection, wash-care support, or correction.
WITH product_claims AS (
  /* Trace entity-specific assertions across memory, reflection, and plan through step 25 to find any origin or correction, not just the cited step 21/25 language. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('B00O30JLDK', 'Legendary Whitetails', 'mossy oak bottomland', '5x-large big'), 'memory', 1, 25)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('B00O30JLDK', 'Legendary Whitetails', 'mossy oak bottomland', '5x-large big'), 'reflection', 1, 25)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('B00O30JLDK', 'Legendary Whitetails', 'mossy oak bottomland', '5x-large big'), 'plan', 1, 25)
), wash_claims AS (
  /* Trace washability and product-detail verification wording throughout the mental modules to test whether the proposed check remained planned, was completed, or was later relied upon. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('machine washable', 'washable', 'wash care'), 'memory', 1, 25)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('machine washable', 'washable', 'wash care'), 'reflection', 1, 25)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('machine washable', 'washable', 'wash care'), 'plan', 1, 25)
), selected_actions AS (
  /* Retrieve original clicks for the relevant color, size, product/details navigation, and Buy Now; availability in an observation is not evidence of selection. */
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('click', 1, 25)
), product_evidence AS (
  /* Inspect independent product observations for its ID, color/size context, and any positive wash-care wording; text gaps do not prove unavailability or nonselection. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('B00O30JLDK', 'mossy oak bottomland', '5x-large big', 'preshrunk', 'washable', 'machine wash'), 'observation', 1, 25)
)
/* Compare claims, wash-check language, original actions, and independent observations by their original step; retain exact source excerpts and avoid treating an omitted literal match as a negative fact. */
SELECT
*
FROM product_claims
UNION ALL BY NAME
SELECT
*
FROM wash_claims
UNION ALL BY NAME
SELECT
*
FROM selected_actions
UNION ALL BY NAME
SELECT
*
FROM product_evidence
ORDER BY
  step,
  module;
