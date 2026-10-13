"""Offline replay of archived queries after removing aggregate retrieval budgets."""
import argparse
from collections import Counter
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.debug_tools import DebugTools
from prodebugger.llm_client import json_lines
from prodebugger.query_dsl import execute
from prodebugger.record_bridge import build_bundle, read_json, write_json
from scripts.audit_trace_queries import restore_archived_facts


def replay(run):
    counts, reports = Counter(), []
    for tid in read_json(run / 'manifest.json')['trajectory_ids']:
        folder = run / tid
        bundle = build_bundle(read_json(folder / 'input.json'), audited=read_json(folder / 'audited_parse.json'))
        restore_archived_facts(bundle, read_json(folder / 'canonical_record.json'))
        tools = DebugTools(bundle)
        traces = json_lines(folder / 'window_trace.jsonl')
        tools.windows.configure([{k: t['window'][k] for k in
            ('candidate_id', 'issue_step', 'issue_fids', 'goal_links', 'hypothesis')} for t in traces])
        for old in json_lines(folder / 'trace_queries.jsonl'):
            new = execute(tools, old['query'])
            counts['queries'] += 1
            counts['old_truncated'] += bool(old.get('truncated'))
            counts['new_truncated'] += bool(new.get('truncated'))
            counts['old_errors'] += bool(old.get('error'))
            counts['new_errors'] += bool(new.get('error'))
            if old.get('error') != new.get('error'):
                raise ValueError(f'Unexpected error change: {tid}/{old["candidate_id"]}')
            old_empty = [s['arguments'] for s in old.get('function_scopes', [])
                if s.get('limits', {}).get('matched_sources', 0) > 0
                and s.get('limits', {}).get('returned_sources', 1) == 0]
            if old_empty:
                counts['previously_budget_emptied_queries'] += 1
                for args in old_empty:
                    scope = next(s for s in new['function_scopes'] if s['arguments'] == args)
                    assert scope['limits']['returned_sources'] == scope['limits']['matched_sources'] > 0
                counts['budget_emptied_queries_restored'] += 1
            for scope in new.get('function_scopes', []):
                if scope['function'] == 'SEARCH_TEXT' and not scope.get('error'):
                    assert scope['limits']['matched_sources'] == scope['limits']['returned_sources']
            reports.append({'trajectory_id': tid, 'agent_id': old['candidate_id'],
                'old_rows': len(old['rows']), 'old_truncated': old.get('truncated'),
                'previously_empty_branches': old_empty, 'counterfactual_result': new})
    return {'method': 'Original queries replayed against archived audited parses and canonical Fact IDs; no API or label reads; not a new diagnosis.',
            'run': str(run), 'summary': dict(counts), 'queries': reports}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    report = replay(args.run)
    write_json(args.output, report)
    print(report['summary'])
