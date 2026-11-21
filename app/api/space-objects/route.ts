import { NextResponse } from "next/server";

// Tracked space objects for /entangled (payloads, rocket bodies, debris), from CelesTrak, which republishes the
// US Space Force 18th SDS public catalogue. Split into parts so each response stays well under Vercel's body limit:
//   ?part=active  every active payload            (GP GROUP=active)
//   ?part=debris  every object named "DEB"        (GP NAME=DEB) + the four big breakup groups as a fallback
//   ?part=rocket  every object named "R/B"        (GP NAME=R/B)
//   ?part=satcat  official OBJECT_TYPE, RCS (m²), owner and launch date for every object still in orbit
// Each part is cached at the CDN for 2 h (CelesTrak updates GP data every 2 h and asks not to fetch more often).
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

// compact row: [norad, name, intlDesignator, epochMs, meanMotion rev/day, ecc, incl°, raan°, argp°, meanAnomaly°, ndot/2 rev/day², bstar]
type Row = [number, string, string, number, number, number, number, number, number, number, number, number];
const r6 = (x: string) => Math.round(parseFloat(x) * 1e6) / 1e6;
function compact(o: Record<string, string>): Row | null {
  const norad = parseInt(o.NORAD_CAT_ID);
  const ep = Date.parse(o.EPOCH.endsWith("Z") ? o.EPOCH : o.EPOCH + "Z");
  const n = parseFloat(o.MEAN_MOTION);
  if (!norad || !isFinite(ep) || !(n > 0)) return null;
  return [norad, o.OBJECT_NAME, o.OBJECT_ID, ep, r6(o.MEAN_MOTION), r6(o.ECCENTRICITY) || 0, r6(o.INCLINATION), r6(o.RA_OF_ASC_NODE),
    r6(o.ARG_OF_PERICENTER), r6(o.MEAN_ANOMALY), parseFloat(o.MEAN_MOTION_DOT) || 0, parseFloat(o.BSTAR) || 0];
}

export async function GET(req: Request) {
  const part = new URL(req.url).searchParams.get("part") ?? "active";
  const sources: string[] = [];
  const errors: string[] = [];
  let body: Record<string, unknown> = {};
  try {
    if (part === "satcat") {
      const r = await fetch("https://celestrak.org/pub/satcat.csv", { cache: "no-store", headers: UA });
      if (!r.ok) throw new Error(`CelesTrak SATCAT ${r.status}`);
      const rows = parseCsv(await r.text()).filter((o) => !o.DECAY_DATE && o.ORBIT_CENTER === "EA");
      sources.push("CelesTrak SATCAT (on-orbit, Earth-centred)");
      // [norad, type (PAY/R/B/DEB/UNK), rcs m² or null, owner, launch date, ops status]
      body.rows = rows.map((o) => [parseInt(o.NORAD_CAT_ID), o.OBJECT_TYPE, o.RCS ? parseFloat(o.RCS) : null, o.OWNER, o.LAUNCH_DATE, o.OPS_STATUS_CODE]);
    } else {
      const queries = part === "debris" ? ["NAME=DEB", "GROUP=cosmos-1408-debris", "GROUP=fengyun-1c-debris", "GROUP=iridium-33-debris", "GROUP=cosmos-2251-debris"]
        : part === "rocket" ? ["NAME=R/B"] : ["GROUP=active"];
      const seen = new Map<number, Row>();
      for (const q of queries) {
        // the breakup groups are only a fallback when the name search fails
        if (part === "debris" && q.startsWith("GROUP") && seen.size > 3000) break;
        try {
          const rows = await gp(q);
          let k = 0;
          for (const o of rows) { const c = compact(o); if (c && !seen.has(c[0])) { seen.set(c[0], c); k++; } }
          sources.push(`CelesTrak GP ${q} (${k})`);
        } catch (e) { errors.push(String(e)); }
      }
      body.rows = [...seen.values()];
    }
  } catch (e) {
    errors.push(String(e));
    body.rows = [];
  }
  const ok = (body.rows as unknown[]).length > 0;
  return NextResponse.json({ part, fetched: new Date().toISOString(), sources, errors, count: (body.rows as unknown[]).length, ...body }, {
    // cache good answers for 2 h at the CDN; failures only briefly so the next visitor retries
    headers: { "Cache-Control": ok ? "public, s-maxage=7200, stale-while-revalidate=86400" : "public, s-maxage=60" },
  });
}
