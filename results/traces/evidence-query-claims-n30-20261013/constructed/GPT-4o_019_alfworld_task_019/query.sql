-- Purpose: Separate placement success from cleanliness verification and locate the decision that collapsed the two requirements.
-- Search entity-specific history before the anchor and later recovery; never retrieve whole steps.
WITH evidence AS (
-- Inspect the plan evidence for 'clean' in original steps 1-10.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','plan',1,10)
UNION
-- Inspect the plan evidence for 'complete the task' in original steps 1-10.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('complete the task','plan',1,10)
UNION
-- Inspect the reflection evidence for 'clean' in original steps 1-10.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','reflection',1,10)
UNION
-- Inspect the action evidence for 'ladle 1' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('ladle 1','action',1,30)
UNION
-- Inspect the observation evidence for 'ladle 1' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('ladle 1','observation',1,30)
UNION
-- Inspect the observation evidence for 'clean' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','observation',1,30)
UNION
-- Inspect the memory evidence for 'clean' in original steps 1-10.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','memory',1,10)
UNION
-- Track the disputed entity; parsed claims and derived checks remain unverified.
SELECT step,'parsed_fact' AS module,span AS text,NULL AS source_id,
       NULL AS start,NULL AS end,fid,source_kind,parse_status,
       rel,args,slot,side,value,value_type,assertion_time,claim_scope,claim_polarity
FROM TRACK_ENTITY('portable:ladle_1',1,30)
)
-- Deduplicate overlapping excerpts while retaining exact source offsets.
SELECT DISTINCT * FROM evidence ORDER BY step,module,start,fid;
