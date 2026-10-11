from pathlib import Path
import hashlib,json,sys
source,target=map(lambda s:Path(s).resolve(),sys.argv[1:])
manifest=json.loads((Path(__file__).parent/'overlay.json').read_text())
def digest(data):return hashlib.sha256(data).hexdigest()
planned={}
for entry in manifest['edits']:
 p=target/entry['path'];data=p.read_bytes();sha=digest(data)
 if sha==entry['afterSha256']:continue
 if sha!=entry['beforeSha256']:raise SystemExit('Unexpected source: '+entry['path'])
 lines=data.decode().splitlines(True)
 for edit in reversed(entry['edits']):lines[edit['start']:edit['end']]=edit['lines']
 data=''.join(lines).encode()
 if digest(data)!=entry['afterSha256']:raise SystemExit('Patch hash mismatch')
 planned[p]=data
for name in manifest['newFiles']:
 p=target/name;archived=Path(__file__).parent/'modules'/name;data=(archived if archived.exists() else source/name).read_bytes()
 if p.exists() and p.read_bytes()!=data:raise SystemExit('Conflicting module: '+name)
 planned[p]=data
for p,data in planned.items():p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
print('Verified and applied course identity overlay.')
