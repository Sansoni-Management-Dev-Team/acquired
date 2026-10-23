#!/usr/bin/env python3
"""Verify a proposed package without connecting to a database or applying SQL."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--parse', action='store_true', help='Also parse SQL and PL/pgSQL using locally installed pglast')
args = parser.parse_args()
root = Path(__file__).resolve().parent
manifest = json.loads((root / 'approval-manifest.json').read_text())
assert manifest['status'] == 'proposed-not-applied'
results = []
for artifact in manifest['migrations']:
    path = root / artifact['file']
    assert path.resolve().parent == root
    source = path.read_text()
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    assert digest == artifact['sha256'], f'Changed artifact: {path.name}'
    result = {'file': path.name, 'sha256': digest, 'hashMatches': True}
    if args.parse:
        from pglast import parse_sql, parse_plpgsql
        from pglast.stream import RawStream
        statements = parse_sql(source)
        procedural = 0
        for statement in statements:
            kind = statement.stmt.__class__.__name__
            rendered = RawStream()(statement)
            if kind == 'DoStmt' or (kind == 'CreateFunctionStmt' and 'LANGUAGE plpgsql' in rendered):
                parse_plpgsql(rendered)
                procedural += 1
        result.update(statements=len(statements), proceduralBodies=procedural)
    results.append(result)
print(json.dumps({'verified': results, 'databaseAccess': False, 'applied': False}, indent=2))
