"""Post-run audit of source visibility versus TRACE candidate selection.

Uses archived assessment requests, query results, raw assess proposals and labels.
No model calls or production edits. Explanations are grounded in emitted rationales;
missing comparisons are not claims about a model's unobservable attention or thoughts.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.record_bridge import read_json, write_json
from prodebugger.llm_client import json_lines


NOTES = {
    'GPT-4o_019_alfworld_task_019': {
        'group': 'retained', 'basis': 'explicit_rationale',
        'explanation': '7/action 以 uncertain 进入候选，SUBMIT 最终选中。origin 查询只到 7，无法核实拾取后是否补检；另一 worker 有后续证据但双方不共享。保守置信度本身并不阻止入池。',
        'limitation': '这是成功入池对照，不属于可见但未选的 8 例。'},
    'GPT-4o_006_alfworld_task_006': {
        'group': 'different_fault_standard', 'basis': 'explicit_rationale',
        'explanation': '5/plan 已见，但 worker 将目标解释为排除引号问题后检查独立语义错误。它指出 reflections 5–8 承认失败、探索 cabinet 2 仍有合理目的，返回空候选。原文存在无变化重试，但当前标准明确说单次重试不足以判错；标注采用更严格的反馈后调整标准。',
        'limitation': '排除格式原因不等于可以跳过反馈更新的独立审查。也不能仅为匹配标签把每次重试判错。'},
    'GPT-4o_055_alfworld_task_055': {
        'group': 'earlier_origin_selected', 'basis': 'explicit_rationale',
        'explanation': '标注 6/reflection 只有 completion_dependence 看见；clean_claim_origin 只搜 mental 1–5。两个 worker 都选 5：step 5 已明确宣称完成，step 6 被归入重复和下游依赖。origin 给 error，dependence 却因实际洁净状态未知给 uncertain，说明支持性与真实性标准仍不一致。',
        'limitation': '同一错误链较早源头和标注关键决策不必是同一步。step 5 原文确实存在同类断言，不能仅据未匹配标签断言它不合理。'},
    'GPT-4o_047_alfworld_task_047': {
        'group': 'different_event_selected_without_gold_comparison', 'basis': 'selection_rationale_and_missing_comparison',
        'explanation': '10/memory 已见，但 rationale 论证的是 6/plan 开始反复检查。没有明确对照 memory 10 是否丢掉 earlier negative outcomes；因此只能确认另一机制占用了单步输出，不能声称模型已充分审查并反驳了标注机制。',
        'limitation': '230 行中 103 行是完全重复的额外行；这是信息组织问题的直接证据，但不能证明它导致了该选择。'},
    'GPT-4o_037_alfworld_task_037': {
        'group': 'different_fault_standard', 'basis': 'explicit_rationale',
        'explanation': '两个 worker 均看见 2/memory 的 likely located。origin 明确将其视为限定性假设，选 22/plan 将桌面位置当成灯下位置的确定性承诺；另一 worker 选 26/plan 重复检查。标签把早期无依据位置猜测作为 hallucination，当前提示则区分猜测与断言。',
        'limitation': '后续确实出现寻找/确认灯的位置和其他地点探索，不能无条件接受标签理由中的从未重新考虑。需按同一标准比较假设、依赖和更新。'},
    'GPT-4o_013_chat_b000_t00_e12-f27d2887': {
        'group': 'different_fault_standard', 'basis': 'explicit_rationale',
        'explanation': '2/memory 与 Disney 商品 B09GL561XH/22.99 的同页观察都实际返回。worker 明确把 no relevant products 解释成 no fully qualifying item，因此放弃早期总结，选 11/plan 的显式 trade-offs。manager 已要求区分相关和完全匹配，这次不能简单归咎于没有分配该方向。',
        'limitation': '同一步 reflection 写 matching all the specified criteria、plan 提到检查 partially match，也为限定性解释提供反证；相关商品值得检查不等于已满足全部属性。应审查是否据此错误停止检查，而非要求证明某商品完整满足条件。'},
    'GPT-4o_011_chat_b000_t00_e10-69d80a84': {
        'group': 'different_event_selected_without_gold_comparison', 'basis': 'selection_rationale_and_label_source_discrepancy',
        'explanation': '21/plan 已见；worker 选择 26/action，因为 26 的 query 与 16 完全相同，却宣称 refinement，局部矛盾更直接。未提供与 21/plan 的逐项淘汰比较。',
        'limitation': '标注理由描述重复 search query，而 21/plan 和 action 实际是 next > 翻页。理由与定位不直接对应，检出这段文字不等于可以证成理由。'},
    'Qwen3-8B_011_chat_b000_t00_e11-1cc61441': {
        'group': 'different_event_selected_without_gold_comparison', 'basis': 'selection_rationale_and_missing_comparison',
        'explanation': '12/plan 全文以及 actions 1/12 已见；manager 的主问题仍是 30 的 fit 删除和对 29 的回忆。worker 选择 30/memory（并保留同一步 plan），理由是 29 实际 Back to Search 而非 search；未明确比较 12 的低效 refinement。',
        'limitation': '允许扩展目标不等于强制比较不同机制。还应区分同一 search episode 的结果回忆与将动作错误归到特定步骤；直接日期矛盾未必独占任务因果重要性。'},
    'GPT-4o_009_chat_b000_t00_e08-6a7bac22': {
        'group': 'not_visible', 'basis': 'source_visibility_audit',
        'explanation': '5/plan 没有进入本轮返回内容，不属于 9 个可见案例。worker 选 23/action 的 refinement/action 不符。',
        'limitation': '其标注理由也说重复 query，而标注 plan/action 是翻页；检索缺口和理由定位问题同时存在。'},
    'Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d': {
        'group': 'earlier_origin_selected', 'basis': 'explicit_rationale',
        'explanation': '9/memory 全文既在锚点也在查询里；worker 明确选择 8/memory 为属性已匹配断言的更早来源，把 9 当购买决策的延续。首次 assess 因把 2 的引文写成 8 而被拒绝，但修正前后均为 step 8，并无 step 9 候选被代码删除。',
        'limitation': '这不是检索不到 9，也不是 SUBMIT 改步；是单步输出下源头与购买前关键断言的定位取舍。'},
}


def assessment_requests(folder):
    result = {}
    for path in sorted((folder / 'requests').glob('*.json')):
        req = read_json(path)
        if req['phase'] != 'TRACE' or not any(s.get('function', {}).get('name') == 'assess' for s in req['tools']):
            continue
        payload = json.loads(next(m['content'] for m in req['messages'] if m['role'] == 'user'))
        aid = payload['candidate']['candidate_id']
        # Retain the first actual assessment input, before any quote correction.
        if aid not in result:
            response = next(json.loads(m['content'])['data'] for m in req['messages']
                            if m['role'] == 'tool' and 'query' in json.loads(m['content']).get('data', {})
                            and 'candidate_id' in json.loads(m['content']).get('data', {}))
            result[aid] = {'path': str(path), 'payload': payload, 'query_response': response,
                           'serialized_message_chars': sum(len(m.get('content') or '') for m in req['messages'])}
    return result


def visible_sources(source, t, module, request):
    # Some corpus labels target system rather than an agent module. Keep those
    # tasks in evaluation, but do not pretend such a source was retrieved.
    if type(t) is not int or not 1 <= t <= len(source['steps']):
        return []
    original = source['steps'][t-1]['parts'].get(module)
    if not isinstance(original, str) or not original:
        return []
    payload, result = request['payload'], request['query_response']
    visible = []
    if payload['source']['step'] == t and payload['source']['modules'].get(module):
        visible.append({'via': 'anchor', 'text': payload['source']['modules'][module]})
    for e in payload.get('manager_assignment', {}).get('evidence', []):
        if e['source_id'] == f'source:{t}:{module}' and e['quote'] in original:
            visible.append({'via': 'assigned_quote', 'text': e['quote']})
    for row in result.get('rows', []):
        if row.get('step') != t or row.get('module') != module:
            continue
        for key in ('text', 'span', 'value'):
            text = row.get(key)
            if isinstance(text, str) and len(text) >= 8 and text in original:
                entry = {'via': 'query_' + key, 'text': text}
                if entry not in visible:
                    visible.append(entry)
    return visible


def inspect(run, output):
    evaluation = read_json(run / 'evaluation.json')
    prior = {r['trajectory_id']: r for r in read_json(run / 'candidate_source_visibility.json')['tasks']}
    tasks, agents = [], []
    for gold in evaluation['trajectories']:
        tid = gold['trajectory_id']; folder = run / tid
        source = read_json(folder / 'input.json')
        requests = assessment_requests(folder)
        traces = {e['window_id']: e for e in json_lines(folder / 'window_trace.jsonl')}
        events = [e for e in json_lines(folder / 'tool_calls.jsonl') if e.get('event') == 'committed' and e.get('name') == 'assess']
        task_agents = []
        for q in json_lines(folder / 'trace_queries.jsonl'):
            aid = q['candidate_id']; req = requests[aid]
            response_equal = req['query_response'] == q
            if not response_equal:
                raise ValueError(f'Query log differs from actual assessment request: {tid}/{aid}')
            visible = visible_sources(source, gold['gold_step'], gold['gold_module'], req)
            rows = q['rows']; unique = {json.dumps(x, sort_keys=True, ensure_ascii=False) for x in rows}
            a = {'agent_id': aid, 'assessment_request': req['path'], 'query_response_exactly_preserved': response_equal,
                 'serialized_assessment_message_chars': req['serialized_message_chars'],
                 'rows': len(rows), 'identical_duplicate_extra_rows': len(rows)-len(unique),
                 'gold_visible_sources': visible,
                 'gold_critical_phrase_visible': any(prior[tid]['critical_phrase'].lower() in s['text'].lower() for s in visible),
                 'manager_assignment': req['payload'].get('manager_assignment'),
                 'trace_candidates': traces[aid]['candidates'], 'trace_uncertainty': traces[aid]['conclusion']['uncertainty'],
                 'partial': q.get('partial', False)}
            task_agents.append(a); agents.append(a)
        rejected = [{'arguments': e['arguments'], 'error': e['result']['error']} for e in events if e['result'].get('error')]
        raw_gold = [e['tool_call_id'] for e in events if any(c['step'] == gold['gold_step'] and c['module'] == gold['gold_module'] for c in e['arguments'].get('candidates', []))]
        tasks.append({'trajectory_id': tid, 'gold': {'step': gold['gold_step'], 'module': gold['gold_module']},
            'gold_original_module': source['steps'][gold['gold_step']-1]['parts'][gold['gold_module']],
            'selected': {'step': gold['predicted_step'], 'module': gold['predicted_module']},
            'gold_visible_in_actual_assessment_request': any(a['gold_visible_sources'] for a in task_agents),
            'gold_critical_phrase_visible_in_actual_request': any(a['gold_critical_phrase_visible'] for a in task_agents),
            'gold_in_raw_assess_calls': bool(raw_gold), 'gold_in_committed_pool': gold['gold_step_module_in_trace'],
            'raw_gold_assess_call_ids': raw_gold, 'rejected_assess_calls': rejected,
            'agents': task_agents, 'interpretation': NOTES[tid]})
    summary = {'tasks': len(tasks), 'trace_agents': len(agents),
        'actual_request_gold_source_visible': sum(t['gold_visible_in_actual_assessment_request'] for t in tasks),
        'actual_request_gold_critical_phrase_visible': sum(t['gold_critical_phrase_visible_in_actual_request'] for t in tasks),
        'gold_in_raw_assess_calls': sum(t['gold_in_raw_assess_calls'] for t in tasks),
        'gold_in_committed_pool': sum(t['gold_in_committed_pool'] for t in tasks),
        'query_to_trace_request_exact_matches': sum(a['query_response_exactly_preserved'] for a in agents),
        'rejected_assess_calls': sum(len(t['rejected_assess_calls']) for t in tasks),
        'raw_gold_proposed_then_lost': sum(t['gold_in_raw_assess_calls'] and not t['gold_in_committed_pool'] for t in tasks),
        'returned_rows': sum(a['rows'] for a in agents),
        'identical_duplicate_extra_rows': sum(a['identical_duplicate_extra_rows'] for a in agents),
        'groups': dict(Counter(t['interpretation']['group'] for t in tasks)), 'model_calls': 0}
    report = {'method': __doc__, 'run': str(run), 'summary': summary, 'tasks': tasks}
    write_json(output / 'report.json', report)
    lines = ['关键原文可见但未进入 TRACE 候选池：实际请求与选择理由审计', '',
        '方法：读取每个 worker 首次 assess 请求，逐字段核对 SQL 结果；独立重算原文/关键短语可见性；再核对原始 assess 提交、拒绝记录和最终候选。没有模型请求，没有修改线上提示词或程序。',
        '“可见”只表示发送给模型，不能证明注意力、完整理解或证据充分。理由分析仅依据模型输出的公开 rationale；未解释的淘汰不编造隐藏原因。', '',
        json.dumps(summary, ensure_ascii=False, indent=2), '',
        '结论：14/14 查询结果原样进入实际 assess 请求；9/10 标注原文及关键短语确实存在。原始 assess 提交也仅 1/10 包含标注项，没有标注候选先被模型提出再遭代码删除。唯一入池项也被 SUBMIT 选中。',
        '8 个可见但未选：3 个错误判定标准/语义解释不同，2 个同链较早源头优先，3 个选择了另一事件且没有给出针对标注机制的完整比较。最后一类不能断言模型已认真审查过该机制。', '',
        '共同约束：每个 worker 只能输出一个不同 step，SUBMIT 只能选择已有候选；程序没有静默截断多步候选，但提示和校验使跨步竞争在 TRACE 内提前结束。来源原文更广不等于候选召回更广。',
        '证据分配：A055 的标注 reflection 6 只交给 dependence worker；origin worker 搜 mental 1–5。A019 的 origin worker 缺拾取后的补检证据，另一 worker 有后续材料却不共享。这限制单个 worker 的因果比较，但不能单凭分配推断唯一原因。',
        '上下文质量：A047 230 行中 103 行完全重复，W013 origin 75 行中 31 行重复。多关键词命中同一步后直接 JOIN 会放大重复行；这证明检索结果冗余，不证明冗余导致模型漏选。',
        '标准冲突：memory 标准允许无依据断言构成错误，reflection 标准强调与已记录状态/效果冲突；false-positive 审核又要求区分世界状态未知。A055 两 worker 对同一 step 5 一个 error、一个 uncertain，体现并存标准，而不是单纯缺更多证据。', '',
        '建议按顺序处理：',
        '1. 明确比较对象：错误前提首次出现、首次影响关键决策、后续重复放大。对齐 critical_failure_step 的评估目标，不能把“更早”和“更容易证明”当成同一目标。',
        '2. 保留一次查询、一步输出及 SUBMIT 契约，但要求 TRACE 在现有 reasoning 中显式比较少量备选事件，说明为什么淘汰；manager 优先分配能区分机制的证据，不将同链 origin/dependence 隔离成互相看不到证据的重复调查。',
        '3. 统一证据支持、世界真实性、因果作用三个维度；不能把未证明物体脏当成已验证完成，也不能把有待验证的假设自动判成 hallucination。区分相关候选和完整满足所有要求。',
        '4. 对跨模块查询去重：以 DISTINCT step 作为连接键，输出按原始来源/片段去重，保留不同证据来源；不用重新引入长度预算。',
        '5. 单列标签定位歧义。W011/21 和 W009/5 的原文是翻页，而理由说重复 search；A055/5 与 QW017/8 确有早于标签的同类断言。不能把未匹配全部当作模型无视证据，也不能据此自动改标签。', '']
    for t in tasks:
        lines += [t['trajectory_id'], f"标注 {t['gold']}；最终 {t['selected']}；实际请求可见={t['gold_critical_phrase_visible_in_actual_request']}；候选入池={t['gold_in_committed_pool']}",
            '分类：' + t['interpretation']['group'], '证据强度：' + t['interpretation']['basis'],
            t['interpretation']['explanation'], '限制：' + t['interpretation']['limitation']]
        for a in t['agents']:
            candidates = ', '.join(f"{c['step']}/{c['module']}/{c['status']}" for c in a['trace_candidates']) or 'empty'
            lines += [f"  {a['agent_id']}: 标注关键短语可见={a['gold_critical_phrase_visible']}；候选={candidates}；{a['rows']} 行/{a['identical_duplicate_extra_rows']} 重复额外行", '  请求：' + a['assessment_request']]
        lines += ['']
    (output / 'report.txt').write_text('\n'.join(lines), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('--output', type=Path, default=Path('artifacts/analysis/trace-candidate-exclusion-20261013'))
    args = parser.parse_args()
    inspect(args.run, args.output)
