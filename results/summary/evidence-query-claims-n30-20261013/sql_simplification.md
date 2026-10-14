# SQL 简化与可选字段

本次只改代码、提示词并做离线转换；没有调用模型 API，没有重跑诊断或更改原实验成绩。

## 新语法与解析

- `SEARCH_TEXT(('apple','pan'),('memory','reflection','plan'),1,30)`：批量关键词与模块，按参数顺序组合；重复命中仍保留。
- `FIND_CLAIMS(('verification','decision_basis'),'reflection')`、`TRACK_ACTION(('go','look'))` 同样支持对应参数的列表。
- `UNION ALL BY NAME` 按字段名称对齐；各分支只写自己的字段，不再填 `NULL AS ...`。`UNION BY NAME` 额外去重。
- 新语法返回 `row_format=sparse/v1`，JSON 行只包含非空字段；`0`、`false`、空字符串仍保留。SQL 内部的 NULL、筛选、聚合和排序语义不变。旧标量查询仍兼容密集行格式。
- 原文解析按实际存在的 step/module/text 或 fid/span 对齐；source_id/start/end 按需使用，不要求所有列齐全。重复原文仍需来源或偏移消歧；无法唯一匹配就不生成该片段的语义卡片，不能扩展到隐藏文本。
- TRACE 单查询、单 step 以及候选/评估格式保持不变；manager→SUBMIT 的查询证据附带 row_format。省略字段表示 unknown，不构成否定证据。

## 30 条轨迹转换结果

[全部转换文件与逐任务索引](../../traces/evidence-query-claims-n30-20261013/compact_sql/README.md) · [机器核对报告](sql_simplification.json)

30 个任务中，29 个曾发起 SQL，共 35 条，全部转换并在原输入和存档解析上执行。`GPT-4o_012_alfworld_task_012` 在 ROUTE 结束，没有 SQL；保留无查询记录。

| 项目 | 原 SQL | 简化后 |
|---|---:|---:|
| SQL 字符数 | 128679 | 99201（减少 22.91%） |
| SELECT 个数 | 941 | 546 |
| SELECT 投影字段项数 | 3932 | 1653 |
| 函数调用表达式个数 | 697 | 315 |
| SQL NULL 占位表达式 | 18 | 0 |

共 5900 行实际返回，省略 1146 个 NULL 属性。逐条验证行内容（忽略 NULL 键）、行顺序、输出列顺序、Fact ID、step、原文片段完全一致。列表减少重复 SQL 表达式，不代表减少了对应的基础检索或改变查询范围。

另转换 6 条人工示范 SQL，322 行返回一致，省略 2601 个 NULL 属性，SQL 字符减少 29.8%。继续保留其人工来源标记，不计入实验指标。

转换文件是派生视图，原请求/响应、模型决策与压缩归档保持原样。归档及成员 SHA-256 经核对；已有语义解析结果仅在原文可见性完全一致后原样复用，不冒充新 API 输出。

## 本地验证

- 111 项回归测试通过，覆盖批量顺序/重复项、BY NAME、NULL 语义、非法访问、分支失败、早期日志、原文消歧、TRACE→SUBMIT 交接与恢复。
- 35 条实际 SQL + 6 条示范 SQL 的完整返回等价核对通过。
- 提示词中的 4 条真实 SQL 例子全部执行通过，均返回 anchor 之前的精确原文。
- 6 条示范生成器已用简化语法完整离线生成并通过各阶段校验；输出于临时目录，没有覆盖历史示范。
- [逐 agent 提示词审查](prompt_cleanup.md)。无模型 API 测试，因此没有新的模型准确率结论。

```bash
.venv/bin/python -B -m unittest discover -s checks -q
PYTHONHASHSEED=42 .venv/bin/python -B scripts/simplify_run_sql.py --output /tmp/prodebugger-compact-review
```

转换脚本拒绝覆盖已有输出；复核时请使用不存在的新目录。
