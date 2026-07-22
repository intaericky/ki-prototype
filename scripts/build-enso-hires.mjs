import { readFile, writeFile } from "node:fs/promises";

const base = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ncdcOisst21Agg_LonPM180.csv0";
const output = new URL("../public/projects/enso/oisst-hires-1982-2025.bin", import.meta.url);
const outputDirectory = new URL("../public/projects/enso/", import.meta.url);
const manifestOutput = new URL("../public/projects/enso/oisst-hires-manifest.json", import.meta.url);
const missing = -32768;
const framesPerChunk = 48;

function frameDates() {
  const dates = [];
  for (let year = 1982; year <= 2025; year += 1) {
    for (let month = 1; month <= 12; month += 1) dates.push(`${year}-${String(month).padStart(2, "0")}-01`);
  }
  return dates;
}

function urlFor(date) {
  const slice = `[(%DATE%T12:00:00Z):1:(%DATE%T12:00:00Z)][(0.0):1:(0.0)][(-89.875):8:(89.875)][(-179.875):8:(179.875)]`.replaceAll("%DATE%", date);
  return `${base}?sst${slice},anom${slice}`;
}

async function fetchFrame(date, attempt = 1) {
  try {
    const response = await fetch(urlFor(date));
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const lines = (await response.text()).trim().split(/\r?\n/);
    if (lines.length !== 16200) throw new Error(`expected 16200 rows, received ${lines.length}`);
    const buffer = Buffer.allocUnsafe(16200 * 4);
    lines.forEach((line, index) => {
      const fields = line.split(",");
      const sst = Number(fields[4]);
      const anom = Number(fields[5]);
      buffer.writeInt16LE(Number.isFinite(sst) ? Math.round(sst * 100) : missing, index * 4);
      buffer.writeInt16LE(Number.isFinite(anom) ? Math.round(anom * 100) : missing, index * 4 + 2);
    });
    return buffer;
  } catch (error) {
    if (attempt >= 4) throw new Error(`${date}: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, attempt * 900));
    return fetchFrame(date, attempt + 1);
  }
}

const dates = frameDates();
const frames = new Array(dates.length);
const cached = new Map();
try {
  const oldManifest = JSON.parse(await readFile(manifestOutput, "utf8"));
  const oldBinary = await readFile(output);
  const bytesPerFrame = oldManifest.rows * oldManifest.cols * 4;
  oldManifest.dates.forEach((date, index) => cached.set(date, oldBinary.subarray(index * bytesPerFrame, (index + 1) * bytesPerFrame)));
} catch {
  // First build has no reusable frame cache.
}
let cursor = 0;
let completed = 0;
const workers = Array.from({ length: 6 }, async () => {
  while (cursor < dates.length) {
    const index = cursor++;
    frames[index] = cached.get(dates[index]) ?? await fetchFrame(dates[index]);
    completed += 1;
    if (completed % 10 === 0 || completed === dates.length) console.log(`${completed}/${dates.length}`);
  }
});

await Promise.all(workers);
const chunks = [];
for (let startFrame = 0; startFrame < frames.length; startFrame += framesPerChunk) {
  const chunkFrames = frames.slice(startFrame, startFrame + framesPerChunk);
  const firstYear = dates[startFrame].slice(0, 4);
  const lastYear = dates[startFrame + chunkFrames.length - 1].slice(0, 4);
  const file = `oisst-hires-${firstYear}-${lastYear}.bin`;
  await writeFile(new URL(file, outputDirectory), Buffer.concat(chunkFrames));
  chunks.push({ file, startFrame, frameCount: chunkFrames.length });
}
await writeFile(manifestOutput, `${JSON.stringify({
  version: 2,
  source: "NOAA NCEI OISST v2.1 via CoastWatch ERDDAP ncdcOisst21Agg_LonPM180",
  dates,
  rows: 90,
  cols: 180,
  latitudeStart: -89.875,
  longitudeStart: -179.875,
  stepDegrees: 2,
  values: ["sst_celsius_x100_int16_le", "anomaly_celsius_x100_int16_le"],
  missing,
  chunks,
}, null, 2)}\n`);
