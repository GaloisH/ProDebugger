-- Purpose: test whether generic grey became an unsupported heather-grey requirement match that drove a bad choice, versus a reversible probe or an earlier ineffective search/result-assessment mechanism.
WITH searches /* Track every original search action so changes in query strategy and repeated result exposure can be compared across the full 1–30 trajectory. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('search', 1, 30)
), clicks /* Track original clicks independently; an attempted option click is not proof of selection or a harmful result. */ AS (
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('click', 1, 30)
), memory_color /* Find grey/heather-grey assertions and probes in memory throughout the pre-anchor history and recovery period. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('grey', 'memory', 1, 30)
), memory_product /* Retrieve exact product/result assessments in memory to locate any earlier mistaken CLANMILUMS premise. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('CLANMILUMS', 'memory', 1, 30)
), reflection_color /* Compare reflection's color conclusions and product assessments, including whether later steps correct or repeat them. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('grey', 'reflection', 1, 30)
), reflection_product AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('CLANMILUMS', 'reflection', 1, 30)
), plan_color /* Inspect plans for color equivalence versus an explicitly exploratory filter and for decisions about the same product. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('grey', 'plan', 1, 30)
), plan_product AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('CLANMILUMS', 'plan', 1, 30)
), product_observations /* Retrieve original page/listing observations for this product to distinguish title, available color options, and actual selection feedback. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('CLANMILUMS', 'observation', 1, 30)
)
/* Preserve action sequence and targeted source excerpts together for chronology, same-step comparison, and recovery assessment. */
SELECT
*
FROM searches
UNION ALL BY NAME
SELECT
*
FROM clicks
UNION ALL BY NAME
SELECT
*
FROM memory_color
UNION ALL BY NAME
SELECT
*
FROM memory_product
UNION ALL BY NAME
SELECT
*
FROM reflection_color
UNION ALL BY NAME
SELECT
*
FROM reflection_product
UNION ALL BY NAME
SELECT
*
FROM plan_color
UNION ALL BY NAME
SELECT
*
FROM plan_product
UNION ALL BY NAME
SELECT
*
FROM product_observations
ORDER BY
  step,
  module;
