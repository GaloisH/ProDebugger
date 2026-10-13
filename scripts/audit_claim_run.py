"""Audit statement parsing in a completed run, using actual assessment requests.

Offline only. Evaluation labels locate inspection targets after diagnosis; they
are never used in parsing or model inputs.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.record_bridge import read_json, write_json
from prodebugger.llm_client import json_lines
from scripts.analyze_trace_candidate_exclusion import assessment_requests, visible_sources


def covered(start, end, intervals):
    cursor = start
    for lo, hi in sorted(intervals):
        if lo <= cursor:
            cursor = max(cursor, hi)
    return cursor >= end


def inspect(run):
    evaluation = read_json(run / 'evaluation.json')
    tasks, violations = [], []
    totals, coverage, modes, parse_errors = Counter(), Counter(), Counter(), Counter()
    for gold in evaluation['trajectories']:
        folder = run / gold['trajectory_id']
        source, result = read_json(folder / 'input.json'), read_json(folder / 'result.json')
        requests = assessment_requests(folder)
        queries = json_lines(folder / 'trace_queries.jsonl')
        usage_path = folder / 'claim_parsing' / 'usage_summary.json'
        usage = read_json(usage_path) if usage_path.exists() else {}
        totals['semantic_model_calls'] += usage.get('model_calls', 0)
        totals['semantic_input_tokens'] += usage.get('input_tokens', 0)
        totals['semantic_output_tokens'] += usage.get('output_tokens', 0)
        agents = []
        for q in queries:
            aid = q['candidate_id']
            request = requests.get(aid)
            annotations = q.get('agent_statements', {})
            cs = annotations.get('cards', [])
            backoff = annotations.get('backoff', {})
            counts = Counter(c['coverage'] for c in cs)
            coverage.update(counts)
            modes[backoff.get('mode', 'no_batch')] += 1
            for c in cs:
                if c.get('backoff_error'):
                    parse_errors[c['backoff_error']] += 1
            for key in ('requested_units', 'reused_units', 'deduplicated_units', 'truncated_responses', 'recovery_requests', 'missing_units'):
                totals[key] += backoff.get(key, 0)
            totals['clauses_with_partial_source'] += sum(c['fragment_partial'] for c in cs)
            allowed = {}
            for f in q.get('claim_fragments', []):
                allowed.setdefault((f['step'], f['module']), []).append((f['start'], f['end']))
            actual_sources = []
            if request:
                if request['query_response'] != q:
                    violations.append(f'{gold["trajectory_id"]}/{aid}: assessment result differs from query journal')
                else:
                    totals['query_results_exactly_delivered'] += 1
                p = request['payload']
                anchor = p['source']['step']
                for module, text in p['source']['modules'].items():
                    if text:
                        allowed.setdefault((anchor, module), []).append((0, len(text)))
                for e in p.get('manager_assignment', {}).get('evidence', []):
                    text = source['steps'][e['step'] - 1]['parts'].get(e['module']) or ''
                    offset = text.find(e['quote'])
                    if offset >= 0:
                        allowed.setdefault((e['step'], e['module']), []).append((offset, offset + len(e['quote'])))
                actual_sources = visible_sources(source, gold['gold_step'], gold['gold_module'], request)
            for c in cs:
                text = source['steps'][c['step'] - 1]['parts'][c['module']]
                if text[c['start']:c['end']] != c['quote']:
                    violations.append(f'{gold["trajectory_id"]}/{aid}: card source mismatch')
                if request and not covered(c['start'], c['end'], allowed.get((c['step'], c['module']), [])):
                    violations.append(f'{gold["trajectory_id"]}/{aid}: card exceeds visible evidence')
            gold_cards = [c for c in cs if c['step'] == gold['gold_step'] and c['module'] == gold['gold_module']]
            agents.append({'agent_id': aid, 'query_rows': len(q.get('rows', [])), 'backoff': backoff,
                'coverage': dict(counts), 'cards': len(cs), 'assessment_request_exists': request is not None,
                'gold_original_source_visible': bool(actual_sources), 'gold_cards': gold_cards})
        totals['queries'] += len(queries)
        totals['tasks_with_visible_gold_module'] += any(a['gold_original_source_visible'] for a in agents)
        totals['tasks_with_gold_statement_cards'] += any(a['gold_cards'] for a in agents)
        totals['tasks_with_extracted_gold_statements'] += any(c['statements'] for a in agents for c in a['gold_cards'])
        tasks.append({'trajectory_id': gold['trajectory_id'], 'status': result['status'],
            'gold': {'step': gold['gold_step'], 'module': gold['gold_module']},
            'predicted': {'step': gold['predicted_step'], 'module': gold['predicted_module']},
            'gold_in_trace_pool': gold['gold_step_module_in_trace'], 'semantic_usage': usage, 'agents': agents})
    summary = {**dict(totals), 'card_coverage': dict(coverage), 'batch_modes': dict(modes),
               'card_parse_errors': dict(parse_errors), 'violations': violations}
    report = {'method': __doc__, 'summary': summary, 'tasks': tasks}
    write_json(run / 'claim_parsing_review.json', report)
    (run / 'claim_parsing_review.txt').write_text('语义解析运行审计（离线）\n\n' +
        json.dumps(summary, ensure_ascii=False, indent=2) + '\n\n' +
        '\n'.join(f"{t['trajectory_id']}: gold={t['gold']}, predicted={t['predicted']}, "
                  f"in_trace={t['gold_in_trace_pool']}, parse_calls={t['semantic_usage'].get('model_calls', 0)}"
                  for t in tasks) + '\n', encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    args = parser.parse_args()
    inspect(args.run)
