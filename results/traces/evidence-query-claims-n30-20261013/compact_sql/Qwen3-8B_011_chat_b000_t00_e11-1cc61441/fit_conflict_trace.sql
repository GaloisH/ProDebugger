-- Purpose: test whether dropping women's fit at step 30 relied on an unsupported conflict/result premise versus an exploratory response to genuinely unhelpful searches, and whether the step-29 attribution is inaccurate.
WITH searches /* Retrieve original search strings across steps 1–30 to compare the asserted step-29 query with actual searches and trace changes in included fit/material terms. */ AS (
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION('search', 1, 30)
), clicks /* Retrieve original navigation/selection clicks to distinguish search results and item-page visits from actual option selections. */ AS (
  SELECT
  step, 'action' AS module, CAST(value AS TEXT) AS text, source_kind
  FROM TRACK_ACTION('click', 1, 30)
), mem_fit /* Find conflict/fit wording in memories across the full pre-decision history; this tests where the premise originated, not just its step-30 restatement. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('women''s fit', 'conflicting', 'fit type'), 'memory', 1, 30)
), mem_results /* Find material/result and query-history variants in memories across steps 1–30 to check whether cotton-only and step attribution claims have earlier sources. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('polyester heather', 'cotton', 'step 29'), 'memory', 1, 30)
), reflections /* Compare reflection claims about fit conflict and result quality throughout the trajectory, rather than presuming step 30 is the origin. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('women''s fit', 'conflicting', 'cotton', 'polyester'), 'reflection', 1, 30)
), plans /* Compare plans mentioning fit, conflict or material across the full history to test whether earlier plans already changed or preserved the requirement. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('women''s fit', 'conflicting', 'fit type', 'polyester heather'), 'plan', 1, 30)
), material_obs /* Retrieve independent observation excerpts about the material terms at every relevant search result step; listings do not establish one product satisfies all constraints. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('cotton', 'polyester'), 'observation', 1, 30)
), item_options /* Inspect the specified item-page observations for color/size option evidence while preserving the distinction between listed options and selected values. */ AS (
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('color', 'size'), 'observation', 14, 14)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('color', 'size'), 'observation', 19, 19)
)
/* Compare original actions, mental claims/plans and independent result/page observations by step; later evidence can show recurrence or recovery, not earlier knowledge. */
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
FROM mem_fit
UNION ALL BY NAME
SELECT
*
FROM mem_results
UNION ALL BY NAME
SELECT
*
FROM reflections
UNION ALL BY NAME
SELECT
*
FROM plans
UNION ALL BY NAME
SELECT
*
FROM material_obs
UNION ALL BY NAME
SELECT
*
FROM item_options
ORDER BY
  step,
  module;
