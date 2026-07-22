import { NextRequest, NextResponse } from "next/server";
import { parseKaistMenuPage } from "../../../lib/kaist";

export const dynamic = "force-dynamic";

const CAFETERIAS = [
  { code: "fclt", short: "N11", fallbackName: "카이마루" },
  { code: "west", short: "W2", fallbackName: "서맛골" },
  { code: "east1", short: "E5", fallbackName: "동맛골" },
  { code: "east2", short: "E5 · STAFF", fallbackName: "동맛골 교직원식당" },
  { code: "emp", short: "N6", fallbackName: "교수회관" },
] as const;

function todayInKorea() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("date") || todayInKorea();
  const date = /^\d{4}-\d{2}-\d{2}$/.test(requested) ? requested : todayInKorea();
  const fetchedAt = new Date().toISOString();

  const results = await Promise.all(
    CAFETERIAS.map(async ({ code, short, fallbackName }) => {
      const sourceUrl = `https://www.kaist.ac.kr/kr/html/campus/053001.html?dvs_cd=${code}&stt_dt=${date}`;
      try {
        const response = await fetch(sourceUrl, {
          headers: { "User-Agent": "EDO-KAIST-Menu-Research/1.0" },
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`KAIST returned ${response.status}`);
        return { ...parseKaistMenuPage(await response.text(), code, short, fallbackName), sourceUrl, status: "live" as const };
      } catch (error) {
        return {
          code,
          short,
          name: fallbackName,
          sourceDate: date.slice(5).replace("-", "/"),
          sourceUrl,
          status: "unavailable" as const,
          error: error instanceof Error ? error.message : "Unknown source error",
          meals: {
            breakfast: { time: "—", lines: [] as string[] },
            lunch: { time: "—", lines: [] as string[] },
            dinner: { time: "—", lines: [] as string[] },
          },
        };
      }
    }),
  );

  return NextResponse.json(
    { date, fetchedAt, cafeterias: results },
    { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=3600" } },
  );
}
