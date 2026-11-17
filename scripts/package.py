"""Package extension sources only; no browser profiles, tests, or local credentials.

The explicit file list lives in scripts/package-files.json so that `npm run check`
can verify it against the manifest and the extension directory.
"""
from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / 'extension'
version = json.loads((source / 'manifest.json').read_text())['version']
destination = root / 'dist' / f'news-library-lookup-{version}.zip'
destination.parent.mkdir(exist_ok=True)
files = json.loads((root / 'scripts' / 'package-files.json').read_text())
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(source / name, name)
print(destination)
