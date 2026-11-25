// Builds the Lens data package.
//
//   npm install && npx playwright install chromium
//   node build.mjs                 everything
//   node build.mjs catalogue       only the satellite table
//   node build.mjs maps            only the still maps
//   node build.mjs loops           only the 24-hour geostationary loops
//
// Output goes to ./out (or OUT=...). Every map uses the same equirectangular grid:
// longitude -180..180 left to right, latitude 90..-90 top to bottom.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { PRODUCTS, assign } from './products.mjs';

const SITE = process.env.SITE || 'https://ki-prototype.vercel.app';
const WMS = process.env.WMS || 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
const OUT = path.resolve(process.env.OUT || 'out');
const MAP_W = +(process.env.MAP_W || 4096), LOOP_W = +(process.env.LOOP_W || 2048);
const what = process.argv[2] || 'all';
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(new URL('./PACKAGE-README.md', import.meta.url), path.join(OUT, 'README.md'));

// ---------------------------------------------------------------- catalogue
// Reads the live Lens catalogue (the same data and the same caption code the tablet uses).
async function catalogue() {
  const { chromium } = await import('playwright');
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const p = await b.newPage();
  if (process.env.MOCK_API) { const mock = JSON.parse(fs.readFileSync(process.env.MOCK_API)); await p.route('**/api/space-objects*', (r) => r.fulfill({ json: { rows: mock[new URL(r.request().url()).searchParams.get('part')] || [] } })); } // tests only
  log('loading', SITE + '/lens?solo#test');
  await p.goto(SITE + '/lens?solo#test');
  await p.waitForFunction(() => window.__lens && window.__lens.sats().length > 0, null, { timeout: 180000 });
  const rec = await p.evaluate(async () => {
    const src = await fetch('/lens/index.html').then((r) => r.text());
    const grab = (re) => { const m = src.match(re); if (!m) throw new Error('caption code not found: ' + re); return m[0]; };
    const C = new Function([grab(/const PURPOSE = [^\n]*/), grab(/const CLASS = [^\n]*/), grab(/const classOf = [^\n]*/), grab(/const STATE = [^\n]*/)].join('\n') + '\nreturn { PURPOSE, CLASS, STATE, classOf };')();
    const MU = 398600.4418, RE = 6378.137;
    return window.__lens.sats().map((p) => {
      const n = p.mm * 2 * Math.PI / 86400, a = Math.cbrt(MU / (n * n));
      const purpose = [...new Set((p.cat || '').split('/').map((c) => C.PURPOSE[c.replace(/[?*]/g, '').trim()]).filter(Boolean))].join(', ');
      const state = C.STATE[p.state] || p.state || '';
      return {
        norad: p.norad, name: p.name, gcat_name: p.gname, gcat_category: p.cat, kind: p.kind,
        state_code: p.state, state, owner_code: p.owner, program: p.prog, class_code: p.cls, class: C.classOf(p.cls), launch_year: p.year, purpose,
        tle_epoch_utc: new Date(p.ep).toISOString(), mean_motion_rev_per_day: p.mm, eccentricity: p.ecc, inclination_deg: p.inc, raan_deg: p.raan, arg_perigee_deg: p.argp, mean_anomaly_deg: p.ma, ndot: p.ndot,
        perigee_km: Math.round(a * (1 - p.ecc) - RE), apogee_km: Math.round(a * (1 + p.ecc) - RE),
        swath_km: p.swath, swath_instrument: p.inst || '', swath_source: p.src || '',
        no_swath_reason: p.swath == null ? p.why : '', estimated_swath_km: p.est != null ? +p.est.toFixed(2) : null, estimate_basis: p.swath == null ? p.from || '' : '',
        tablet: {
          line1: p.name,
          line2: [state, C.classOf(p.cls)].filter(Boolean).join(', '),
          line3: [p.year ? 'Launched in ' + p.year : '', '{ALT} km up'].filter(Boolean).join(', '),
          line4: purpose ? purpose[0].toUpperCase() + purpose.slice(1) : '',
        },
      };
    });
  });
  await b.close();
  for (const s of rec) Object.assign(s, assign(s));
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'data/satellites.json'), JSON.stringify({ generated_utc: new Date().toISOString(), source: SITE + '/lens', count: rec.length, satellites: rec }, null, 1));
  const cols = ['norad', 'name', 'gcat_name', 'gcat_category', 'kind', 'state_code', 'state', 'owner_code', 'program', 'class_code', 'class', 'launch_year', 'purpose', 'tle_epoch_utc', 'mean_motion_rev_per_day', 'eccentricity', 'inclination_deg', 'raan_deg', 'arg_perigee_deg', 'mean_anomaly_deg', 'ndot', 'perigee_km', 'apogee_km', 'swath_km', 'swath_instrument', 'swath_source', 'no_swath_reason', 'estimated_swath_km', 'estimate_basis', 'tablet_line1', 'tablet_line2', 'tablet_line3', 'tablet_line4', 'map_id', 'map_match', 'map_note'];
  const q = (v) => v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
  const rows = rec.map((s) => cols.map((c) => q(c.startsWith('tablet_') ? s.tablet['line' + c.slice(-1)] : s[c])).join(','));
  fs.writeFileSync(path.join(OUT, 'data/satellites.csv'), [cols.join(','), ...rows].join('\n') + '\n');
  const tally = {}; for (const s of rec) { const k = s.map_id + ' / ' + s.map_match; tally[k] = (tally[k] || 0) + 1; }
  log('catalogue:', rec.length, 'satellites'); console.table(tally);
  return rec;
}

// ---------------------------------------------------------------- GIBS time axis
let caps = null;
async function times(layer) {
  if (!caps) caps = await fetch(WMS + '?SERVICE=WMS&REQUEST=GetCapabilities&VERSION=1.3.0').then((r) => r.text());
  const i = caps.indexOf('<Name>' + layer + '</Name>');
  if (i < 0) throw new Error('layer not in GIBS: ' + layer);
  const s = caps.slice(i, caps.indexOf('</Layer>', i));
  const v = (s.match(/<Dimension[^>]*>([^<]*)</) || [])[1] || '';
  // "start/end/period,..." → [[startMs, endMs, stepMs, isMonth]]
  return v.split(',').filter(Boolean).map((r) => {
    const [a, b, per] = r.split('/');
    const step = per === 'P1M' ? 'M' : per.startsWith('PT') ? +per.slice(2, -1) * 6e4 : +per.slice(1, -1) * 864e5;
    return [Date.parse(a), Date.parse(b ?? a), step];
  });
}
function has(ranges, t) { for (const [a, b, st] of ranges) if (t >= a && t <= b && (st === 'M' || (t - a) % st === 0)) return true; return false; }
const day = (t) => new Date(t).toISOString().slice(0, 10);
const D = 864e5, today = Date.parse(day(Date.now()));

// the newest valid day before today (today is still being filled in)
function lastDay(r) { const end = Math.min(Math.max(...r.map((x) => x[1])), today - D); for (let t = Date.parse(day(end)); t > end - 400 * D; t -= D) if (has(r, t)) return t; throw new Error('no recent day'); }

// ---------------------------------------------------------------- fetching
async function getmap(layer, time, w) {
  const u = `${WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${layer}&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=${w}&HEIGHT=${w / 2}&FORMAT=image/png&TRANSPARENT=TRUE&TIME=${time}`;
  for (let k = 0; k < 4; k++) {
    try {
      const r = await fetch(u);
      const buf = Buffer.from(await r.arrayBuffer());
      if (!(r.headers.get('content-type') || '').includes('image')) throw new Error(buf.toString().slice(0, 200));
      return buf;
    } catch (e) { if (k === 3) throw new Error(layer + ' ' + time + ': ' + e.message); await new Promise((f) => setTimeout(f, 2000 * (k + 1))); }
  }
}
// stack transparent PNGs (first at the bottom), then put them on black
async function stack(pngs, w) {
  const base = sharp({ create: { width: w, height: w / 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
  return sharp(await base.composite(pngs.map((input) => ({ input }))).png().toBuffer());
}
async function coverage(img) { const { data, info } = await img.clone().ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true }); let n = 0; for (const v of data) if (v > 0) n++; return +(100 * n / (info.width * info.height)).toFixed(1); }
const onBlack = (img) => img.clone().flatten({ background: '#000000' });
async function pool(items, n, fn) { const out = new Array(items.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } })); return out; }

// ---------------------------------------------------------------- live source (for fetching at the venue)
async function live(p) {
  if (p.kind === 'loopmix') return { how: `stack the frames of ${p.of.join(', ')} for the same time, in that order (later on top), on black`, refresh: 'every 10 minutes, with its source loops' };
  const r = await times(p.layer), end = Math.max(...r.map((x) => x[1])), ended = end < Date.now() - (p.kind === 'month' ? 200 : 60) * D;
  const fmt = p.kind === 'composite' || p.kind === 'loop' ? 'image/png&TRANSPARENT=TRUE' : 'image/jpeg';
  const url = `${WMS}?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&LAYERS=${p.layer}&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH={W}&HEIGHT={H}&FORMAT=${fmt}&TIME={TIME}`;
  const o = { url, size: 'W = 2 × H, for example 4096 × 2048 (keep the same size for every map so they overlay exactly)', latest_available: p.kind === 'loop' ? new Date(end).toISOString().slice(0, 19) + 'Z' : day(end) };
  if (ended) return { ...o, time: day(end), refresh: `none: the layer ended on ${day(end)}; use this date` };
  if (p.kind === 'day') return { ...o, time: 'YYYY-MM-DD, yesterday in UTC (today is still being filled in)', refresh: 'once a day, after 06:00 UTC' };
  if (p.kind === 'composite') return { ...o, time: `YYYY-MM-DD, each of the latest ${p.days} days up to yesterday in UTC`, refresh: 'once a day, after 06:00 UTC', how: `request each day as a transparent PNG and stack them oldest first, newest on top, on black. A day with no data returns an empty image.` };
  if (p.kind === 'month') return { ...o, time: 'YYYY-MM-01, the latest month in latest_available', refresh: 'once a day: check whether a new month has appeared (they appear 1 to 2 months late)' };
  if (p.kind === 'loop') return { ...o, time: 'YYYY-MM-DDTHH:M0:00Z, UTC, minutes a multiple of 10', refresh: 'every 10 minutes. A frame appears about an hour after its time, so request the latest time in latest_available or about 70 minutes ago. Transparent outside the disk; show it on black. Keep the latest 144 frames for a 24-hour loop. If a time returns an error, it is missing at the source; keep the previous frame.' };
  return o;
}

// ---------------------------------------------------------------- still maps
async function maps() {
  fs.mkdirSync(path.join(OUT, 'maps'), { recursive: true });
  const done = [];
  for (const p of PRODUCTS.filter((p) => !p.kind.startsWith('loop'))) {
    try {
      const r = await times(p.layer);
      let dates;
      if (p.kind === 'month' || p.kind === 'latest') { const end = Math.max(...r.map((x) => x[1])); dates = [p.kind === 'month' ? new Date(end).toISOString().slice(0, 10) : day(end)]; }
      else if (p.kind === 'day') dates = [day(lastDay(r))];
      else { const end = lastDay(r); dates = []; for (let t = end - (p.days - 1) * D; t <= end; t += D) if (has(r, t)) dates.push(day(t)); }
      log(p.id, dates.length > 1 ? `${dates[0]} … ${dates.at(-1)} (${dates.length} days)` : dates[0]);
      const pngs = await pool(dates, 4, (d) => getmap(p.layer, d, MAP_W));
      const img = await stack(pngs, MAP_W);
      const file = `maps/${p.id}.jpg`;
      await onBlack(img).jpeg({ quality: 92, mozjpeg: true }).toFile(path.join(OUT, file));
      done.push({ id: p.id, type: 'image', title: p.title, shows: p.shows, file, width: MAP_W, height: MAP_W / 2, gibs_layer: p.layer, baked_dates: dates, coverage_percent: await coverage(img), live: await live(p) });
    } catch (e) { log('FAILED', p.id, e.message); done.push({ id: p.id, title: p.title, error: e.message }); }
  }
  return done;
}

// ---------------------------------------------------------------- 24-hour loops
async function loops() {
  const done = [], frames = {}, TMP = path.join(OUT, '.frames'); fs.mkdirSync(TMP, { recursive: true });
  for (const p of PRODUCTS.filter((p) => p.kind === 'loop')) {
    try {
      const r = await times(p.layer);
      const end = Math.max(...r.map((x) => x[1]));
      const d0 = Date.parse(day(end)) - (end >= Date.parse(day(end)) + D - 6e5 ? 0 : D); // the latest complete UTC day
      const want = Array.from({ length: 144 }, (_, k) => d0 + k * 6e5);
      const valid = []; for (const [a, b, st] of r) if (b >= d0 - 36e5 && a <= d0 + D + 36e5) for (let t = a; t <= b; t += st) if (t >= d0 - 36e5 && t <= d0 + D + 36e5) valid.push(t);
      const use = want.map((t) => valid.reduce((m, v) => Math.abs(v - t) < Math.abs(m - t) ? v : m, valid[0]));
      log(p.id, day(d0), '144 frames,', use.filter((t, k) => t !== want[k]).length, 'filled from the nearest time');
      const dir = `loops/${p.id}`; fs.mkdirSync(path.join(OUT, dir), { recursive: true });
      frames[p.id] = await pool(use, 6, async (t, k) => {
        const png = await getmap(p.layer, new Date(t).toISOString().slice(0, 19) + 'Z', LOOP_W);
        await sharp(png).flatten({ background: '#000000' }).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(OUT, dir, `${p.id}_${String(k).padStart(3, '0')}.jpg`));
        if (k % 24 === 0) log(' ', p.id, k + '/144');
        const keep = path.join(TMP, `${p.id}_${k}.png`); fs.writeFileSync(keep, png); return keep; // kept for the stacked loop
      });
      done.push({ id: p.id, type: 'frame sequence (video)', title: p.title, shows: p.shows, folder: dir, pattern: `${p.id}_000.jpg … ${p.id}_143.jpg`, frames: 144, frame_minutes: 10, baked_day_utc: day(d0), first_frame_utc: new Date(d0).toISOString(), width: LOOP_W, height: LOOP_W / 2, gibs_layer: p.layer, frames_filled_from_nearest_time: use.filter((t, k) => t !== want[k]).length, coverage_percent: await coverage(sharp(frames[p.id][72])), live: await live(p) });
    } catch (e) { log('FAILED', p.id, e.message); done.push({ id: p.id, title: p.title, error: e.message }); }
  }
  for (const p of PRODUCTS.filter((p) => p.kind === 'loopmix')) {
    const src = p.of.filter((id) => frames[id]);
    const dir = `loops/${p.id}`; fs.mkdirSync(path.join(OUT, dir), { recursive: true });
    await pool([...Array(144).keys()], 6, async (k) => (await stack(src.map((id) => frames[id][k]), LOOP_W)).flatten({ background: '#000000' }).jpeg({ quality: 90, mozjpeg: true }).toFile(path.join(OUT, dir, `${p.id}_${String(k).padStart(3, '0')}.jpg`)));
    const first = done.find((d) => d.id === src[0]) || {};
    done.push({ id: p.id, type: 'frame sequence (video)', title: p.title, shows: p.shows, folder: dir, pattern: `${p.id}_000.jpg … ${p.id}_143.jpg`, frames: 144, frame_minutes: 10, baked_day_utc: first.baked_day_utc, first_frame_utc: first.first_frame_utc, width: LOOP_W, height: LOOP_W / 2, made_from: src, coverage_percent: await coverage(await stack(src.map((id) => frames[id][72]), LOOP_W)), live: await live(p) });
    log(p.id, 'stacked from', src.join(', '));
  }
  fs.rmSync(TMP, { recursive: true, force: true });
  return done;
}

// ---------------------------------------------------------------- run
const manifest = fs.existsSync(path.join(OUT, 'data/maps.json')) ? JSON.parse(fs.readFileSync(path.join(OUT, 'data/maps.json'))) : { maps: [] };
const put = (list) => { for (const m of list) { const i = manifest.maps.findIndex((x) => x.id === m.id); if (i >= 0) manifest.maps[i] = m; else manifest.maps.push(m); } };
if (what === 'all' || what === 'catalogue') await catalogue();
if (what === 'all' || what === 'maps') put(await maps());
if (what === 'all' || what === 'loops') put(await loops());
if (what === 'manifest') for (const m of manifest.maps) {
  const p = PRODUCTS.find((x) => x.id === m.id); if (!p || m.error) continue;
  if (m.dates) { m.baked_dates = m.dates; delete m.dates; } if (m.day_utc) { m.baked_day_utc = m.day_utc; delete m.day_utc; }
  m.type = p.kind.startsWith('loop') ? 'frame sequence (video)' : 'image'; m.live = await live(p);
}
if (what !== 'catalogue') {
  manifest.generated_utc = new Date().toISOString();
  manifest.grid = 'equirectangular (plate carree), longitude -180..180 left to right, latitude 90..-90 top to bottom; identical for every map and loop, and for the NASA Blue Marble';
  manifest.source = 'NASA GIBS (Global Imagery Browse Services), WMS, EPSG:4326, "best" imagery. Public, no key.';
  fs.mkdirSync(path.join(OUT, 'data'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'data/maps.json'), JSON.stringify(manifest, null, 1));
  const bad = manifest.maps.filter((m) => m.error);
  log('maps:', manifest.maps.length - bad.length, 'ok', bad.length ? '· FAILED: ' + bad.map((m) => m.id).join(', ') : '');
}
