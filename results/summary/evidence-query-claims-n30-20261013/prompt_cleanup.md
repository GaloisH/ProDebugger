# 逐 agent 提示词审查

检查了五个诊断角色、两类解析角色，以及 SQL 参考、工具描述、动态 handoff 和纠错消息。只做人工审查和本地验证，没有调用 API。历史轨迹中的实际模型请求不改写；新版提示词用于后续运行。

| 角色 | 发现与修正 |
|---|---|
| MAP | 删除旧 v2 窗口策略、覆盖报告、预算和最终诊断要求；只保留读取 requirements 并移交 ROUTE 的单次工具调用。 |
| ROUTE | 不再把所有 memory/plan 提取统称为“未经语义审核”；明确类型提取和语句卡片都不证明完整语义或真实性。提前 uncertain 的标准改为缺少调查线索，而非要求本阶段已经证明根因。 |
| MANAGER | 合并重复的少发 agent、向前查源、同一步跨模块核对和证据不足要求；保留默认一个 investigator、必要时增加、覆盖全部 ROUTE cases、条件规则和两个真实分配例子。 |
| TRACE | 将 SQL 语法细节集中到 query_language；保留英文注释、单次 SQL、向前查源、扩展同一步模块、独立反馈、解析假阳性审查和单 step 格式。去掉重复的全局根因警告及下游披露细节。 |
| SUBMIT | 合并重复的强制选择和因果比较规则。明确 refuted/unknown 可以是条件指定的 outcome，规则要求该 outcome 和 finding 有证据成立，而不是所有 outcome 都变成 supported。保留确定性状态 diagnosed、既有候选选择和根因角色条件披露。 |
| task/observation parser | 核对事实/goal 字段与校验器，保留全句覆盖、历史前缀、否定与指代规则；明确原文不得成为指令。其事实协议不与 SQL 的可选行字段混用。 |
| statement parser | 消除“不能输出 source_id”与引用必须携带 antecedent_source_id 的歧义：单元用 i 标识，引用仍保留来源 ID。保留一次逻辑批量解析及紧凑元组格式。 |

运行时同步修正：

- 工具参数尚未通过验证时，纠错提示要求修正 query_logs；查询已提交后只能 assess。SQL 执行失败仍消耗唯一查询机会。
- 删除 SUBMIT 启动元数据中的旧 W 窗口宽度提示，统一每个调查只返回一个不同 step；保留已有候选交接字段及角色披露规则。
- 缩短重复 handoff 指令；route_cases 的工具描述明确先交 manager 合并/分配，而不是每个 anchor 固定产生一个 worker。
- 共享错误提示不再笼统建议“use uncertain”，避免与 SUBMIT 的 diagnosed 协议冲突。
- SQL 文档中的“一次 parser 请求”改为“一次逻辑解析批次，截断时仅补缺失单元”，与现有恢复实现一致。
- 删除旧“当前 10-task evaluation”表述；保留来源核验过的真实 SQL 例子，统一英文行注释。

## 文本规模

以下是字符数，不是 tokenizer 测量。五个主角色从 55271 减至 35852，减少 35.13%。SQL 参考增加了新语法和可选字段说明，因此单列。

| 提示词 | 修改前 | 修改后 |
|---|---:|---:|
| map.md | 1475 | 464 |
| route.md | 8205 | 8205 |
| manager.md | 16019 | 11359 |
| trace.md | 18569 | 9873 |
| submit.md | 11003 | 5951 |
| query_dsl.md | 20492 | 23490 |

## 验证与限度

111 项本地回归通过；4 个真实 SQL 例子返回早期日志及精确原文，2 个 manager 分配例子通过实际 schema 和引用原文校验（[详细记录](prompt_examples_validation.json)）；新增离线重放检查验证工具参数错误与已提交 SQL 错误的不同恢复路径。原有 manager、角色披露、单步 TRACE、SUBMIT 强制选择和解析恢复测试通过。

这些检查证明格式、交接与查询行为符合当前实现，不证明提示词修改提高了模型定位准确率。[SQL 转换核对](sql_simplification.md)和[机器摘要](prompt_cleanup.json)单独保存。
