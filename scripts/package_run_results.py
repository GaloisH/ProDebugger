"""Publish a completed run as separate summaries and lossless trace archives.

No model calls. Run evaluation, manager review and claim audit first.
"""
import argparse
from collections import Counter
import csv
import hashlib
import json
from pathlib import Path
import re
import shutil
import sys
import tarfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.record_bridge import read_json, write_json, ROOT
from prodebugger.llm_client import json_lines


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def metrics(rows):
    return {'tasks': len(rows), 'statuses': dict(Counter(r['status'] for r in rows)),
            **{key: sum(bool(r[key]) for r in rows) for key in
               ('step_match', 'step_module_match', 'full_match', 'gold_step_module_in_trace')}}


def archive(files, run, destination):
    members = []
    secret = re.compile(rb'(?:sk-or-v1-|ghp_|github_pat_)[A-Za-z0-9_]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----')
    for file in files:
        if file.is_symlink() or file.name == '.env' or file.name.startswith('.env.'):
            raise ValueError(f'Unexpected sensitive file/symlink: {file}')
        if secret.search(file.read_bytes()):
            raise ValueError(f'Credential-like content in {file}; publication stopped')
        members.append({'path': str(file.relative_to(run.parent)), 'bytes': file.stat().st_size, 'sha256': sha(file)})
    with tarfile.open(destination, 'w:gz', compresslevel=6) as out:
        for file, info in zip(files, members):
            out.add(file, arcname=info['path'], recursive=False)
    # Check the actual compressed archive, including every member's contents.
    with tarfile.open(destination, 'r:gz') as inp:
        assert inp.getnames() == [m['path'] for m in members]
        for member in members:
            assert hashlib.sha256(inp.extractfile(member['path']).read()).hexdigest() == member['sha256']
    return {'archive': destination.name, 'bytes': destination.stat().st_size, 'sha256': sha(destination),
            'original_bytes': sum(m['bytes'] for m in members), 'files': len(members), 'members': members}


def package(run, output, traces, baseline=None):
    manifest = read_json(run / 'manifest.json')
    evaluation = read_json(run / 'evaluation.json')
    manager = read_json(run / 'manager_review.json')['summary']
    claims = read_json(run / 'claim_parsing_review.json')['summary']
    ids, rows = manifest['trajectory_ids'], evaluation['trajectories']
    assert len(rows) == len(ids) and len(ids) == len(set(ids))
    for tid in ids:
        assert read_json(run / tid / 'worker.json').get('finished_at'), f'{tid} still running'
    changes = sorted({file for source in manifest['sources'].values() for file, h in source['source_versions'].items()
                      if sha(ROOT / file) != h})
    if changes:
        raise ValueError(f'Production source changed during run: {changes}')
    output.mkdir(parents=True, exist_ok=True)
    traces.mkdir(parents=True, exist_ok=False)
    for name in ('manifest.json', 'results.json', 'report.md', 'evaluation.json', 'evaluation.md',
                 'manager_review.json', 'manager_review.txt', 'claim_parsing_review.json', 'claim_parsing_review.txt'):
        shutil.copy2(run / name, output / name)
    baseline_comparison = None
    if baseline:
        old = read_json(baseline / 'evaluation.json')['trajectories']
        shared = {r['trajectory_id'] for r in old} & set(ids)
        baseline_comparison = {'scope': 'Only the shared tasks; a stochastic rerun, not a single-variable ablation.',
            'baseline': str(baseline), 'shared_task_ids': sorted(shared),
            'before': metrics([r for r in old if r['trajectory_id'] in shared]),
            'after': metrics([r for r in rows if r['trajectory_id'] in shared]),
            'new_tasks': metrics([r for r in rows if r['trajectory_id'] not in shared])}
    model_events = [{**e, 'trajectory_id': tid, 'ledger': str(path.relative_to(run))} for tid in ids
                    for path in (run / tid / 'usage.jsonl', run / tid / 'parsing' / 'usage.jsonl',
                                 run / tid / 'claim_parsing' / 'usage.jsonl') for e in json_lines(path)]
    failures = [{k: row.get(k) for k in ('trajectory_id', 'status', 'stop_reason')} for row in rows if row['status'] != 'diagnosed']
    summary = {'run_id': run.name, 'model': manifest['config']['model'], 'sample': read_json(output / 'sample.json')['selection'],
               'evaluation': evaluation['summary'], 'by_environment': {kind: metrics([r for r in rows if r['task_type'] == kind])
                    for kind in sorted({r['task_type'] for r in rows})},
               'manager_and_protocol': manager, 'claim_parsing': claims, 'shared_task_comparison': baseline_comparison,
               'non_diagnosed_tasks': failures, 'production_sources_unchanged': True,
               'provider_finish_reasons': dict(Counter(str(e.get('finish_reason')) for e in model_events if e['event'] == 'completed')),
               'provider_errors': [dict(trajectory_id=e['trajectory_id'], ledger=e['ledger'], trajectory_request=e.get('request_file'), phase=e.get('phase'), error_type=e.get('error_type'))
                                   for e in model_events if e['event'] in {'error', 'unknown_usage'}]}
    write_json(output / 'summary.json', summary)
    fields = ['trajectory_id', 'task_type', 'status', 'predicted_step', 'predicted_module', 'predicted_class',
              'gold_step', 'gold_module', 'step_match', 'step_module_match', 'full_match',
              'gold_step_module_in_trace', 'queries', 'invalid_queries', 'claim_parse_calls', 'stop_reason']
    with (output / 'tasks.csv').open('w', newline='', encoding='utf-8-sig') as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction='ignore')
        writer.writeheader(); writer.writerows(rows)
    inventory = [archive(sorted(f for f in (run / tid).rglob('*') if f.is_file()), run, traces / (tid + '.tar.gz')) for tid in ids]
    inventory.append(archive(sorted(f for f in run.iterdir() if f.is_file()), run, traces / 'run-metadata.tar.gz'))
    write_json(output / 'trace_archives.json', {'run_id': run.name, 'archives': inventory,
        'all_members_verified': True, 'total_files': sum(a['files'] for a in inventory),
        'original_bytes': sum(a['original_bytes'] for a in inventory), 'compressed_bytes': sum(a['bytes'] for a in inventory)})
    links = [(f'../../traces/{run.name}/{a["archive"]}', a) for a in inventory]
    (output / 'SHA256SUMS').write_text(''.join(f'{a["sha256"]}  {rel}\n' for rel, a in links))
    n, s, c = len(ids), evaluation['summary'], claims
    lines = [f'# {n} 任务、{s["workers"]} worker 实验汇总', '',
        f'运行 `{run.name}`；模型 `{manifest["config"]["model"]}`；耗时 {manager["wall_seconds"]:.2f} 秒。', '',
        f'状态：{json.dumps(s["statuses"], ensure_ascii=False)}。所有 {n} 个任务都计入分母。', '',
        '| 指标 | 结果 |', '|---|---:|',
        f'| step 匹配 | {s["step_matches"]}/{n} |', f'| step + module 匹配 | {s["step_module_matches"]}/{n} |',
        f'| step + module + 类别匹配 | {s["full_matches"]}/{n} |',
        f'| 标注 step + module 进入 TRACE 候选池 | {s["gold_step_module_in_trace"]}/{n} |',
        f'| 实际 TRACE 输入中标注模块原文可见 | {c["tasks_with_visible_gold_module"]}/{n} |', '',
        '精确标注匹配不等于因果正确性认证；原文可见不证明模型正确使用。抽样保留此前 10 个任务，其余按种子 42 补充；不属于完全独立的新测试集。', '',
        '## 运行与故障', '',
        f'- worker 启动间隔：{manager["start_spread_seconds"]} 秒。',
        f'- manager 计划 {manager["manager_plans"]} 份，调查 {manager["assigned_agents"]} 个，计划校验错误 {manager["manager_validation_errors"]} 次。',
        f'- SQL {s["queries"]} 次，失败 {s["invalid_queries"]} 次，部分失败 {manager["partial_queries"]} 次，截断 {s["truncated_queries"]} 次，成功但空返回 {manager["empty_successful_queries"]} 次。',
        f'- 语义解析实际调用 {c["semantic_model_calls"]} 次；截断响应 {c.get("truncated_responses",0)} 次；补齐请求 {c.get("recovery_requests",0)} 次；最终缺失条目 {c.get("missing_units",0)} 个。',
        f'- 语句卡片覆盖：`{json.dumps(c["card_coverage"], ensure_ascii=False)}`。完整返回不表示全部语义通过校验。',
        f'- SQL 离线重放一致：{manager["all_sql_replays_equal"]}。协议问题 {len(manager["protocol_violations"])} 项；来源/查询传递问题 {len(c["violations"])} 项。',
        '- 运行期间后端源码指纹保持一致。每个实际请求、响应和完整日志都保存在下列轨迹归档中。', '',
        '```json', json.dumps(failures, ensure_ascii=False, indent=2), '```', '',
        '## 用量', '', '供应商报告的 token；未计算美元成本。', '', '```json',
        json.dumps(s['usage'], ensure_ascii=False, indent=2), '```', '',
        '## 文件导航', '',
        '- [summary.json](summary.json)：整体结果、分环境统计、旧 10 任务比较和故障。',
        '- [tasks.csv](tasks.csv)：逐任务结果；[evaluation.md](evaluation.md)：标注比较、最终理由和 SQL。',
        '- [manager_review.txt](manager_review.txt)：分配、查询、候选及 SUBMIT 审计。',
        '- [claim_parsing_review.txt](claim_parsing_review.txt)：语义覆盖、截断与补齐统计。',
        '- [sample.json](sample.json)、[launch.json](launch.json)、[manifest.json](manifest.json)：抽样、启动和配置/源码指纹。',
        '- [trace_archives.json](trace_archives.json)：每个归档及每个文件的字节数、SHA-256；[SHA256SUMS](SHA256SUMS)：压缩包校验。', '',
        '## 完整轨迹归档', '',
        '归档包含每个任务全部运行文件：input、canonical record、解析审核、模型 requests/usage/messages、phase_events、tool_calls、manager_plan、trace_queries、window_trace、direct_submit、checkpoint 和 result（以实际执行到达阶段为准）。', '',
        '| 归档 | 文件数 | 压缩字节 |', '|---|---:|---:|']
    lines += [f'| [{a["archive"]}]({rel}) | {a["files"]} | {a["bytes"]} |' for rel, a in links]
    lines += ['', '在仓库根目录解包：', '', '```bash', 'mkdir -p artifacts/dsl_debugger',
        f'for archive in results/traces/{run.name}/*.tar.gz; do',
        '  tar -xzf "$archive" -C artifacts/dsl_debugger', 'done', '```', '',
        '在本汇总目录运行 `sha256sum -c SHA256SUMS` 可核对归档。只有所选任务的运行证据进入归档；凭据与原始全量数据包不包含在提交中。']
    (output / 'README.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    return {'tasks': n, 'summary_dir': str(output), 'trace_archives': len(inventory),
            'compressed_bytes': sum(a['bytes'] for a in inventory)}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('run', type=Path)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--traces', type=Path, required=True)
    p.add_argument('--baseline', type=Path)
    a = p.parse_args()
    print(json.dumps(package(a.run, a.output, a.traces, a.baseline), ensure_ascii=False, indent=2))
