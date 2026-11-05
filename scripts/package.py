"""Package extension sources only; no browser profiles, tests, or local credentials."""
from pathlib import Path
import json
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / 'extension'
version = json.loads((source / 'manifest.json').read_text())['version']
destination = root / 'dist' / f'spiegel-voebb-{version}.zip'
destination.parent.mkdir(exist_ok=True)
files = ['manifest.json', 'matching.js', 'background.js', 'spiegel.js',
         'popup.html', 'popup.js', 'popup.css']
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(source / name, name)
print(destination)
