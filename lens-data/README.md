# lens-data (builder)

Builds the Lens data package (`out/`). The package itself is plain data: see PACKAGE-README.md, which is copied into it as README.md.

```
npm install
npx playwright install chromium   # only to read the satellite table off the live site at build time
node build.mjs                    # all; or: catalogue | maps | loops | manifest
```

`manifest` rewrites data/maps.json (live sources) without downloading anything.
