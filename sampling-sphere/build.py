"""Builds the Sampling Sphere pages into public/:
  /sphere-display  full-screen equirectangular frame for the LED sphere
  /sphere-tablet   full-screen world map for the tablet
  /sphere-studio   everything: controls, settings, export, live control
Run from the repository root:  python3 sampling-sphere/build.py
Edit sampling-sphere/studio-src.html (and data.js), then rebuild. Vendored libraries live in public/sphere-assets/vendor."""
import os, shutil
here = os.path.dirname(os.path.abspath(__file__)); pub = os.path.join(here, '..', 'public')
src = open(os.path.join(here, 'studio-src.html')).read(); data = open(os.path.join(here, 'data.js')).read()
data += "const BLUE_MARBLE='/sphere-assets/bluemarble.jpg';\nconst BLACK_MARBLE='/sphere-assets/blackmarble.jpg';\n"
src = src.replace('/*DATA*/', data)
for cdn, local in [('https://cdn.jsdelivr.net/npm/satellite.js@5.0.0/dist/satellite.min.js', 'satellite.min.js'),
                   ('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js', 'three.module.min.js'),
                   ('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.5/build/mp4-muxer.mjs', 'mp4-muxer.mjs'),
                   ('https://cdn.jsdelivr.net/npm/mqtt@5.10.4/dist/mqtt.esm.js', 'mqtt.esm.js')]:
    src = src.replace(cdn, '/sphere-assets/vendor/' + local)
assert 'cdn.jsdelivr' not in src
pages = {'sphere-studio': ('studio', 'Sampling Sphere · Studio'), 'sphere-display': ('sphere', 'Sampling Sphere · Display'), 'sphere-tablet': ('tablet', 'Sampling Sphere · Tablet')}
for path, (page, title) in pages.items():
    body = src.replace('<title>Sampling Sphere Studio</title>', '')
    html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
            f'<title>{title}</title><link rel="icon" href="data:,">'
            f'<script>window.PAGE={page!r};window.DEPLOYED=true;</script>'
            '<style>html,body{margin:0;background:#000}</style></head><body>' + body + '</body></html>')
    d = os.path.join(pub, path); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'index.html'), 'w').write(html)
os.makedirs(os.path.join(pub, 'sphere-assets'), exist_ok=True)
for f in ['bluemarble.jpg', 'blackmarble.jpg']: shutil.copy(os.path.join(here, f), os.path.join(pub, 'sphere-assets', f))
print('built', ', '.join('/' + p for p in pages))
