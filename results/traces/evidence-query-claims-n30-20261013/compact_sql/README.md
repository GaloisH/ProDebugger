# 30 任务 SQL 简化与核对

批量关键词/模块检索减少重复 SELECT；UNION ALL BY NAME 按字段名合并分支，省略 NULL 占位；返回 JSON 只包含非空字段。旧标量语法仍兼容。

这是原 SQL 的派生视图：不改写实际模型请求、诊断结论或评测成绩。所有查询在原输入与存档解析上离线重放；没有重新调用 LLM。

30 个任务全部覆盖，35 条实际 SQL 全部核对通过；另转换 6 条人工示范 SQL。没有查询的任务明确保留无查询状态。

| 任务 | SQL 数 | 字符数（原 → 简化） |
|---|---:|---:|
| [GPT-4o_019_alfworld_task_019](GPT-4o_019_alfworld_task_019/README.md) | 2 | 6023 → 5295 |
| [GPT-4o_006_alfworld_task_006](GPT-4o_006_alfworld_task_006/README.md) | 1 | 4452 → 2895 |
| [GPT-4o_055_alfworld_task_055](GPT-4o_055_alfworld_task_055/README.md) | 1 | 4806 → 3484 |
| [GPT-4o_047_alfworld_task_047](GPT-4o_047_alfworld_task_047/README.md) | 1 | 3726 → 3253 |
| [GPT-4o_037_alfworld_task_037](GPT-4o_037_alfworld_task_037/README.md) | 1 | 4393 → 2981 |
| [GPT-4o_013_chat_b000_t00_e12-f27d2887](GPT-4o_013_chat_b000_t00_e12-f27d2887/README.md) | 1 | 3090 → 2617 |
| [GPT-4o_011_chat_b000_t00_e10-69d80a84](GPT-4o_011_chat_b000_t00_e10-69d80a84/README.md) | 1 | 6930 → 4915 |
| [Qwen3-8B_011_chat_b000_t00_e11-1cc61441](Qwen3-8B_011_chat_b000_t00_e11-1cc61441/README.md) | 1 | 4278 → 3236 |
| [GPT-4o_009_chat_b000_t00_e08-6a7bac22](GPT-4o_009_chat_b000_t00_e08-6a7bac22/README.md) | 1 | 3665 → 2905 |
| [Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d](Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d/README.md) | 1 | 4469 → 3378 |
| [Qwen3-8B_002_id_2___chat_b000_t00_e04-7e3c13ba](Qwen3-8B_002_id_2___chat_b000_t00_e04-7e3c13ba/README.md) | 2 | 6889 → 6711 |
| [GPT-4o_012_alfworld_task_012](GPT-4o_012_alfworld_task_012/README.md) | 0 | 0 → 0 |
| [GPT-4o_002_alfworld_task_002](GPT-4o_002_alfworld_task_002/README.md) | 1 | 4148 → 2829 |
| [Qwen3-8B_011_id_11___chat_b006_t00_e01-5b8f974f](Qwen3-8B_011_id_11___chat_b006_t00_e01-5b8f974f/README.md) | 1 | 3185 → 2429 |
| [GPT-4o_026_alfworld_task_026](GPT-4o_026_alfworld_task_026/README.md) | 1 | 3132 → 2381 |
| [GPT-4o_024_alfworld_task_024](GPT-4o_024_alfworld_task_024/README.md) | 2 | 5477 → 4763 |
| [GPT-4o_021_alfworld_task_021](GPT-4o_021_alfworld_task_021/README.md) | 1 | 4221 → 3214 |
| [GPT-4o_013_alfworld_task_013](GPT-4o_013_alfworld_task_013/README.md) | 1 | 3708 → 2813 |
| [Qwen3-8B_024_id_24___chat_b013_t00_e01-5b8f974f](Qwen3-8B_024_id_24___chat_b013_t00_e01-5b8f974f/README.md) | 1 | 4414 → 3110 |
| [GPT-4o_011_alfworld_task_011](GPT-4o_011_alfworld_task_011/README.md) | 1 | 2845 → 1724 |
| [GPT-4o_012_chat_b000_t00_e11-1cc61441](GPT-4o_012_chat_b000_t00_e11-1cc61441/README.md) | 1 | 2271 → 1775 |
| [Qwen3-8B_007_chat_b000_t00_e07-d50ae81f](Qwen3-8B_007_chat_b000_t00_e07-d50ae81f/README.md) | 1 | 4205 → 4098 |
| [GPT-4o_005_chat_b000_t00_e04-7e3c13ba](GPT-4o_005_chat_b000_t00_e04-7e3c13ba/README.md) | 1 | 4163 → 3082 |
| [GPT-4o_003_chat_b000_t00_e02-1e119842](GPT-4o_003_chat_b000_t00_e02-1e119842/README.md) | 2 | 7058 → 4852 |
| [Qwen3-8B_013_chat_b000_t00_e13-eb20423f](Qwen3-8B_013_chat_b000_t00_e13-eb20423f/README.md) | 1 | 4147 → 2758 |
| [GPT-4o_014_chat_b000_t00_e13-c39f2c41](GPT-4o_014_chat_b000_t00_e13-c39f2c41/README.md) | 2 | 6624 → 4245 |
| [GPT-4o_015_chat_b000_t00_e14-1d03d2d8](GPT-4o_015_chat_b000_t00_e14-1d03d2d8/README.md) | 1 | 4202 → 2690 |
| [Llama3.3-70B-Turbo_014_webshop_task_014](Llama3.3-70B-Turbo_014_webshop_task_014/README.md) | 2 | 6137 → 4855 |
| [Llama3.3-70B-Turbo_017_webshop_task_017](Llama3.3-70B-Turbo_017_webshop_task_017/README.md) | 1 | 3525 → 3231 |
| [Qwen3-8B_010_chat_b000_t00_e10-69d80a84](Qwen3-8B_010_chat_b000_t00_e10-69d80a84/README.md) | 1 | 2496 → 2682 |

核对项目：原查询复现存档返回；省略 NULL 后返回行逐条、顺序一致；列名顺序、Fact ID、step 和原文片段完全一致。已有语义解析侧信息在引用可见性一致后原样保留，不冒充新增解析调用。

字段缺失表示 unknown，不代表 false。0、false 和空字符串保留。SQL 内部仍按 NULL 语义执行 WHERE/IS NULL、排序与聚合；仅序列化时省略空键。

## 六条人工示范

- [GPT-4o_019_alfworld_task_019](constructed/GPT-4o_019_alfworld_task_019/investigate_origin_and_recovery.sql)：3246 → 2292 字符。
- [GPT-4o_055_alfworld_task_055](constructed/GPT-4o_055_alfworld_task_055/investigate_origin_and_recovery.sql)：3239 → 2285 字符。
- [Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d](constructed/Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d/investigate_origin_and_recovery.sql)：4724 → 3234 字符。
- [GPT-4o_013_alfworld_task_013](constructed/GPT-4o_013_alfworld_task_013/investigate_origin_and_recovery.sql)：2924 → 2104 字符。
- [Qwen3-8B_013_chat_b000_t00_e13-eb20423f](constructed/Qwen3-8B_013_chat_b000_t00_e13-eb20423f/investigate_origin_and_recovery.sql)：3205 → 2251 字符。
- [Qwen3-8B_010_chat_b000_t00_e10-69d80a84](constructed/Qwen3-8B_010_chat_b000_t00_e10-69d80a84/investigate_origin_and_recovery.sql)：3222 → 2268 字符。

[机器可读核对报告](report.json)。每个 .result.json 记录新的执行结果和原查询摘要；原始归档位于上一层。
