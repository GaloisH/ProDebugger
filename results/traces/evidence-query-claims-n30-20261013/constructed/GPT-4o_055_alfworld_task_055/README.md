# 从后续完成断言追到首次明确确认

人工构造的 debugger 示范。决策为手工编写，工具返回为真实离线执行；不计入 30 任务实测成绩。

原任务：put a clean bowl in shelf.

来源：`GPT-4o_055_alfworld_task_055`；原始归档 `GPT-4o_055_alfworld_task_055.tar.gz` 的 SHA-256：`d4a12dd41e80a5d10da9e376a8b29c6f9f07d1d6a6febc192b4ac946bc25742c`。

## 逐阶段轨迹

### 1. MAP — view

Read the verbatim task and its structured requirements. Treat incomplete parsing and unverified attributes as unknown, never as negative environment facts.

```json
{
  "spec": "requirements",
  "scope": {
    "mode": "global"
  }
}
```

### 2. ROUTE — span

Inspect the original anchor module behind the selected Fact.

```json
{
  "fid": 97,
  "scope": {
    "mode": "global"
  }
}
```

### 3. ROUTE — view

Compare the anchor with its observation, related modules and parse audit before declaring a hypothesis.

```json
{
  "spec": "local_audits | steps:6:6 | detail:full",
  "scope": {
    "mode": "global"
  }
}
```

### 4. ROUTE — route_cases

The anchor supplies a hypothesis only. Investigate the earlier decision that could explain it and inspect independent observations plus later correction.

```json
{
  "candidates": [
    {
      "candidate_id": "authored_route",
      "issue_step": 6,
      "issue_fids": [
        97
      ],
      "goal_links": [
        "req:bowl_in_shelf"
      ],
      "hypothesis": "Does the step-6 completion premise originate in an earlier unsupported clean-bowl confirmation, or was cleanliness established independently? Compare memory, reflection and placement feedback before selecting an origin."
    }
  ]
}
```

### 5. MANAGER — plan_trace

One investigator can compare origin, same-step alternatives and later recovery in one query.

完整输入与返回见 [manager_plan.json](manager_plan.json) 和 [events.jsonl](events.jsonl)。

### 6. TRACE_QUERY — query_logs

Use one composed element query for relevant earlier claims, peer modules, actual actions, source observations and recovery. Parsed entity facts are supplementary; source text controls the conclusion.

```sql
-- Purpose: Find the earliest explicit full-goal confirmation and distinguish placement evidence from verified cleanliness.
-- Search entity-specific history before the anchor and later recovery; never retrieve whole steps.
WITH evidence AS (
-- Inspect the reflection evidence for 'clean' in original steps 1-6.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','reflection',1,6)
UNION
-- Inspect the memory evidence for 'completion of the task' in original steps 1-6.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('completion of the task','memory',1,6)
UNION
-- Inspect the memory evidence for 'clean' in original steps 1-6.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','memory',1,6)
UNION
-- Inspect the plan evidence for 'bowl' in original steps 1-6.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('bowl','plan',1,6)
UNION
-- Inspect the action evidence for 'bowl 1' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('bowl 1','action',1,30)
UNION
-- Inspect the observation evidence for 'bowl 1' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('bowl 1','observation',1,30)
UNION
-- Inspect the observation evidence for 'clean' in original steps 1-30.
SELECT step,module,text,source_id,start,end,fid,source_kind,parse_status,
       NULL AS rel,NULL AS args,NULL AS slot,NULL AS side,NULL AS value,
       NULL AS value_type,NULL AS assertion_time,NULL AS claim_scope,NULL AS claim_polarity
FROM SEARCH_TEXT('clean','observation',1,30)
UNION
-- Track the disputed entity; parsed claims and derived checks remain unverified.
SELECT step,'parsed_fact' AS module,span AS text,NULL AS source_id,
       NULL AS start,NULL AS end,fid,source_kind,parse_status,
       rel,args,slot,side,value,value_type,assertion_time,claim_scope,claim_polarity
FROM TRACK_ENTITY('portable:bowl_1',1,30)
)
-- Deduplicate overlapping excerpts while retaining exact source offsets.
SELECT DISTINCT * FROM evidence ORDER BY step,module,start,fid;
```

真实离线查询返回 47 行，无报错、无截断。全部结果见 [query_result.json](query_result.json)。

### 7. TRACE_ASSESS — assess

Compare the observed evidence, strongest alternative interpretation and causal timing. Submit one original step; same-step module alternatives are retained when material.

完整输入与返回见 [trace_assessment.json](trace_assessment.json) 和 [events.jsonl](events.jsonl)。

### 8. SUBMIT — authored JSON response

The evidence_supported rule favors the step-5 reflection because it explicitly declares the clean-bowl goal completed before step 6. Placement feedback and the later shelf observation support location only. The same-step memory is a credible competing source, but reflection states the disputed clean-goal conclusion directly. Under evidence_unknown, no dirty state or unique within-step causal origin is established.

## 查询证据与判断

**Step 4 / action**

> move bowl 1 to shelf 1

This is the actual placement action.

**Step 5 / observation**

> You move the bowl 1 to the shelf 1.

Feedback for action 4 establishes placement. It does not assert cleanliness.

**Step 5 / reflection**

> Yes, I completed the task goal of putting a clean bowl in a shelf.

This is already an explicit full-goal assertion before the step-6 anchor.

**Step 5 / memory**

> confirm the completion of the task.

Memory contains a same-step broad completion claim, so reflection is not certified as the sole source.

**Step 6 / observation**

> On the shelf 1, you see a bowl 1.

The subsequent examination verifies presence again, not the clean attribute.

## 最终示范输出

`5 / reflection / progress_misjudge`

The evidence_supported rule favors the step-5 reflection because it explicitly declares the clean-bowl goal completed before step 6. Placement feedback and the later shelf observation support location only. The same-step memory is a credible competing source, but reflection states the disputed clean-goal conclusion directly. Under evidence_unknown, no dirty state or unique within-step causal origin is established.

修复建议：Report that bowl placement succeeded while cleanliness remains unverified. Verify or establish the clean condition before claiming that the full task is complete.

证据边界：The bowl may have been clean initially; absence of a clean-state fact does not prove dirtiness. The source supports a premature certainty problem, not an independently verified unique physical cause of task failure. Step-5 memory also contains a broad completion claim.

原始 observation(t) 先于 action(t)，action(t) 的反馈通常位于 observation(t+1)。没有新建环境反馈、供应商请求 ID、模型耗时或 token 统计。

阶段输入：[MAP](goal_map.json)、[manager](manager_input.json)、[TRACE](trace_input.json)、[SUBMIT](submit_input.json)。

完整交接：[manager 计划](manager_plan.json)、[TRACE 结果](trace_assessment.json)、[SUBMIT 答案](submit_answer.json)、[结构校验](validation.json)、[来源说明](provenance.json)。
