import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

// Tracked space objects for /entangled (payloads, rocket bodies, debris), from CelesTrak, which republishes the
// US Space Force 18th SDS public catalogue. Split into parts so each response stays well under Vercel's body limit:
//   ?part=active  every active payload            (GP GROUP=active)
//   ?part=debris  every object named "DEB"        (GP NAME=DEB) + the four big breakup groups as a fallback
//   ?part=rocket  every object named "R/B"        (GP NAME=R/B)
//   ?part=eo      Earth-observation and weather payloads with their names (GP GROUP=weather, resource, planet), for /coverage
//   ?part=gcateo  every Earth-observation payload still operating, from Jonathan McDowell's GCAT (psatcat Category EOSCI,
//                 IMG, IMG-R, MET, MET-RO; TOp "*"), joined to US catalogue numbers via GCAT satcat (Status O), for /lens
//   ?part=satcat  official OBJECT_TYPE, RCS (m²), owner and launch date for every object still in orbit
// Each part is kept in Next's shared data cache for 2 h (one CelesTrak download per part per 2 h for the whole site,
// across regions and deployments; CelesTrak answers 403 to anyone fetching the same data more often). A failed
// refresh keeps serving the last good copy.
export const dynamic = "force-dynamic";

const UA = { "User-Agent": "ki-prototype entangled (art research)" };
const GP = "https://celestrak.org/NORAD/elements/gp.php?FORMAT=csv&";

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const split = (l: string) => {
    const out: string[] = [];
    let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (q && l[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
      else if (c === "," && !q) { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const head = split(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((l) => {
    const v = split(l);
    const o: Record<string, string> = {};
    head.forEach((h, i) => (o[h] = (v[i] ?? "").trim()));
    return o;
  });
}

async function gp(query: string) {
  const r = await fetch(GP + query, { cache: "no-store", headers: UA });
  if (!r.ok) throw new Error(`CelesTrak ${query} ${r.status}`);
  const t = await r.text();
  if (!t.startsWith("OBJECT_NAME")) throw new Error(`CelesTrak ${query}: ${t.slice(0, 80)}`);
  return parseCsv(t);
}

// compact row: [norad, intlDesignator, epochMs, meanMotion rev/day, ecc, incl°, raan°, argp°, meanAnomaly°, ndot/2 rev/day²]
// (kept small so each part fits the 2 MB data-cache item limit)
type Row = [number, string, number, number, number, number, number, number, number, number];
const rd = (x: string, k: number) => Math.round(parseFloat(x) * k) / k;
function compact(o: Record<string, string>): Row | null {
  const norad = parseInt(o.NORAD_CAT_ID);
  const ep = Date.parse(o.EPOCH.endsWith("Z") ? o.EPOCH : o.EPOCH + "Z");
  const n = parseFloat(o.MEAN_MOTION);
  if (!norad || !isFinite(ep) || !(n > 0)) return null;
  return [norad, o.OBJECT_ID, Math.round(ep), rd(o.MEAN_MOTION, 1e8), rd(o.ECCENTRICITY, 1e7) || 0, rd(o.INCLINATION, 1e4), rd(o.RA_OF_ASC_NODE, 1e4),
    rd(o.ARG_OF_PERICENTER, 1e4), rd(o.MEAN_ANOMALY, 1e4), parseFloat(o.MEAN_MOTION_DOT) || 0];
}

async function fetchPart(part: string) {
  const sources: string[] = [];
  const errors: string[] = [];
  let rows: unknown[] = [];
  if (part === "gcateo") {
    const tsv = async (u: string) => {
      const r = await fetch(u, { cache: "no-store", headers: UA });
      if (!r.ok) throw new Error(`GCAT ${u} ${r.status}`);
      const lines = (await r.text()).split(/\r?\n/);
      const hi = lines.findIndex((l) => l.startsWith("#JCAT"));
      if (hi < 0) throw new Error(`GCAT ${u}: no header`);
      const head = lines[hi].replace(/^#/, "").split("\t").map((h) => h.trim());
      return lines.slice(hi + 1).filter((l) => l && !l.startsWith("#")).map((l) => { const v = l.split("\t"); const o: Record<string, string> = {}; head.forEach((h, i) => (o[h] = (v[i] ?? "").trim())); return o; });
    };
    const EO = new Set(["EOSCI", "IMG", "IMG-R", "MET", "MET-RO"]);
    const pay = await tsv("https://planet4589.org/space/gcat/tsv/cat/psatcat.tsv");
    const want = new Map<string, Record<string, string>>();
    for (const o of pay) {
      const cats = (o.Category || "").split("/").map((c) => c.replace(/[?*]/g, "").trim());
      if (cats.some((c) => EO.has(c)) && (o.TOp || "").trim() === "*") want.set(o.JCAT, o);
    }
    const sat = await tsv("https://planet4589.org/space/gcat/tsv/cat/satcat.tsv");
    for (const o of sat) {
      const p = want.get(o.JCAT);
      if (!p || !/^O/.test(o.Status || "")) continue;
      const n = parseInt(o.Satcat, 10);
      if (!n) continue;
      // [norad, name, category, class (A amateur, B business, C civil, D defence), state, owner (GCAT org code), program]
      rows.push([n, p.Name || o.Name, p.Category, p.Class || "", o.State || "", o.Owner || "", p.Program || ""]);
    }
    sources.push(`GCAT psatcat + satcat (${rows.length} operating Earth-observation payloads)`);
    if (!rows.length) throw new Error("GCAT: no rows");
    return { part, fetched: new Date().toISOString(), sources, errors, count: rows.length, rows };
  }
  if (part === "satcat") {
    const r = await fetch("https://celestrak.org/pub/satcat.csv", { cache: "no-store", headers: UA });
    if (!r.ok) throw new Error(`CelesTrak SATCAT ${r.status}`);
    const all = parseCsv(await r.text()).filter((o) => !o.DECAY_DATE && o.ORBIT_CENTER === "EA");
    sources.push("CelesTrak SATCAT (on-orbit, Earth-centred)");
    // [norad, type (PAY/R/B/DEB/UNK), rcs m² or null, owner code]
    rows = all.map((o) => [parseInt(o.NORAD_CAT_ID), o.OBJECT_TYPE, o.RCS ? Math.round(parseFloat(o.RCS) * 1e4) / 1e4 : null, o.OWNER || null]);
  } else {
    if (part === "eo") {
      const seen = new Map<number, unknown[]>();
      for (const q of ["GROUP=weather", "GROUP=resource", "GROUP=planet"]) {
        try {
          const got = await gp(q);
          let k = 0;
          for (const o of got) { const c = compact(o); if (c && !seen.has(c[0])) { seen.set(c[0], [...c, o.OBJECT_NAME, q.slice(6)]); k++; } }
          sources.push(`CelesTrak GP ${q} (${k})`);
        } catch (e) { errors.push(String(e)); }
      }
      rows = [...seen.values()];
      if (!rows.length) throw new Error(errors.join("; ") || "empty");
      return { part, fetched: new Date().toISOString(), sources, errors, count: rows.length, rows };
    }
    const queries = part === "debris" ? ["NAME=DEB", "GROUP=cosmos-1408-debris", "GROUP=fengyun-1c-debris", "GROUP=iridium-33-debris", "GROUP=cosmos-2251-debris"]
      : part === "rocket" ? ["NAME=R/B"] : ["GROUP=active"];
    const seen = new Map<number, Row>();
    for (const q of queries) {
      // the breakup groups are only a fallback when the name search fails
      if (part === "debris" && q.startsWith("GROUP") && seen.size > 3000) break;
      try {
        const got = await gp(q);
        let k = 0;
        for (const o of got) { const c = compact(o); if (c && !seen.has(c[0])) { seen.set(c[0], c); k++; } }
        sources.push(`CelesTrak GP ${q} (${k})`);
      } catch (e) { errors.push(String(e)); }
    }
    rows = [...seen.values()];
  }
  // throwing keeps the previous cached copy and lets the next request retry
  if (!rows.length) throw new Error(errors.join("; ") || "empty");
  return { part, fetched: new Date().toISOString(), sources, errors, count: rows.length, rows };
}

const cachedPart = (part: string) => unstable_cache(() => fetchPart(part), ["space-objects-v2", part === "satcat" ? "satcat-owner" : part], { revalidate: 7200, tags: ["space-objects"] })();

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("part") ?? "active";
  const part = ["active", "debris", "rocket", "satcat", "eo", "gcateo"].includes(raw) ? raw : "active";
  try {
    const body = await cachedPart(part);
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=86400" } });
  } catch (e) {
    // back off for 15 min so failures don't hammer CelesTrak
    return NextResponse.json({ part, fetched: null, sources: [], errors: [String(e)], count: 0, rows: [] }, { status: 503, headers: { "Cache-Control": "public, s-maxage=900" } });
  }
}
