import { NextResponse } from "next/server";

// Every active satellite in the public catalogue (CelesTrak GP "active", derived from the US Space Force
// 18th Space Defense Squadron catalogue), fetched server-side and cached for six hours. Used by /sphere-orbits.
export const revalidate = 21600;

export async function GET() {
  let sats: [string, string, string][] = [];
  let error: string | null = null;
  try {
    // no fetch cache: the file is ~2 MB, over Next's data cache limit; the route itself is cached instead
    const r = await fetch("https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle", {
      cache: "no-store",
      headers: { "User-Agent": "ki-prototype sampling sphere (art research)" },
    });
    if (!r.ok) throw new Error(`CelesTrak ${r.status}`);
    const lines = (await r.text()).split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
    for (let i = 0; i + 2 < lines.length + 1; i++) {
      const [name, l1, l2] = [lines[i], lines[i + 1], lines[i + 2]];
      if (l1?.startsWith("1 ") && l2?.startsWith("2 ")) { sats.push([name.trim(), l1, l2]); i += 2; }
    }
  } catch (e) {
    error = String(e);
    sats = [];
  }
  const body = { fetched: new Date().toISOString(), source: "CelesTrak GP · GROUP=active", count: sats.length, error };
  return NextResponse.json({ ...body, sats }, {
    headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" },
  });
}
