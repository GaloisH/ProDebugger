"""Offline source-bound statement and archived-query regression checks; no labels/API."""
import argparse
from collections import Counter
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prodebugger.claim_parser import source_cards
from prodebugger.record_bridge import build_bundle, read_json, write_json
from prodebugger.debug_tools import DebugTools
from prodebugger.query_dsl import execute
from scripts.audit_trace_queries import restore_archived_facts, jsonl


def main(run, corpus, output):
    counts, tasks = Counter(), []
    for path in sorted(corpus.glob('*/input.json')):
        source = read_json(path)
        counts['trajectories'] += 1
        for card in source_cards(source):
            text = source['steps'][card['step'] - 1]['parts'][card['module']]
            assert text[card['start']:card['end']] == card['quote']
            counts['clauses'] += 1
            counts[card['coverage']] += 1
            counts[card['source_role']] += 1
    for folder in sorted(p.parent for p in run.glob('*/trace_queries.jsonl')):
        bundle = build_bundle(read_json(folder / 'input.json'), audited=read_json(folder / 'audited_parse.json'))
        restore_archived_facts(bundle, read_json(folder / 'canonical_record.json'))
        tools = DebugTools(bundle)
        traces = jsonl(folder / 'window_trace.jsonl')
        tools.windows.configure([{k: e['window'][k] for k in
            ('candidate_id', 'issue_step', 'issue_fids', 'goal_links', 'hypothesis')} for e in traces])
        queries = []
        for saved in jsonl(folder / 'trace_queries.jsonl'):
            result = execute(tools, saved['query'])
            if 'error' in result:
                raise AssertionError(result['error'])
            assert result['rows'] == saved['rows'], (folder.name, saved['candidate_id'])
            # Every sidecar source is contained in a FINAL returned source slice.
            for card in result['agent_statements']['cards']:
                intervals = sorted((f['start'], f['end']) for f in result['claim_fragments']
                    if f['step'] == card['step'] and f['module'] == card['module'])
                covered = card['start']
                for lo, hi in intervals:
                    if lo <= covered:
                        covered = max(covered, hi)
                assert covered >= card['end']
            queries.append({'candidate_id': saved['candidate_id'], 'rows_unchanged': True,
                'rows': len(result['rows']), 'cards': len(result['agent_statements']['cards']),
                'partial_clauses': sum(c['fragment_partial'] for c in result['agent_statements']['cards']),
                'scaffold_clauses': result['agent_statements']['scaffold_clauses']})
        tasks.append({'trajectory_id': folder.name, 'queries': queries})
    report = {'corpus': dict(counts), 'archived_queries': sum(len(t['queries']) for t in tasks),
              'all_query_rows_unchanged': True, 'model_calls': 0, 'tasks': tasks}
    write_json(output / 'regression.json', report)
    print({k: v for k, v in report.items() if k != 'tasks'})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('run', type=Path)
    parser.add_argument('--corpus', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('artifacts/analysis/claim-parser-validation-20261013'))
    args = parser.parse_args()
    main(args.run, args.corpus, args.output)
