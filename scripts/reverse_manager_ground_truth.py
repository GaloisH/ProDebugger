"""Post-run, label-informed retrieval audit; never imported by online diagnosis.

Construct oracle locators and manually designed alternative investigations, execute
both against the archived parse, and record source provenance for every search term.
Counterfactual planning is hindsight-informed even when its terms are source-visible.
This measures retrieval feasibility, NOT prospective planning quality or accuracy.
No model requests; historical run files are read-only.
"""
import argparse
from collections import Counter
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import pyarrow.parquet as pq
from prodebugger.debug_tools import DebugTools
from prodebugger.llm_client import json_lines
from prodebugger.query_dsl import execute
from prodebugger.record_bridge import build_bundle, read_json, write_json
from prodebugger.trace_manager import commit
from scripts.audit_trace_queries import restore_archived_facts
from scripts.audit_manager_backtracking import validate_manager_examples


# Terms/assignments are manually designed after inspecting labels. Keep this table
# offline: it is not a router, template bank or model prompt.
CASES = {
    'GPT-4o_019_alfworld_task_019': {
        'oracle': 'take ladle 1',
        'seeds': [('clean', 'plan')], 'peers': [('clean', 'memory'), ('clean', 'reflection')],
        'observations': ['ladle 1'], 'actions': ['look', 'take', 'put'],
        'question': 'Did intended cleanliness verification fail to reach action, or was pickup a necessary preparatory step followed by verification? Compare that mechanism with an unsupported completion claim.',
        'note': '标注 action 7 已提供；实际选择 plan 9。需要核对计划中的检查、执行动作和后续是否补检，而不只追求证明 ladle 是脏的。',
        'category': 'visible_but_judged_differently'},
    'GPT-4o_006_alfworld_task_006': {
        'oracle': 'proceed to cabinet 2',
        'seeds': [('cabinet 2', 'plan')], 'peers': [('cabinet 2', 'memory'), ('cabinet 2', 'reflection')],
        'observations': ['Nothing happens', 'cabinet 2'], 'actions': ['go'],
        'question': 'Does cabinet navigation adapt to repeated no-effect feedback, or do unchanged semantic retries lack an information-gathering purpose? Exclude quotation/serialization as a cause and test changed conditions or recovery.',
        'note': '标注 plan 5 已检出；manager 将调查限定为排除引号问题后的合理探索。应另验是否吸收失败反馈；单次重试和格式问题均不足以判错。',
        'category': 'visible_but_judged_differently'},
    'GPT-4o_055_alfworld_task_055': {
        'oracle': 'Yes, I have placed a clean bowl on the shelf.',
        'seeds': [('clean bowl', 'reflection')], 'peers': [('clean', 'plan'), ('clean', 'memory')],
        'observations': ['bowl 1'], 'actions': ['look', 'put'],
        'question': 'Did a promised verification establish the clean-bowl goal, or did a placement-only observation become a completion assertion? Compare the actual verification decision with earlier tentative and definite claims, and test later reliance or correction.',
        'note': '标注 reflection 6 已有片段；输出 memory 5。不能将第一处提及等同于关键失败，也不能用未知洁净状态自动证明错误；需区分早期断言、检查和检查后评估。',
        'category': 'visible_but_judged_differently'},
    'GPT-4o_047_alfworld_task_047': {
        'oracle': 'Step 3 and Step 5',
        'seeds': [('desk 1', 'memory')], 'peers': [('desk', 'reflection'), ('desk', 'plan')],
        'observations': ['desk 1'], 'actions': ['go', 'look'],
        'question': 'Does a desk-search summary preserve the negative outcomes needed to decide whether revisiting is useful, or is the revisit justified by new access or information? Compare the summary with same-step reasoning, plans and prior feedback.',
        'note': "实际搜 memory 的 'examine desk 1'，漏掉只记载 desk 1 和 look 的 memory 10。用稳定实体发现摘要，再联查计划和反馈，可检验是否漏掉决定性结果。",
        'category': 'planning_and_literal_search_gap'},
    'GPT-4o_037_alfworld_task_037': {
        'oracle': 'likely located',
        'seeds': [('desklamp', 'memory')], 'peers': [('likely', 'memory'), ('desklamp', 'reflection'), ('desklamp', 'plan')],
        'observations': ['desk 1'], 'actions': ['go', 'look'],
        'question': 'Is the desk-lamp location a revisable hypothesis, or does a later decision treat it as established despite feedback? Track the wording, same-step decisions and response to negative searches before calling a tentative belief a hallucination.',
        'note': 'memory 2 原文已有片段；TRACE 区分 likely 与确定断言，选择后期步骤。需要验证假设是否被固化及是否有效更新，不能只为匹配标签把所有 likely 都判错。',
        'category': 'visible_but_judged_differently'},
    'GPT-4o_013_chat_b000_t00_e12-f27d2887': {
        'oracle': 'did not yield any relevant products',
        'seeds': [('relevant', 'memory')], 'peers': [('results', 'reflection'), ('products', 'plan')],
        'observations': ['B09GL561XH', 'Page 1'], 'actions': ['search', 'click'],
        'question': 'Did a premature dismissal of partially relevant listings drive later refinement, or were listings reasonably rejected after checking the necessary attributes? Compare that upstream summary mechanism with the visible later relaxation of requirements.',
        'note': "manager 只追末尾要求放宽；SQL 围绕 less critical/women/4T，未查 memory 2 的结果总结。产品可部分相关，不代表满足全部属性，仍需保留这一反证。",
        'category': 'planning_and_literal_search_gap'},
    'GPT-4o_011_chat_b000_t00_e10-69d80a84': {
        'oracle': 'additional pages',
        'seeds': [('next >', 'plan'), ('refine', 'plan')], 'peers': [('results', 'memory'), ('results', 'reflection')],
        'observations': ['Page 1', 'Page 5'], 'actions': ['search', 'click'],
        'question': 'Which search or pagination decision continues a fruitless strategy despite known results, versus exploring genuinely new items or testing a different query? Compare page progression, query changes, summaries and actual actions rather than only a late refinement phrase.',
        'note': '实际只围绕后期 refinement；反向查询能检出 plan 21，但其原文/action 是 next >，标签理由却说产生相似 queries。只能确认可检索和策略待审，不能声称该步执行了重复 search。',
        'category': 'planning_gap_and_label_reason_mismatch'},
    'Qwen3-8B_011_chat_b000_t00_e11-1cc61441': {
        'oracle': 'explicitly prioritize',
        'seeds': [('prioritize', 'plan')], 'peers': [('query', 'memory'), ('query', 'reflection')],
        'observations': ['Page 1'], 'actions': ['search', 'click'],
        'question': 'Do query refinements respond meaningfully to prior results, or merely claim improvement without changing the ineffective strategy? Compare this with the later gender/fit contradiction, using actual search terms and original feedback.',
        'note': "manager 只分配 men's/women's fit 冲突；plan 12 正好省略 fit，搜 women's fit 必然漏掉。应从 refinement 行为及实际 search 序列独立检验另一机制。",
        'category': 'planning_and_literal_search_gap'},
    'GPT-4o_009_chat_b000_t00_e08-6a7bac22': {
        'oracle': 'Clicking',
        'seeds': [('next >', 'plan'), ('refine', 'plan')], 'peers': [('sport coat', 'memory'), ('sport coat', 'reflection')],
        'observations': ['Page 1', 'B09NNMV9LN'], 'actions': ['search', 'click'],
        'question': 'Does the strategy repeat already unhelpful search or pagination decisions, or does it expose new evidence worth checking? Compare actual query changes and page progression with the contemporaneous rationale and retained outcomes.',
        'note': '查询 refinement 文字漏掉 plan 5 的翻页理由。标签理由说重复初始 query，但该步原文/action 为 next >，最近 search 在 step 4；不自动移动标签或声称 plan 5 发起 search。',
        'category': 'planning_gap_and_label_reason_mismatch'},
    'Qwen3-8B_017_chat_b000_t00_e17-fbe4c42d': {
        'oracle': 'size options are available',
        'seeds': [('medium', 'memory')], 'peers': [('medium', 'reflection'), ('buy now', 'plan')],
        'observations': ['medium', 'B09NPML43M'], 'actions': ['click'],
        'question': 'When does an attribute hypothesis become a claim of verified suitability used to buy? Compare earlier memory, same-step plans/reflections, available versus selected size, original clicks and any intervening correction; do not always choose the first mention.',
        'note': 'anchor memory 9 全文可见，输出 memory 8。属于早期错误与购买前关键断言的归因差异；增加查询本身不保证改选 step 9。',
        'category': 'visible_but_judged_differently'},
}


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def source_select(term, module):
    return f"SELECT step,module,text,source_kind FROM SEARCH_TEXT({literal(term)},{literal(module)})"


def alternative_sql(config):
    branches = {
        'claims': ('Discover source claims using visible task/entity/behavior terms over the full trajectory.',
                   [source_select(*p) for p in config['seeds']]),
        'peers': ('Retrieve focused peer-module evidence; use different wording when the claim term is absent.',
                  [source_select(*p) for p in config['peers']]),
        'feedback': ('Keep independent original feedback; later observations cannot justify earlier knowledge.',
                     [source_select(term, 'observation') for term in config['observations']]),
        'actions': ('Track relevant operation arguments and compare them with the intended decisions.',
                    [f"SELECT step,'action' AS module,COALESCE(span,CAST(value AS TEXT)) AS text,source_kind FROM TRACK_ACTION({literal(a)})"
                     for a in config['actions']]),
    }
    ctes = [f"-- {comment}\n{name} AS (\n " + '\n UNION ALL\n '.join(selects) + '\n)'
            for name, (comment, selects) in branches.items()]
    return ("-- Purpose: " + config['question'] + "\nWITH\n" + ',\n'.join(ctes) +
            '\n-- Peer steps are discovered by the query; independent action/feedback branches remain available.\n'
            'SELECT * FROM claims\nUNION ALL SELECT * FROM peers WHERE step IN (SELECT step FROM claims)\n'
            'UNION ALL SELECT * FROM feedback\nUNION ALL SELECT * FROM actions\nORDER BY step,module;')


def manager_input(folder):
    for path in sorted((folder / 'requests').glob('*.json')):
        req = read_json(path)
        if req['phase'] == 'MANAGER':
            import json
            return json.loads(next(m['content'] for m in req['messages'] if m['role'] == 'user'))
    raise ValueError(f'No archived manager input: {folder}')


def provenance(config, payload):
    available = [{'source_id': 'task', 'text': payload['task']}] + payload['source_inventory']
    terms = sorted({p[0] for p in config['seeds'] + config['peers']} | set(config['observations']))
    result = []
    for term in terms:
        matches = [s for s in available if term.lower() in s['text'].lower()]
        if not matches:
            raise ValueError(f'Counterfactual term not visible to the manager: {term}')
        s = matches[0]; i = s['text'].lower().index(term.lower())
        result.append({'term': term, 'source_id': s['source_id'],
                       'visible_excerpt': s['text'][max(0, i-50):i+len(term)+90]})
    return result


def alternative_plan(config, payload, actual):
    refs = [r['candidate']['candidate_id'] for r in payload['route_cases']]
    evidence = []
    for task in actual['assignments']:
        for e in task['evidence']:
            if e not in evidence:
                evidence.append(e)
    assignment = {'agent_id': 'integrated_investigation', 'anchor_case_id': actual['assignments'][0]['anchor_case_id'],
        'route_case_ids': refs, 'question': config['question'],
        'search_targets': [
            'Discover claims across the original trajectory: ' + ', '.join(f"{m}: {t!r}" for t, m in config['seeds']),
            'At discovered claim steps, join targeted peer excerpts: ' + ', '.join(f"{m}: {t!r}" for t, m in config['peers']),
            'Compare independent observations: ' + ', '.join(config['observations']) + '; action types: ' + ', '.join(config['actions']),
            'Check prior knowledge, feedback at the following observation, downstream reliance and correction. Expand to a different mechanism if stronger evidence appears.'],
        'evidence': evidence[:6],
        'criteria': {
            'supported': 'Exact original claims/decisions, independent evidence and subsequent behavior establish a substantive unsupported commitment or ineffective update with task-relevant reliance. Select the supported decision, not automatically the first mention.',
            'refuted': 'The claim is supported, tentative and appropriately updated, or the action provides useful new information/preparation; reassess any independently evidenced alternative mechanism.',
            'unknown': 'Missing state, incomplete excerpts or unresolved dependence leave this premise unestablished. Neither no literal match nor agent confidence proves a mistake.'}}
    return {'assignments': [assignment], 'decision_rules': [{'rule_id': 'evidence_and_reliance',
        'conditions': [{'agent_id': assignment['agent_id'], 'outcome': 'supported',
                        'finding': 'Original source establishes both the substantive decision fault and actual task-relevant reliance without effective correction.'}],
        'conclusion': 'Compare the actual TRACE candidate with propagation using the demonstrated dependency.',
        'caveat': 'If a different mechanism is discovered, do not force this premise to fit. Earlier time alone and missing world-state facts are insufficient; select only supplied TRACE candidates.'}],
        'uncertainty': 'This is an offline hindsight-informed alternative allocation, not an observed finding or a prospective model result.'}


def audit(run, data_dir, output, corpus):
    manifest = read_json(run / 'manifest.json')
    ids = manifest['trajectory_ids']
    evaluation = {r['trajectory_id']: r for r in read_json(run / 'evaluation.json')['trajectories']}
    old_visibility = {r['trajectory_id']: r for r in read_json(run / 'candidate_source_visibility.json')['tasks']}
    labels = {}
    for path in data_dir.glob('*.parquet'):
        for row in pq.read_table(path, filters=[('trajectory_id', 'in', ids)], columns=['trajectory_id', 'failure_reasonings']).to_pylist():
            labels[row['trajectory_id']] = row['failure_reasonings']
    reports = []
    for tid in ids:
        folder = run / tid; config = CASES[tid]; gold = evaluation[tid]
        source = read_json(folder / 'input.json')
        bundle = build_bundle(source, audited=read_json(folder / 'audited_parse.json'))
        restore_archived_facts(bundle, read_json(folder / 'canonical_record.json'))
        tools = DebugTools(bundle)
        payload = manager_input(folder)
        tools.route_cases = [r['candidate'] for r in payload['route_cases']]
        tools.windows.configure(tools.route_cases)
        actual = read_json(folder / 'manager_plan.json')
        term_sources = provenance(config, payload)
        plan = commit(tools, **alternative_plan(config, payload, actual))
        t, module = gold['gold_step'], gold['gold_module']
        original = source['steps'][t-1]['parts'][module]
        oracle_sql = ("-- Purpose: offline label-informed source locator; never a prospective query.\n"
                      f"SELECT step,module,text,source_kind FROM SEARCH_TEXT({literal(config['oracle'])},{literal(module)},{t},{t});")
        sql = alternative_sql(config)
        oracle, alternative = execute(tools, oracle_sql), execute(tools, sql)
        for kind, result in [('oracle', oracle), ('alternative', alternative)]:
            if result.get('error') or result.get('partial') or result.get('truncated'):
                raise ValueError(f'{tid}/{kind} failed: {result}')
        hits = lambda result: [r for r in result['rows'] if r['step'] == t and r['module'] == module and r.get('text') and r['text'] in original]
        oracle_hits, alternative_hits = hits(oracle), hits(alternative)
        if not oracle_hits:
            raise ValueError(f'Oracle did not locate original gold source: {tid}')
        dest = output / tid
        dest.mkdir(parents=True, exist_ok=True)
        (dest / 'oracle.sql').write_text(oracle_sql + '\n')
        (dest / 'alternative.sql').write_text(sql + '\n')
        write_json(dest / 'alternative_manager_plan.json', plan)
        write_json(dest / 'query_results.json', {'oracle': oracle, 'alternative': alternative})
        traces = json_lines(folder / 'window_trace.jsonl')
        reports.append({'trajectory_id': tid, 'gold': {'step': t, 'module': module,
                       'reasonings': labels[tid], 'original_module': original},
            'prediction': {k: gold[k] for k in ('predicted_step', 'predicted_module', 'predicted_class')},
            'actual_assignments': actual['assignments'],
            'actual_queries': [{'agent_id': q['candidate_id'], 'sql': q['query'], 'returned_rows': q['returned_rows']}
                               for q in json_lines(folder / 'trace_queries.jsonl')],
            'actual_candidates': [{'agent_id': e['window_id'], 'candidates': e['candidates']} for e in traces],
            'old_source_visibility': old_visibility[tid],
            'alternative_plan': plan, 'term_provenance': term_sources,
            'oracle_gold_rows': oracle_hits, 'alternative_gold_rows': alternative_hits,
            'alternative_exposes_oracle_phrase': any(config['oracle'].lower() in r['text'].lower() for r in alternative_hits),
            'alternative_gold_step_modules': sorted({r['module'] for r in alternative['rows'] if r['step'] == t}),
            'alternative_rows': alternative['returned_rows'], 'category': config['category'], 'analysis': config['note']})
    summary = {'tasks': len(reports), 'original_confirmed_gold_source_visible': sum(r['old_source_visibility']['confirmed_gold_module_source_visible'] for r in reports),
        'oracle_gold_source_hits': sum(bool(r['oracle_gold_rows']) for r in reports),
        'alternative_gold_source_hits': sum(bool(r['alternative_gold_rows']) for r in reports),
        'alternative_contains_oracle_phrase': sum(r['alternative_exposes_oracle_phrase'] for r in reports),
        'alternative_gold_step_has_multiple_modules': sum(len(r['alternative_gold_step_modules']) > 1 for r in reports),
        'alternative_gold_step_has_all_mental_modules': sum({'memory', 'reflection', 'plan'} <= set(r['alternative_gold_step_modules']) for r in reports),
        'categories': dict(Counter(r['category'] for r in reports)), 'model_calls': 0}
    report = {'method': __doc__, 'summary': summary, 'tasks': reports,
              'manager_examples': validate_manager_examples(corpus, set(ids))}
    write_json(output / 'report.json', report)
    lines = ['Manager 分配与 ground truth 离线逆向审计', '',
        '方法：用标签作定点 oracle 查询，再人工反推另一套分工和 SQL。后者不限定 gold step，检索词逐项核对为 manager 原始可见来源；但机制和模块的选择仍受事后标签启发。这是检索可行性审计，不是盲测，也不是新准确率。',
        '沿用原运行 audited_parse 和 Fact IDs；没有 LLM 请求、二次查询或修改原运行。每任务 alternative 为一条组合 SQL，保留英文注释；完整计划、SQL 和结果在任务子目录。', '',
        f"原运行确认标注模块来源可见：{summary['original_confirmed_gold_source_visible']}/10；oracle 检出：{summary['oracle_gold_source_hits']}/10；alternative 检出原文片段：{summary['alternative_gold_source_hits']}/10；包含 oracle 核心短语：{summary['alternative_contains_oracle_phrase']}/10。",
        '检出片段不证明片段完整，不证明标签正确，也不证明 TRACE 会选择该步骤。', '',
        '主要问题：manager 把“向前追根因”缩窄成“搜更早的同一句话”；实体稳定、机制变化、跨模块对照和失败反馈更新没有得到充分分配。其余样本还涉及判定标准、第一处提及与关键决策的区别。',
        '两例标签理由与标注步骤动作不一致：W011/21 和 W009/5 实际是 next > 翻页，理由却说重复搜索。保留原标签，不自动平移，也不把检索命中当作标签论证。', '']
    for row in reports:
        g = row['gold']; pred = row['prediction']
        lines += [row['trajectory_id'], f"  标注 {g['step']}/{g['module']}；实际 {pred['predicted_step']}/{pred['predicted_module']}",
            '  ' + row['analysis'], '  逆向分工：' + row['alternative_plan']['assignments'][0]['question'],
            f"  alternative 行数={row['alternative_rows']}；标注来源命中={bool(row['alternative_gold_rows'])}；核心短语命中={row['alternative_exposes_oracle_phrase']}；同一步模块={row['alternative_gold_step_modules']}", '']
    (output / 'report.txt').write_text('\n'.join(lines), encoding='utf-8')
    print(summary)
    print(output / 'report.txt')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('--data-dir', type=Path, default=Path('core/data'))
    parser.add_argument('--output', type=Path, default=Path('artifacts/analysis/manager-reverse-gt-20261013'))
    parser.add_argument('--corpus', type=Path, default=Path('artifacts/analysis/corpus-parsing-fixed-20261013'))
    args = parser.parse_args()
    audit(args.run, args.data_dir, args.output, args.corpus)
