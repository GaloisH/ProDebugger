-- Purpose: Test an asserted color equivalence and whether later item rejection limits its causal importance.
-- Search entity-specific history before the anchor and later recovery; never retrieve whole steps.
WITH evidence AS (
-- Inspect the memory evidence for 'grey' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('grey','memory',1,30)
UNION
-- Inspect the reflection evidence for 'grey' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('grey','reflection',1,30)
UNION
-- Inspect the plan evidence for 'grey' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('grey','plan',1,30)
UNION
-- Inspect the observation evidence for 'CLANMILUMS' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('CLANMILUMS','observation',1,30)
UNION
-- Inspect the observation evidence for 'grey' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('grey','observation',1,30)
UNION
-- Inspect the action evidence for 'click[' in original steps 24-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('click[','action',24,30)
UNION
-- Inspect the action evidence for 'heather grey' in original steps 27-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('heather grey','action',27,30)
UNION
-- Track the disputed entity; parsed claims and derived checks remain unverified.
SELECT step,'parsed_fact' AS module,span AS text,NULL AS source_id,
       NULL AS start,NULL AS end,fid,source_kind,parse_status,
       rel,args,slot,side,value,value_type,assertion_time,claim_scope,claim_polarity
FROM TRACK_ENTITY('product:b085wqkrrj',1,30)
)
-- Deduplicate overlapping excerpts while retaining exact source offsets.
SELECT DISTINCT * FROM evidence ORDER BY step,module,start,fid;
