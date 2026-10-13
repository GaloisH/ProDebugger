"""Audit actual prompts/allocations and replay saved queries after recovery changes.

Read-only toward the historical run. No API calls or benchmark-label reads.
Counterfactual retrievals are not new TRACE/SUBMIT judgements or accuracy scores.
"""
import argparse
from collections import Counter
import json
from pathlib import Path
import re
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.debug_tools import DebugTools
from prodebugger.llm_client import json_lines
from prodebugger.query_dsl import execute
from prodebugger.record_bridge import build_bundle, digest, read_json, write_json
from prodebugger.trace_manager import commit, packet
from scripts.audit_trace_queries import restore_archived_facts

PROMPTS = Path(__file__).resolve().parents[1] / 'prodebugger' / 'prompts'


def validate_manager_examples(corpus, excluded):
    examples = re.findall(r'<!-- real-manager-example: (\S+) anchor=(\d+) -->\s*```json\n(.*?)\n```',
                          (PROMPTS / 'manager.md').read_text(), re.S)
    if len(examples) != 2:
        raise ValueError('Expected two source-grounded manager examples')
    result = []
    for tid, anchor, raw in examples:
        assert tid not in excluded, 'Example overlaps current evaluation'
        bundle = build_bundle(read_json(corpus / tid / 'input.json'), audited=read_json(corpus / tid / 'audited_parse.json'))
        tools = DebugTools(bundle)
        anchor = int(anchor)
        fid = next(f.fid for f in bundle.record.F if f.t == anchor and f.slot == 'plan')
        case = {'candidate_id': 'example', 'issue_step': anchor, 'issue_fids': [fid],
                'goal_links': [], 'hypothesis': 'Verify the disputed claim against its original source.'}
        tools.route_cases = [case]
        tools.windows.configure([case])
        plan = commit(tools, **json.loads(raw))
        assert 'benchmark_scope' in packet(tools)
        result.append({'trajectory_id': tid, 'anchor': anchor, 'source_digest': digest(bundle.source),
            'assignments': len(plan['assignments']), 'structural_validation': 'passed',
            'exact_visible_quotes_verified': sum(len(a['evidence']) for a in plan['assignments']),
            'uses_evaluation_task': False})
    return result


def inspect(run):
    ids = read_json(run / 'manifest.json')['trajectory_ids']
    prompts, tasks, counts = [], [], Counter()
    for tid in ids:
        folder = run / tid
        source = read_json(folder / 'input.json')
        bundle = build_bundle(source, audited=read_json(folder / 'audited_parse.json'))
        restore_archived_facts(bundle, read_json(folder / 'canonical_record.json'))
        tools = DebugTools(bundle)
        traces = {t['window_id']: t for t in json_lines(folder / 'window_trace.jsonl')}
        tools.windows.configure([{k: t['window'][k] for k in
            ('candidate_id', 'issue_step', 'issue_fids', 'goal_links', 'hypothesis')} for t in traces.values()])
        plan = read_json(folder / 'manager_plan.json')
        replayed = []
        for q in json_lines(folder / 'trace_queries.jsonl'):
            current = execute(tools, q['query'])
            unchanged = None
            if not q.get('error'):
                unchanged = current.get('error') is None and current['rows'] == q['rows'] and current['truncated'] == q['truncated']
                if not unchanged:
                    raise ValueError(f'Previously successful query regressed: {tid}/{q["candidate_id"]}')
                counts['previous_successes_unchanged'] += 1
            else:
                counts['previous_failures'] += 1
                counts['recovered_partial' if current.get('partial') else 'still_failed' if current.get('error') else 'recovered_full'] += 1
            scopes = q.get('function_scopes', [])
            for s in scopes:
                if s['function'] != 'SEARCH_TEXT':
                    continue
                counts['old_successful_search_functions'] += 1
                args = s['arguments']
                point = len(args) == 4 and args[2] == args[3]
                counts['old_successful_point_search_functions'] += int(point)
                if args[1] in ('memory', 'reflection', 'plan'):
                    counts['old_successful_mental_search_functions'] += 1
                    counts['old_successful_point_mental_search_functions'] += int(point)
                    counts['old_successful_mental_from_start'] += int(len(args) == 2 or args[2] <= 1)
            trace = traces[q['candidate_id']]
            candidates = trace.get('candidates', [])
            if candidates:
                counts['nonempty_trace_agents'] += 1
                counts['trace_before_anchor'] += int(any(c['step'] < trace['window']['issue_step'] for c in candidates))
            replayed.append({'agent_id': q['candidate_id'], 'anchor': trace['window']['issue_step'],
                'assignment': next(a for a in plan['assignments'] if a['agent_id'] == q['candidate_id']),
                'original_error': q.get('error'), 'original_function_scopes': scopes,
                'original_candidates': candidates, 'previous_success_unchanged': unchanged,
                'counterfactual_result': current})
        for path in sorted((folder / 'requests').glob('*.json')):
            req = read_json(path)
            if req['phase'] not in ('MANAGER', 'TRACE'):
                continue
            system = next(m['content'] for m in req['messages'] if m['role'] == 'system')
            payload = json.loads(next(m['content'] for m in req['messages'] if m['role'] == 'user'))
            prompt = {'trajectory_id': tid, 'path': str(path), 'phase': req['phase'],
                'system_digest': digest(system), 'query_examples': len(re.findall('<!-- real-example:', payload.get('query_language', ''))),
                'has_query_language': 'query_language' in payload,
                'worker_explicit_prior_claim_search': 'search the particular phrase in earlier memory/reflection' in system,
                'manager_explicit_full_prior_origin_duty': 'For each distinct unresolved causal mechanism' in system,
                'manager_real_allocation_examples': len(re.findall('<!-- real-manager-example:', system)),
                'has_benchmark_scope': 'benchmark_scope' in payload}
            prompts.append(prompt)
        tasks.append({'trajectory_id': tid, 'plan': plan, 'queries': replayed})
        counts['assignments'] += len(plan['assignments'])
    return {'method': 'Actual archived requests and plans; replay original SQL against saved audited parse and canonical facts. No API or label reads. Counterfactual rows only; historical outputs unchanged.',
        'run': str(run), 'summary': dict(counts), 'prompt_requests': prompts, 'tasks': tasks}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', type=Path, required=True)
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = inspect(args.run)
    report['manager_example_validation'] = validate_manager_examples(args.corpus, {t['trajectory_id'] for t in report['tasks']})
    report['new_prompt_digests'] = {name: digest((PROMPTS / name).read_text()) for name in ('manager.md', 'trace.md', 'query_dsl.md', 'submit.md')}
    write_json(args.output, report)
    print(json.dumps(report['summary'], indent=2))
    for task in report['tasks']:
        for q in task['queries']:
            if q['original_error']:
                current = q['counterfactual_result']
                print(task['trajectory_id'], q['agent_id'], 'partial=', current.get('partial'),
                    'rows=', len(current['rows']), 'error=', current.get('error'),
                    'skipped=', len(current.get('skipped_branches', [])))
    print('Validated manager source examples:', len(report['manager_example_validation']))
    print('Saved', args.output)


if __name__ == '__main__':
    main()
