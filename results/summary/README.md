# 实验汇总

每次实验使用独立目录。任务抽样、配置、全部任务的结果、解析与查询审计、逐任务 CSV，以及完整轨迹归档的校验清单保存在同一汇总目录。

- [30 任务 / 30 worker：语义解析截断修复后](evidence-query-claims-n30-20261013/README.md)

完整轨迹按任务压缩保存在 [`../traces/`](../traces/)，解包后可恢复本地 `artifacts/dsl_debugger/` 目录。每个任务保留实际执行过的请求、响应和工具调用；失败任务不会从统计分母中移除。

架构与协议变化见 [README_EVOLUTION.md](../../README_EVOLUTION.md)。
