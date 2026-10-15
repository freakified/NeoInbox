#!/usr/bin/env python3
"""Lists the last eval run's non-exact samples: python3 scripts/labels/fails.py [domain-substring]"""
import json, sys
r = json.load(open('fixtures/real-mail/_reports/reservations.json'))
f = sys.argv[1] if len(sys.argv) > 1 else ''
for x in sorted(r['results'], key=lambda x: x['name']):
    if x['verdict'] in ('exact', 'tn') or f not in x['name']:
        continue
    print(x['verdict'].ljust(7), x['name'][6:46].ljust(40), x['extractor'][:9].ljust(9), '; '.join(x['problems'])[:220])
