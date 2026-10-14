-- Purpose: test whether step 5's clean-bowl completion assertion rests only on placement, versus earlier clean-state support or a missed cleaning decision at step 4; then trace actual later reliance or correction through step 30.
WITH prior_claims AS (
  /* Search all memory, reflection, and plan text through step 5 for bowl/cleaning and completion, verification, result, or decision-basis variants; this expands origin discovery beyond one checkpoint. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean'), 'memory', 1, 5)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean'), 'reflection', 1, 5)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean'), 'plan', 1, 5)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('completion', 'verification', 'state', 'result_assessment', 'decision_basis'), 'reflection', 1, 5)
), peer_claims AS (
  /* Retrieve same-step peer reasoning and plans for discovered bowl/clean claims, including explicit cleaning, placement and verification language. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean'), 'plan', 1, 5)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean'), 'reflection', 1, 5)
), acts AS (
  /* Recover original bowl handling actions through the anchor; action elements, not memory, establish whether cleaning or placement was attempted. */
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION(('put', 'take'), 1, 5)
  WHERE
    JSON_EXTRACT(args, '$[0]') = 'portable:bowl_1'
  UNION ALL BY NAME
  SELECT
  step, 'action' AS module, span AS text, source_kind
  FROM TRACK_ACTION('look', 1, 5)
), independent_obs AS (
  /* Check original observations through step 5 for affirmative cleanliness, dirtiness, washing feedback, and bowl location; absence of cleanliness data remains unknown. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean', 'dirty'), 'observation', 1, 5)
), later_claims AS (
  /* Trace post-anchor bowl/clean completion assertions and no-further-action reasoning through step 30 to assess actual reliance or correction. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean'), 'memory', 6, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean'), 'reflection', 6, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean'), 'plan', 6, 30)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('completion', 'decision_basis'), 'reflection', 6, 30)
), later_obs AS (
  /* Retrieve later original bowl/clean feedback through step 30 to test whether placement persisted, cleaning occurred, or a corrective outcome was observed. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT(('bowl', 'clean', 'dirty'), 'observation', 6, 30)
)
/* Compare source claims, original actions and feedback while retaining step/module attribution; no matching cleanliness excerpt cannot establish dirty state. */
SELECT
*
FROM prior_claims
UNION ALL BY NAME
SELECT
*
FROM peer_claims
UNION ALL BY NAME
SELECT
*
FROM acts
UNION ALL BY NAME
SELECT
*
FROM independent_obs
UNION ALL BY NAME
SELECT
*
FROM later_claims
UNION ALL BY NAME
SELECT
*
FROM later_obs
ORDER BY
  step,
  module;
