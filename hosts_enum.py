#!/usr/bin/env python3
import json
from urllib.parse import urlparse

hosts = set()
with open('public/kits.ndjson') as f:
    for line in f:
        kit = json.loads(line)
        url = kit.get('download', '')
        if url:
            hosts.add(urlparse(url).netloc)

hosts = sorted(hosts)
print(f'Found {len(hosts)} hosts:')
for h in hosts:
    print(f'  {h}')

with open('public/hosts.json', 'w') as f:
    json.dump(hosts, f, indent=2)
print('Written to public/hosts.json')