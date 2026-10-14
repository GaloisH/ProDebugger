-- Purpose: test whether the step-17 claim that washing pot 1 cools it came from earlier support, while distinguishing an expected gain from actual feedback and the rival that “normal” is ambiguous.
WITH earlier_cooling AS (
  /* Search each mental source through step 17 for earlier cooling claims that could originate the mechanism. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('cool', ('memory', 'reflection', 'plan'), 1, 17)
), sink_claims AS (
  /* Search same-period mental sources for the specific pot/sink washing mechanism even if they phrase the result differently. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('sinkbasin', ('memory', 'reflection', 'plan'), 1, 17)
), mental_topics AS (
  /* Discover topic clauses about state, expected gain, and decision basis in mental sources through the anchor. */
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS(('state', 'expected_gain'), 'plan', 1, 17)
  UNION ALL BY NAME
  SELECT
  step, module, text, source_kind
  FROM FIND_CLAIMS('decision_basis', 'reflection', 1, 17)
), clean_actions AS (
  /* Retrieve actual pot-clean attempts through step 17; an attempted action alone does not establish cooling. */
  SELECT
  fid, step, rel, args, slot, side, value, span, source_kind, parse_status
  FROM TRACK_ACTION('clean', 1, 17)
  WHERE
    JSON_EXTRACT(args, '$[0]') = 'portable:pot_1'
), pot_observations AS (
  /* Retrieve independent observation excerpts mentioning pot 1 across the trajectory, including immediate and later feedback. */
  SELECT
  step, module, text, source_kind
  FROM SEARCH_TEXT('pot 1', 'observation', 1, 30)
), pot_states AS (
  /* Track recorded pot state and retain only cool/clean attributes, keeping source provenance and claim status. */
  SELECT
  fid, step, rel, args, slot, side, value, span, source_kind, parse_status
  FROM TRACK_STATE('portable:pot_1', 'has', 1, 30)
  WHERE
    JSON_EXTRACT(args, '$[1]') IN ('attribute:cool', 'attribute:clean')
)
/* Compare mental origin claims with actual actions, original observations, and same-pot state assignments. */
SELECT
'mental_cooling' AS branch, step, module, text AS excerpt, source_kind
FROM earlier_cooling
UNION ALL BY NAME
SELECT
'mental_sink' AS "branch", step, module, text AS "excerpt", source_kind
FROM sink_claims
UNION ALL BY NAME
SELECT
'mental_topic' AS "branch", step, module, text AS "excerpt", source_kind
FROM mental_topics
UNION ALL BY NAME
SELECT
'action_clean' AS "branch", step, 'action' AS "module", span AS "excerpt", source_kind
FROM clean_actions
UNION ALL BY NAME
SELECT
'observation' AS "branch", step, module, text AS "excerpt", source_kind
FROM pot_observations
UNION ALL BY NAME
SELECT
'pot_state' AS "branch", step, slot AS "module", span AS "excerpt", source_kind
FROM pot_states
ORDER BY
  step,
  branch;
