"""Offline source audit of the saved ten-task run; no labels or model calls.

Review notes are manual assessments, not automated ground truth. Recompilation
and element queries are diagnostic probes and never replace saved model outputs.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.record_bridge import build_bundle, read_json, write_json
from prodebugger.debug_tools import DebugTools
from prodebugger.query_dsl import execute
from process_notes import goal_state


REVIEWS = {
    ('A006','c1',5,'plan'): ('insufficient_causal_evidence', '重复动作和无效果有原始记录支持，但一次重试可能合理；不能由Nothing happens归责于计划，原因也可能是接口/动作执行。'),
    ('A019','c1',7,'action'): ('source_supported_local_concern', '原始plan说检查clean而action直接拿起，局部不一致可核实；拿起也可能是后续检查的准备动作，因果责任不确定。'),
    ('A019','c2',9,'plan'): ('representation_gap_risk', '旧编译把未观察的clean判成False；原文可支持“未验证却预期完成”的疑点，但不能证明勺子脏或任务实际失败。'),
    ('A055','c1',4,'plan'): ('representation_gap_risk', '旧派生in=False和substitutes由缺少clean事实生成，ROUTE引用它作未满足证据。确认是表示层误报；TRACE的完成预期仍是独立疑点，最终plan诊断不能仅靠这条False坐实。'),
    ('A037','c1',22,'plan'): ('source_supported_local_concern', '原文确实把放到desk当成放到lamp下，观察只列alarmclock；问题是未经验证的关系假设，不能把没见到lamp解释成物理上绝无lamp。'),
    ('A037','c2',25,'plan'): ('insufficient_causal_evidence', 'SQL截掉24步；实际24步执行look，25步新反馈为Next to it, you see nothing。补齐后重复检查仍可能低效，但原判定未完整核实中间诊断动作和信息增量。'),
    ('A047','c2',19,'memory'): ('insufficient_causal_evidence', 'memory选择性回忆不等于丢失决定性信息：当步观察已有相同桌面内容。缺少更长历史是否导致重复，需要额外因果支持。'),
    ('A047','c3',10,'plan'): ('insufficient_causal_evidence', '抽屉关闭不证明目标在抽屉；重返desk可能是探索。可质疑效率，但不能由未找到目标或局部访问重复直接确定计划错误。'),
    ('W013','c1',11,'plan'): ('insufficient_causal_evidence', 'SQL报错导致只看锚点。flexible语句有风险，但宽松检索后再核实属性可以合理；后续15步恢复约束，不能把查询未含全词等同于放弃最终要求。'),
    ('W013','c2',29,'memory'): ('insufficient_causal_evidence', '所引memory本身就包含men\'s t-shirts。漏回忆15步不能充分解释plan丢掉men关键词；SUBMIT也没有采纳该memory因果归属。'),
    ('W013','c2',29,'plan'): ('insufficient_causal_evidence', 'women\'s fit本来就是任务要求；省略men关键词不证明产品类别被替换，返回女装也不能证明搜索决策犯错。需要最终筛选/承诺证据。'),
    ('W011','c1',26,'plan'): ('source_supported_local_concern', '原始16和26步action完全相同，26步plan又说refine，重复依据真实存在；是否导致失败或合理重启仍未确定。'),
    ('W011','c2',16,'action'): ('confirmed_false_premise', 'TRACE断言16步query等于1步，实际不同。它漏查1步原始action并相信17步memory的错误复述。错误在检索/证据信任，不是observation解析。SUBMIT已拒绝这个候选。'),
    ('QW011','c1',30,'plan'): ('source_supported_local_concern', 'plan原文明确说remove conflicting women\'s fit。14/19步观测解析有缺口，但不影响识别这句主动删约束的决定；不能因为存在解析gap就一律判假阳性。'),
    ('W009','c1',23,'action'): ('source_supported_local_concern', '原始13和23步query相同，23步plan宣称refine；局部计划动作分歧有原文支持，最终因果责任与替代查询效果未确定。'),
    ('QW017','c1',9,'plan'): ('retrieval_gap_risk', 'SQL只返回早期facts，却判9步未选size；7–9步解析也有缺口。离线核对全部原始click后确实没有medium动作，但原case缺少该完整核实链，不能仅用req:size未discharge作证。'),
    ('QW017','c2',8,'memory'): ('source_supported_local_concern', '原文memory把材质/medium说成已符合；原始观察只提供商品标题与可选medium，动作没有medium选择。可支持未获依据的确认，不等于证明商品物理材质不符。'),
    ('QW017','c2',8,'plan'): ('source_supported_local_concern', '原始plan称点颜色可让所有属性一致，动作重复颜色而未选medium。局部错误前提由原文支持；并非只因派生chosen缺项而判断。'),
}


def short(tid):
    number = tid.split('_')[1]
    return ('A' if '_alfworld_' in tid else 'QW' if tid.startswith('Qwen') else 'W') + number


def probe_sql(name):
    if name in {'A019','A055'}:
        entity = 'portable:ladle_1' if name == 'A019' else 'portable:bowl_1'
        return f"SELECT step,rel AS element,span AS source,value FROM TRACK_STATE('{entity}','has') UNION ALL SELECT step,module AS element,text AS source,NULL AS value FROM SEARCH_TEXT('clean','plan',1,10) ORDER BY step"
    if name == 'A006':
        return "SELECT step,rel,value,span,source_kind FROM TRACK_ACTION('go',1,12) ORDER BY step"
    if name in {'A037','A047'}:
        return "SELECT step,rel AS element,span AS source FROM TRACK_STATE('desk:1','in') UNION ALL SELECT step,module AS element,text AS source FROM SEARCH_TEXT('desklamp','memory',1,3) ORDER BY step"
    if name in {'W009','W011','W013'}:
        return "SELECT step,rel AS element,span AS source FROM TRACK_ACTION('search') UNION ALL SELECT step,module AS element,text AS source FROM SEARCH_TEXT('Step 1','memory',17,17) ORDER BY step"
    if name == 'QW011':
        return "SELECT step,rel AS element,span AS source FROM TRACK_ACTION('search') UNION ALL SELECT step,module AS element,text AS source FROM SEARCH_TEXT('women','plan',30,30) ORDER BY step"
    return "SELECT step,rel AS element,span AS source FROM TRACK_ACTION('click') UNION ALL SELECT step,module AS element,text AS source FROM SEARCH_TEXT('medium','observation',7,9) ORDER BY step"


def audit(run):
    tasks, reviews, blocked, probes, derivation_changes = [], [], [], [], []
    for tid in read_json(run / 'manifest.json')['trajectory_ids']:
        folder = run / tid; name = short(tid)
        source = read_json(folder / 'input.json'); old = read_json(folder / 'canonical_record.json')
        bundle = build_bundle(source, audited=read_json(folder / 'audited_parse.json'))
        tools = DebugTools(bundle)
        trace = [json.loads(l) for l in (folder / 'window_trace.jsonl').read_text().splitlines()]
        for event in trace:
            for c in event['candidates']:
                key = (name, event['window_id'], c['step'], c['module'])
                verdict, reason = REVIEWS[key]
                reviews.append({'task': name, 'trajectory_id': tid, 'case': event['window_id'],
                    'step': c['step'], 'module': c['module'], 'original_status': c['status'],
                    'original_proposition': c['proposition'], 'review': verdict, 'reason': reason,
                    'source_quote': c['output_quote'], 'original_uncertainty': c['uncertainty']})
        for l in (folder / 'trace_queries.jsonl').read_text().splitlines():
            q = json.loads(l); result = execute(tools, q['query'])
            assert 'error' in result, (tid, q['candidate_id'])
            blocked.append({'task': name, 'case': q['candidate_id'], 'error': result['error']['message']})
        sql = probe_sql(name); result = execute(tools, sql)
        assert 'error' not in result, (tid, result)
        assert result['returned_rows'] > 0
        assert not {'observation','memory','reflection','plan','action','next_observation'} & set(result['columns'])
        probes.append({'task': name, 'sql': sql, 'result': result})
        for f in old['facts']:
            if name not in {'A019','A055'} or f['slot'] != 'chk' or f['rel'] != 'in' or f['value'] is not False:
                continue
            now = next(x for x in bundle.record.F if x.t == f['t'] and x.slot == 'chk' and x.rel == 'satisfied')
            derivation_changes.append({'task': name, 'step': f['t'], 'old_fid': f['fid'],
                'old_relation': f['rel'], 'old_value': f['value'], 'old_basis': f['basis'],
                'new_relation': now.rel, 'new_value': now.value,
                'new_goal_state': goal_state(bundle.record, bundle.record.goals[0], f['t'])['state'],
                'meaning': 'Lack of clean observation was incorrectly encoded as a negative location/goal fact; now an unknown goal check, without negating physical location.'})
        tasks.append({'task': name, 'trajectory_id': tid,
                      'parse_gaps': [u['step'] for u in read_json(folder / 'audited_parse.json')['units'].values() if u['status']=='unresolved']})
    # Source-level counterexample: the diagnosis relied on a hallucinated memory.
    tid = next(t['trajectory_id'] for t in tasks if t['task']=='W011')
    source = read_json(run / tid / 'input.json')
    counterexample = {str(t): source['steps'][t-1]['parts']['action'] for t in [1,16,26]}
    counterexample['memory17'] = source['steps'][16]['parts']['memory']
    assert counterexample['1'] != counterexample['16'] == counterexample['26']
    summary = {'reviewed_candidates': len(reviews), 'review_categories': dict(Counter(r['review'] for r in reviews)),
               'old_full_log_queries_rejected': len(blocked), 'successful_element_probes': len(probes),
               'confirmed_negative_from_unknown_checks': len(derivation_changes), 'model_calls': 0}
    output = {'method': 'Source audit, no labels or LLM calls. Manual categories describe evidence quality, not a gold-standard false-positive rate. New queries are investigator-written offline probes, not fresh agent generations.',
              'summary': summary, 'tasks': tasks, 'reviews': reviews, 'derivation_changes': derivation_changes,
              'counterexample': counterexample, 'old_queries_rejected': blocked, 'element_probes': probes}
    dest = run / 'element_query_audit'; dest.mkdir(exist_ok=True)
    write_json(dest / 'audit.json', output)
    lines = ['元素查询与假阳性审计', '', output['method'], '', json.dumps(summary, ensure_ascii=False, indent=2), '',
             '确定的表示错误：未知clean被写成False，且aggregate goal检查混进物理in关系。修复为satisfied(req)=null，状态unknown。',
             '没有把表示错误直接等同于最终诊断全错；原始plan的提前完成预期仍需独立判断。',
             '确定的错误前提：W011/c2声称16步重复1步query；原始query不同。17步memory复述错误，SUBMIT已识别。',
             json.dumps(counterexample, ensure_ascii=False, indent=2), '', '逐候选审查（error只是原输出状态，不是置信概率）：']
    for r in reviews:
        lines += [f"{r['task']}/{r['case']} {r['step']}/{r['module']} — {r['review']}", r['reason'], '原文引句：'+r['source_quote'], '']
    lines += ['离线元素查询探针（不是新一轮agent诊断）：']
    for probe in probes:
        result = probe['result']
        lines += [probe['task'], probe['sql'], f"返回{result['returned_rows']}行；{len(json.dumps(result['rows'], ensure_ascii=False).encode())}字节；truncated={result['truncated']}", '']
    (dest / 'audit.txt').write_text('\n'.join(lines), encoding='utf-8')
    return summary


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    args = parser.parse_args()
    print(json.dumps(audit(args.run), ensure_ascii=False, indent=2))
