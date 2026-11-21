// Entangled: shared orbit maths, room sync and audience launches.
// Used by /entangled (studio + LED display) and /entangled-tablet. The GPU shader in /entangled moves the catalogue with
// exactly the same Kepler + J2 model as posEci() here, so what the CPU tests for hits is what the sphere shows.

export const MU = 398600.4418, J2 = 1.08262668e-3, RE = 6378.137, D2R = Math.PI / 180, TAU = Math.PI * 2;

// TLE mean elements → Kepler + J2 secular rates (SGP4's un-Kozai'd mean motion and semi-major axis)
export function prep(o, tRef) {
  const n = o.mm * TAU / 86400, ci = Math.cos(o.inc * D2R), b = Math.sqrt(1 - o.ecc * o.ecc);
  const a1 = Math.cbrt(MU / (n * n)), k = 0.75 * J2 * RE * RE * (3 * ci * ci - 1) / (b * b * b);
  const d1 = k / (a1 * a1), a0 = a1 * (1 - d1 / 3 - d1 * d1 - 134 / 81 * d1 * d1 * d1), d0 = k / (a0 * a0);
  const n0 = n / (1 + d0), a = a0 / (1 - d0), p = a * (1 - o.ecc * o.ecc), f = (RE / p) ** 2 * J2 * n0;
  const dO = -1.5 * f * ci, dw = 0.75 * f * (5 * ci * ci - 1), dM = n0 + 0.75 * f * b * (3 * ci * ci - 1);
  const nd = o.ndot * TAU / 86400 / 86400; // ndot/2, rad/s²
  const dt = (tRef - o.ep) / 1000;
  const wrap = (x) => ((x % TAU) + TAU) % TAU;
  return { a, e: o.ecc, i: o.inc * D2R, O: wrap(o.raan * D2R + dO * dt), w: wrap(o.argp * D2R + dw * dt), M: wrap(o.ma * D2R + dM * dt + nd * dt * dt), nd, dO, dw, dM: dM + 2 * nd * dt };
}

// position in the inertial frame (km, z north) dt seconds after prep's reference time; out = [x, y, z]
export function posEci(q, dt, out = [0, 0, 0]) {
  const e = q.e, M = q.M + q.dM * dt + q.nd * dt * dt, O = q.O + q.dO * dt, w = q.w + q.dw * dt;
  let E = M + e * Math.sin(M);
  for (let k = 0; k < 4; k++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
  const x = q.a * (Math.cos(E) - e), y = q.a * Math.sqrt(1 - e * e) * Math.sin(E);
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(q.i), si = Math.sin(q.i), cw = Math.cos(w), sw = Math.sin(w);
  out[0] = (cO * cw - sO * sw * ci) * x + (-cO * sw - sO * cw * ci) * y;
  out[1] = (sO * cw + cO * sw * ci) * x + (-sO * sw + cO * cw * ci) * y;
  out[2] = (sw * si) * x + (cw * si) * y;
  return out;
}

export function gmst(ms) {
  const jd = ms / 864e5 + 2440587.5, t = (jd - 2451545) / 36525;
  const g = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - t * t * t / 38710000;
  return ((g % 360) + 360) % 360 * D2R;
}

// inertial (z north) → scene (y up), turned by the display frame (Earth-fixed: rot = -gmst)
export function eciToScene(p, rot, out = [0, 0, 0]) {
  const c = Math.cos(rot), s = Math.sin(rot), x = c * p[0] - s * p[1], y = s * p[0] + c * p[1];
  out[0] = x; out[1] = p[2]; out[2] = -y;
  return out;
}

// catalogue parts from /api/space-objects → objects (same rules as the sphere)
export const TYPE_KEYS = ['PAY', 'R/B', 'DEB', 'UNK'];
export function parseCatalogue(parts) {
  const sat = new Map();
  for (const r of parts.satcat?.rows ?? []) sat.set(r[0], r);
  const byId = new Map();
  for (const key of ['active', 'rocket', 'debris']) for (const r of parts[key]?.rows ?? []) {
    if (byId.has(r[0])) continue;
    const [norad, intl, ep, mm, ecc, inc, raan, argp, ma, ndot] = r;
    const sc = sat.get(norad);
    let type = sc ? TYPE_KEYS.indexOf(sc[1]) : -1;
    if (type < 0) type = { active: 0, rocket: 1, debris: 2 }[key];
    if (![ep, mm, ecc, inc, raan, argp, ma].every(Number.isFinite) || ecc >= 1 || mm < 0.5) continue;
    const perigee = Math.cbrt(MU / (mm * TAU / 86400) ** 2) * (1 - ecc) - RE;
    if (!(perigee > 80)) continue;
    const yr = /^\d{4}/.test(intl) ? +intl.slice(0, 4) : null;
    byId.set(norad, { norad, intl, type, rcs: sc?.[2] ?? null, yr, ep, mm, ecc, inc, raan, argp, ma, ndot: Number.isFinite(ndot) ? ndot : 0 });
  }
  return [...byId.values()];
}

// ---------- the 360 frame's centre (the cross) and the audience's launch ----------
// rot360 is the whole-sphere rotation (quaternion [x,y,z,w]); frame direction d0 → scene direction R·d0.
export function quatMat(q) {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
}
const mv = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const rotZ = (p, g) => [Math.cos(g) * p[0] - Math.sin(g) * p[1], Math.sin(g) * p[0] + Math.cos(g) * p[1], p[2]];
const sceneToP = (s) => [s[0], -s[2], s[1]];

// A circular orbit at altAtKm through the point under the cross, heading `theta` (radians, 0 = right on the frame,
// π/2 = up), starting at simMs. Returns a catalogue-style element set so it moves with exactly the same model.
export function launchElements(q, theta, altKm, simMs, frame = 'fixed') {
  const R = quatMat(q);
  const c = mv(R, [1, 0, 0]), right = mv(R, [0, 0, -1]), up = mv(R, [0, 1, 0]);
  const vs = [right[0] * Math.cos(theta) + up[0] * Math.sin(theta), right[1] * Math.cos(theta) + up[1] * Math.sin(theta), right[2] * Math.cos(theta) + up[2] * Math.sin(theta)];
  const g = frame === 'fixed' ? gmst(simMs) : 0;
  const r = norm(rotZ(sceneToP(c), g)), v = norm(rotZ(sceneToP(vs), g));
  const h = norm(cross(r, v));
  const inc = Math.acos(Math.max(-1, Math.min(1, h[2])));
  let n = [-h[1], h[0], 0]; if (Math.hypot(n[0], n[1]) < 1e-9) n = [1, 0, 0]; n = norm(n);
  const raan = Math.atan2(n[1], n[0]);
  const u = Math.atan2(dot(r, cross(h, n)), dot(r, n));
  const wrapDeg = (x) => ((x / D2R) % 360 + 360) % 360;
  const o = { mm: 0, ecc: 0, inc: inc / D2R, raan: wrapDeg(raan), argp: 0, ma: wrapDeg(u), ep: simMs, ndot: 0 };
  // pick the mean motion so the model's semi-major axis is exactly Earth radius + altitude
  const target = RE + altKm;
  o.mm = Math.sqrt(MU / target ** 3) * 86400 / TAU;
  for (let k = 0; k < 4; k++) o.mm *= Math.pow(prep(o, simMs).a / target, 1.5);
  return o;
}

// one revolution ahead in scene coordinates (for drawing the path), n points
export function pathScene(o, fromMs, frame, n = 180) {
  const q = prep(o, fromMs), period = TAU / q.dM, pts = [], tmp = [0, 0, 0];
  for (let k = 0; k <= n; k++) {
    const dt = period * k / n, ms = fromMs + dt * 1000;
    posEci(q, dt, tmp);
    pts.push(eciToScene(tmp, frame === 'fixed' ? -gmst(ms) : 0));
  }
  return pts;
}

// ---------- hits ----------
// radar cross-section (m²) → radius (km), treating the RCS as the object's silhouette area
export const RCS_DEFAULT = [1.5, 6, 0.05, 0.1];
export const trueRadiusKm = (o) => Math.sqrt((Number.isFinite(o.rcs) && o.rcs > 0 ? o.rcs : RCS_DEFAULT[o.type]) / Math.PI) / 1000;
export const SAT_RADIUS_KM = 0.001; // the audience's satellite: ~2 m across, a typical small satellite
// the ISS debris-avoidance box (NASA): ±0.75 km radial, ±25 km along and across track; tested here as the ellipsoid inside it
export const BOX = [0.75, 25, 25];
// Calibrated alarm distance (the default hit rule):
// - 1 km reproduces how often real Starlink satellites must dodge: 148,696 manoeuvres in Jun-Nov 2025 for ~10,000
//   satellites (~one every 12 days, SpaceX FCC reports via KeepTrack); passes within 1 km of a 550 km orbit in this
//   catalogue come about once per ~10 days. It is also about the accuracy of public catalogue positions.
// - ×√(lethal / tracked): ESA (MASTER-8, 02/2026) estimates ~68,450 objects >10 cm and ~1.5 million of 1-10 cm, against
//   ~47,360 tracked. Debris above 1 cm can end a mission but cannot be dodged, so each shown object stands in for ~33.
export const ALARM_KM = 1, LETHAL_RATIO = (68450 + 1.5e6) / 47360, ALARM_HIT_KM = ALARM_KM * Math.sqrt(LETHAL_RATIO);

// closest approach of a relative motion a→b (linear within one step); returns [min distance², fraction 0..1]
export function sweepMin(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, dd = dx * dx + dy * dy + dz * dz;
  let t = dd > 0 ? -(ax * dx + ay * dy + az * dz) / dd : 0; t = Math.max(0, Math.min(1, t));
  const x = ax + dx * t, y = ay + dy * t, z = az + dz * t;
  return [x * x + y * y + z * z, t];
}

// ---------- room: MQTT relay, retained state ----------
export function roomTopic(room) { return 'sampling-sphere/v1/entangled' + (room ? '/' + room : ''); }
export function cleanRoom(s) { return (s || '').replace(/[^a-z0-9-]/gi, '').slice(0, 24); }
export function clockNow(c, wall = Date.now()) { return c.sim0 + (wall - c.wall0) * c.speed; }

export function fmtLasted(ms) {
  const s = Math.max(0, ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(s % 60)}s`;
}
export function cleanSat(d) {
  if (!d || typeof d !== 'object') return null;
  const el = d.el;
  if (!el || !['mm', 'ecc', 'inc', 'raan', 'argp', 'ma', 'ep'].every((k) => Number.isFinite(el[k]))) return null;
  return { id: String(d.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 24), name: String(d.name || '').slice(0, 32), alt: +d.alt || 0, theta: +d.theta || 0,
    el: { mm: el.mm, ecc: el.ecc, inc: el.inc, raan: el.raan, argp: el.argp, ma: el.ma, ep: el.ep, ndot: 0 }, created: +d.created || 0,
    status: d.status === 'hit' ? 'hit' : 'up', tHit: Number.isFinite(d.tHit) ? d.tHit : null, hitBy: d.hitBy && typeof d.hitBy === 'object' ? { norad: +d.hitBy.norad || 0, intl: String(d.hitBy.intl || '').slice(0, 16), type: +d.hitBy.type || 0, km: +d.hitBy.km || 0 } : null,
    near: +d.near || 0, rule: String(d.rule || '').slice(0, 12) };
}
