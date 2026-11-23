import { NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

// One object's CelesTrak SATCAT record (the US Space Force public catalogue), for the Cleanup tablet: what the piece
// you just cleaned is. Looked up only when someone taps a piece, and each record is kept in the shared data cache for a
// day, so CelesTrak sees at most one request per object per day.
export const dynamic = "force-dynamic";

const UA = { "User-Agent": "ki-prototype cleanup (art research)" };
const KEYS = ["OBJECT_NAME", "OBJECT_ID", "NORAD_CAT_ID", "OBJECT_TYPE", "OWNER", "LAUNCH_DATE", "LAUNCH_SITE", "DECAY_DATE",
  "PERIOD", "INCLINATION", "APOGEE", "PERIGEE", "RCS", "ORBIT_TYPE"] as const;

async function fetchRecord(n: number) {
  const r = await fetch(`https://celestrak.org/satcat/records.php?CATNR=${n}&FORMAT=JSON`, { cache: "no-store", headers: UA });
  if (!r.ok) throw new Error(`CelesTrak SATCAT ${r.status}`);
  const j = await r.json();
  const o = Array.isArray(j) ? j[0] : null;
  if (!o) throw new Error("not found");
  const out: Record<string, unknown> = {};
  for (const k of KEYS) out[k] = o[k] ?? null;
  return { fetched: new Date().toISOString(), record: out };
}

export async function GET(req: Request) {
  const n = parseInt(new URL(req.url).searchParams.get("n") ?? "", 10);
  if (!(n > 0 && n < 1e6)) return NextResponse.json({ error: "bad n" }, { status: 400 });
  try {
    const body = await unstable_cache(() => fetchRecord(n), ["debris-info-v1", String(n)], { revalidate: 86400 })();
    return NextResponse.json(body, { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 502, headers: { "Cache-Control": "public, s-maxage=600" } });
  }
}
