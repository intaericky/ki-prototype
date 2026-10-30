import { NextResponse } from "next/server";

// Live orbital elements for Earth-observation satellites, fetched server-side from CelesTrak
// (the browser cannot always reach it) and cached for six hours. Used by /sphere-eye.
export const revalidate = 21600;

const GROUPS = ["weather", "resource", "planet", "spire", "science", "geodetic"] as const;

type Sat = { name: string; l1: string; l2: string; group: string };

function parseTLE(text: string, group: string): Sat[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd()).filter(Boolean);
  const out: Sat[] = [];
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    const name = lines[i], l1 = lines[i + 1], l2 = lines[i + 2];
    if (l1?.startsWith("1 ") && l2?.startsWith("2 ") && !name.startsWith("1 ") && !name.startsWith("2 ")) {
      out.push({ name: name.trim(), l1, l2, group });
      i += 2;
    }
  }
  return out;
}

export async function GET() {
  const results = await Promise.allSettled(
    GROUPS.map(async (g) => {
      const r = await fetch(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${g}&FORMAT=tle`, {
        next: { revalidate },
        headers: { "User-Agent": "ki-prototype sampling sphere (art research)" },
      });
      if (!r.ok) throw new Error(`${g}: ${r.status}`);
      return parseTLE(await r.text(), g);
    }),
  );
  const seen = new Set<string>();
  const sats: Sat[] = [];
  const errors: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") { errors.push(`${GROUPS[i]}: ${String(r.reason)}`); return; }
    for (const s of r.value) {
      const id = s.l1.slice(2, 7);
      if (seen.has(id)) continue;
      seen.add(id);
      sats.push(s);
    }
  });
  return NextResponse.json(
    { fetched: new Date().toISOString(), source: "CelesTrak GP", count: sats.length, errors, sats },
    { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
  );
}
