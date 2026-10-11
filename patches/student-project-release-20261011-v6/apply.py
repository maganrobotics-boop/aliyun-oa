from pathlib import Path
import hashlib,json,sys
source=Path(sys.argv[1]);target=Path(sys.argv[2]);manifest=json.loads((Path(__file__).parent/'manifest.json').read_text())
for item in manifest['files']:
 old=target/item['path'];new=source/item['path']
 if hashlib.sha256(old.read_bytes()).hexdigest()!=item['before']:raise SystemExit('Unexpected baseline: '+item['path'])
 if hashlib.sha256(new.read_bytes()).hexdigest()!=item['after']:raise SystemExit('Unexpected source: '+item['path'])
for item in manifest['files']:(target/item['path']).write_bytes((source/item['path']).read_bytes())
print('Scoped student project identity patch applied.')
