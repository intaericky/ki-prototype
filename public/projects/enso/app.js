const THREE_URL = "./three.module.js";
const LOCAL_PREFIX = "oisst-avhrr";
const NINO_FILE = "oisst-nino34-anom-1982-2024.csv";
const FRAME_DATES = makeFrameDates();

const TEMP_SCALE = { min: -2, max: 32, ground: 15 };
const ANOM_SCALE = { min: -4, max: 4, ground: 0 };
const CELL_DEGREES = 4;
const DEFAULT_EXTRUSION_RATIO = 0.14;
const GEODESIC_DETAIL = 11;

const globeCanvas = document.querySelector("#mapCanvas");
const ninoCanvas = document.querySelector("#histCanvas");
const distCanvas = document.querySelector("#profileCanvas");
const ninoCtx = ninoCanvas.getContext("2d");
const distCtx = distCanvas.getContext("2d");

const ui = {
  time: document.querySelector("#timeSlider"),
  variable: document.querySelector("#variableSelect"),
  heightScale: document.querySelector("#heightScaleSlider"),
  colorMode: document.querySelector("#colorModeSelect"),
  play: document.querySelector("#playButton"),
  source: document.querySelector("#sourceReadout"),
  cells: document.querySelector("#cellReadout"),
  nino: document.querySelector("#meanReadout"),
  frame: document.querySelector("#rangeReadout"),
  hover: document.querySelector("#hoverReadout"),
  status: document.querySelector("#statusReadout"),
  mapTitle: document.querySelector("#mapTitle"),
  mapCaption: document.querySelector("#mapCaption"),
  heightLow: document.querySelector("#heightLowLabel"),
  heightHigh: document.querySelector("#heightHighLabel"),
};

let THREE;
let renderer;
let scene;
let camera;
let globeGroup;
let cellMesh;
let outlineMesh;
let raycaster;
let pointer;

const state = {
  frames: new Map(),
  nino: [],
  faceCells: [],
  cursor: 0,
  playing: false,
  drag: null,
  rotationX: -0.25,
  rotationY: 2.55,
  heightScale: DEFAULT_EXTRUSION_RATIO,
  colorMode: "data",
  lastTick: performance.now(),
};

init().catch((error) => {
  console.error(error);
  ui.status.textContent = "Runtime error";
  ui.source.textContent = error?.message ?? "Unknown error";
});

async function init() {
  THREE = await import(THREE_URL);
  setupThree();
  resizeAll();
  window.addEventListener("resize", () => {
    resizeAll();
    renderScene();
    drawCharts();
  });

  ui.time.addEventListener("input", () => {
    state.cursor = Number(ui.time.value);
    state.playing = false;
    ui.play.textContent = "Play";
    updateAll();
  });
  ui.variable.addEventListener("change", updateAll);
  ui.heightScale.addEventListener("input", () => {
    state.heightScale = Number(ui.heightScale.value);
    updateAll();
  });
  ui.colorMode.addEventListener("change", () => {
    state.colorMode = ui.colorMode.value;
    updateAll();
  });
  ui.play.addEventListener("click", () => {
    state.playing = !state.playing;
    ui.play.textContent = state.playing ? "Pause" : "Play";
  });

  globeCanvas.addEventListener("pointerdown", (event) => {
    globeCanvas.setPointerCapture(event.pointerId);
    state.drag = { x: event.clientX, y: event.clientY, rx: state.rotationX, ry: state.rotationY };
  });
  globeCanvas.addEventListener("pointermove", handleGlobePointer);
  globeCanvas.addEventListener("pointerup", () => {
    state.drag = null;
  });
  globeCanvas.addEventListener("pointerleave", () => {
    state.drag = null;
    ui.hover.textContent = "Move over globe";
  });
  ninoCanvas.addEventListener("pointermove", handleTimelinePointer);
  ninoCanvas.addEventListener("pointerleave", drawNinoTimeline);

  await loadData();
  ui.time.max = String(state.nino.length - 1);
  state.cursor = state.nino.length - 1;
  ui.time.value = String(state.cursor);
  updateAll();
  requestAnimationFrame(tick);
}

function setupThree() {
  renderer = new THREE.WebGLRenderer({ canvas: globeCanvas, antialias: true, alpha: false });
  renderer.setClearColor(0x050505, 1);
  renderer.setPixelRatio(window.devicePixelRatio || 1);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, 3.8);

  globeGroup = new THREE.Group();
  scene.add(globeGroup);

  const wire = new THREE.Mesh(
    new THREE.SphereGeometry(1.003, 36, 18),
    new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.04, depthWrite: false })
  );
  globeGroup.add(wire);

  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const light = new THREE.DirectionalLight(0xffffff, 1.25);
  light.position.set(-2, 2, 4);
  scene.add(light);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
}

async function loadData() {
  ui.status.textContent = "Loading OISST + Three.js";
  const [ninoCsv, frameEntries] = await Promise.all([
    fetch(NINO_FILE).then((response) => {
      if (!response.ok) throw new Error(`Missing ${NINO_FILE}`);
      return response.text();
    }),
    Promise.all(
      FRAME_DATES.map(async (date) => {
        const response = await fetch(`${LOCAL_PREFIX}-${date}.csv`);
        if (!response.ok) throw new Error(`Missing ${LOCAL_PREFIX}-${date}.csv`);
        return [date, parseFrame(await response.text())];
      })
    ),
  ]);

  state.nino = parseNino34(ninoCsv);
  frameEntries.forEach(([date, cells]) => state.frames.set(date, cells));
  ui.source.textContent = "Local NOAA OISST CSVs sampled onto one continuous geodesic relief mesh";
}

function parseFrame(csv) {
  return csv
    .trim()
    .split(/\r?\n/)
    .map((line) => {
      const [time, depth, lat, lon, sst, anom] = line.split(",");
      return {
        time,
        depth: Number(depth),
        lat: Number(lat),
        lon: normalizeLongitude(Number(lon)),
        sst: Number(sst),
        anom: Number(anom),
      };
    })
    .filter((cell) => Number.isFinite(cell.lat) && Number.isFinite(cell.lon))
    .filter((cell) => Number.isFinite(cell.sst) || Number.isFinite(cell.anom));
}

function parseNino34(csv) {
  const groups = new Map();
  csv
    .trim()
    .split(/\r?\n/)
    .forEach((line) => {
      const [time, depth, lat, lon, anom] = line.split(",");
      const value = Number(anom);
      if (!time || !Number.isFinite(Number(depth)) || !Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return;
      if (!Number.isFinite(value)) return;
      const date = time.slice(0, 10);
      const group = groups.get(date) ?? { date, total: 0, count: 0 };
      group.total += value;
      group.count += 1;
      groups.set(date, group);
    });

  return [...groups.values()]
    .map((group) => ({ date: group.date, value: group.total / group.count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function tick(now) {
  const dt = now - state.lastTick;
  state.lastTick = now;
  if (state.playing && state.nino.length) {
    const next = state.cursor + dt / 85;
    state.cursor = next >= state.nino.length ? 0 : next;
    ui.time.value = String(Math.round(state.cursor));
    updateAll();
  } else {
    renderScene();
  }
  requestAnimationFrame(tick);
}

function updateAll() {
  updateSummary();
  updateTitles();
  rebuildGlobeMesh();
  drawCharts();
  renderScene();
}

function updateSummary() {
  const nino = currentNino();
  const cells = currentCells().filter((cell) => Number.isFinite(cell.sst));
  ui.cells.textContent = `${cells.length.toLocaleString()} source ocean cells`;
  ui.nino.textContent = `${formatValue(nino.value)} deg C ${ensoLabel(nino.value)}`;
  ui.frame.textContent = formatDate(currentFrameDate());
  ui.status.textContent = `Historical cursor ${formatDate(nino.date)}`;
}

function updateTitles() {
  const variable = ui.variable.value;
  ui.mapTitle.textContent = variable === "sst" ? "Three.js SST solid relief globe" : "Three.js SST anomaly solid relief globe";
  ui.mapCaption.textContent =
    variable === "sst"
      ? `Height scale ${state.heightScale.toFixed(2)} radius. Ground is 15 C; hotter units outward, colder units inward.`
      : `Height scale ${state.heightScale.toFixed(2)} radius. Ground is 0 C anomaly; warm units outward, cool units inward.`;
  ui.heightLow.textContent = variable === "sst" ? "Colder than 15 C: inward" : "Cool anomaly: inward";
  ui.heightHigh.textContent = variable === "sst" ? "Hotter than 15 C: outward" : "Warm anomaly: outward";
  document.body.dataset.colorMode = state.colorMode;
}

function rebuildGlobeMesh() {
  if (cellMesh) {
    globeGroup.remove(cellMesh);
    cellMesh.geometry.dispose();
    cellMesh.material.dispose();
  }
  if (outlineMesh) {
    globeGroup.remove(outlineMesh);
    outlineMesh.geometry.dispose();
    outlineMesh.material.dispose();
  }

  const variable = ui.variable.value;
  const geometry = buildReliefGeometry(currentCells(), variable);
  cellMesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.82,
      metalness: 0,
      side: THREE.DoubleSide,
      flatShading: true,
    })
  );
  cellMesh.renderOrder = 1;
  globeGroup.add(cellMesh);
}

function buildReliefGeometry(cells, variable) {
  const positionsOut = [];
  const colors = [];
  state.faceCells = [];

  const { units, edges } = buildDualGeodesicUnits(GEODESIC_DETAIL);
  const scale = variable === "sst" ? TEMP_SCALE : ANOM_SCALE;
  const renderedUnits = new Map();

  units.forEach((unit) => {
    const cell = nearestSourceCell(unit, cells);
    const value = cell ? cell[variable] : NaN;
    if (!cell || !Number.isFinite(value)) return;
    const height = reliefHeight(value, variable);
    const radius = 1 + height;
    const color = unitColor(value, variable, scale);
    const faceCell = { ...cell, sampleLat: unit.lat, sampleLon: unit.lon };
    const top = unit.boundary.map((point) => point.clone().multiplyScalar(radius));
    renderedUnits.set(unit.id, { unit, cell: faceCell, radius, color, top });

    for (let tri = 1; tri < top.length - 1; tri += 1) {
      pushTriangle(positionsOut, colors, state.faceCells, top[0], top[tri], top[tri + 1], color, faceCell);
    }
  });

  edges.forEach((edge) => {
    const a = renderedUnits.get(edge.a);
    const b = renderedUnits.get(edge.b);
    if (!a && !b) return;

    if (!a || !b) {
      const unit = a ?? b;
      const top0 = edge.ends[0].clone().multiplyScalar(unit.radius);
      const top1 = edge.ends[1].clone().multiplyScalar(unit.radius);
      const core = new THREE.Vector3(0, 0, 0);
      const boundaryColor = unit.color.clone().multiplyScalar(0.42);
      pushTriangle(positionsOut, colors, state.faceCells, top0, top1, core, boundaryColor, unit.cell);
      return;
    }

    const a0 = edge.ends[0].clone().multiplyScalar(a.radius);
    const a1 = edge.ends[1].clone().multiplyScalar(a.radius);
    const b0 = edge.ends[0].clone().multiplyScalar(b.radius);
    const b1 = edge.ends[1].clone().multiplyScalar(b.radius);
    const sideColor = a.color.clone().lerp(b.color, 0.5).multiplyScalar(0.72);

    pushTriangle(positionsOut, colors, state.faceCells, a0, a1, b1, sideColor, a.cell);
    pushTriangle(positionsOut, colors, state.faceCells, a0, b1, b0, sideColor, a.cell);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positionsOut, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildDualGeodesicUnits(detail) {
  const source = new THREE.IcosahedronGeometry(1, detail).toNonIndexed();
  const sourcePositions = source.getAttribute("position");
  const vertices = [];
  const vertexMap = new Map();
  const faces = [];
  const edgeMap = new Map();

  for (let index = 0; index < sourcePositions.count; index += 3) {
    const ids = [0, 1, 2].map((offset) => {
      const point = new THREE.Vector3(
        sourcePositions.getX(index + offset),
        sourcePositions.getY(index + offset),
        sourcePositions.getZ(index + offset)
      ).normalize();
      const key = `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
      if (!vertexMap.has(key)) {
        vertexMap.set(key, vertices.length);
        vertices.push({ normal: point, faces: [] });
      }
      return vertexMap.get(key);
    });
    const center = new THREE.Vector3()
      .add(vertices[ids[0]].normal)
      .add(vertices[ids[1]].normal)
      .add(vertices[ids[2]].normal)
      .normalize();
    const faceIndex = faces.length;
    faces.push({ center });
    ids.forEach((id) => vertices[id].faces.push(faceIndex));
    [
      [ids[0], ids[1]],
      [ids[1], ids[2]],
      [ids[2], ids[0]],
    ].forEach(([a, b]) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const entry = edgeMap.get(key) ?? { a: Math.min(a, b), b: Math.max(a, b), faces: [] };
      entry.faces.push(faceIndex);
      edgeMap.set(key, entry);
    });
  }

  const units = vertices
    .map((vertex, id) => {
      const normal = vertex.normal;
      const reference = Math.abs(normal.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const tangent = new THREE.Vector3().crossVectors(reference, normal).normalize();
      const bitangent = new THREE.Vector3().crossVectors(normal, tangent).normalize();
      const boundary = vertex.faces
        .map((faceIndex) => faces[faceIndex].center)
        .sort((a, b) => Math.atan2(a.dot(bitangent), a.dot(tangent)) - Math.atan2(b.dot(bitangent), b.dot(tangent)));
      const lon = (Math.atan2(normal.x, normal.z) * 180) / Math.PI;
      const lat = (Math.asin(normal.y) * 180) / Math.PI;
      return { id, normal, boundary, lat, lon };
    })
    .filter((unit) => unit.boundary.length >= 5);

  const unitIds = new Set(units.map((unit) => unit.id));
  const edges = [...edgeMap.values()]
    .filter((edge) => unitIds.has(edge.a) && unitIds.has(edge.b) && edge.faces.length === 2)
    .map((edge) => ({
      a: edge.a,
      b: edge.b,
      ends: edge.faces.map((faceIndex) => faces[faceIndex].center),
    }));

  return { units, edges };
}

function pushTriangle(positions, colors, faceCells, a, b, c, color, cell) {
  [a, b, c].forEach((point) => {
    positions.push(point.x, point.y, point.z);
    colors.push(color.r, color.g, color.b);
  });
  faceCells.push(cell);
}

function reliefHeight(value, variable) {
  if (!Number.isFinite(value)) return 0;
  if (variable === "anom") {
    return clamp(value / ANOM_SCALE.max, -1, 1) * state.heightScale;
  }
  const span = Math.max(TEMP_SCALE.max - TEMP_SCALE.ground, TEMP_SCALE.ground - TEMP_SCALE.min);
  return clamp((value - TEMP_SCALE.ground) / span, -1, 1) * state.heightScale;
}

function unitColor(value, variable, scale) {
  if (state.colorMode === "grey") {
    return new THREE.Color(0x9a9a9a);
  }
  const t = (clamp(value, scale.min, scale.max) - scale.min) / (scale.max - scale.min);
  return variable === "sst" ? tempColor(t) : anomalyColor(t);
}

function spherePoint(lon, lat, radius) {
  const lambda = (lon * Math.PI) / 180;
  const phi = (lat * Math.PI) / 180;
  return new THREE.Vector3(
    radius * Math.cos(phi) * Math.sin(lambda),
    radius * Math.sin(phi),
    radius * Math.cos(phi) * Math.cos(lambda)
  );
}

function nearestSourceCell(unit, cells) {
  let best = null;
  let bestScore = Infinity;
  cells.forEach((cell) => {
    if (!Number.isFinite(cell.sst)) return;
    const dLat = cell.lat - unit.lat;
    const dLon = wrappedLonDifference(cell.lon, unit.lon) * Math.cos((unit.lat * Math.PI) / 180);
    const score = dLat * dLat + dLon * dLon;
    if (score < bestScore) {
      best = cell;
      bestScore = score;
    }
  });
  return bestScore <= 20 ? best : null;
}

function renderScene() {
  if (!renderer || !camera) return;
  globeGroup.rotation.x = state.rotationX;
  globeGroup.rotation.y = state.rotationY;
  renderer.render(scene, camera);
}

function drawCharts() {
  drawNinoTimeline();
  drawDistribution();
}

function resizeAll() {
  const rect = globeCanvas.getBoundingClientRect();
  if (renderer) {
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
  }
  resizeCanvas(ninoCanvas, ninoCtx);
  resizeCanvas(distCanvas, distCtx);
}

function resizeCanvas(canvas, ctx) {
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(rect.width * ratio));
  canvas.height = Math.max(1, Math.floor(rect.height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function handleGlobePointer(event) {
  if (state.drag) {
    state.rotationY = state.drag.ry + (event.clientX - state.drag.x) * 0.008;
    state.rotationX = clamp(state.drag.rx + (event.clientY - state.drag.y) * 0.006, -1.35, 1.35);
  }

  const rect = globeCanvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = cellMesh ? raycaster.intersectObject(cellMesh, false)[0] : null;
  if (hit && state.faceCells[hit.faceIndex]) {
    const cell = state.faceCells[hit.faceIndex];
    ui.hover.textContent =
      `unit ${formatLat(cell.sampleLat)}, ${formatLon(cell.sampleLon)} | source ${formatLat(cell.lat)}, ${formatLon(cell.lon)} | ` +
      `SST ${formatValue(cell.sst)} deg C | anomaly ${formatValue(cell.anom)} deg C | radius ${formatValue(1 + reliefHeight(cell[ui.variable.value], ui.variable.value))}`;
  } else {
    ui.hover.textContent = "Move over globe";
  }
  renderScene();
}

function handleTimelinePointer(event) {
  const rect = ninoCanvas.getBoundingClientRect();
  const plot = { left: 40, right: ninoCanvas.clientWidth - 16 };
  const t = clamp((event.clientX - rect.left - plot.left) / (plot.right - plot.left), 0, 1);
  state.cursor = Math.round(t * (state.nino.length - 1));
  state.playing = false;
  ui.play.textContent = "Play";
  ui.time.value = String(state.cursor);
  updateAll();
}

function drawNinoTimeline() {
  const width = ninoCanvas.clientWidth;
  const height = ninoCanvas.clientHeight;
  const plot = { left: 40, right: width - 16, top: 18, bottom: height - 28 };
  plot.width = plot.right - plot.left;
  plot.height = plot.bottom - plot.top;
  ninoCtx.clearRect(0, 0, width, height);
  ninoCtx.fillStyle = "#101010";
  ninoCtx.fillRect(0, 0, width, height);
  ninoCtx.strokeStyle = "rgba(255,255,255,0.2)";
  ninoCtx.strokeRect(plot.left, plot.top, plot.width, plot.height);
  const zeroY = yForNino(0, plot);
  ninoCtx.strokeStyle = "rgba(255,255,255,0.45)";
  ninoCtx.beginPath();
  ninoCtx.moveTo(plot.left, zeroY);
  ninoCtx.lineTo(plot.right, zeroY);
  ninoCtx.stroke();
  ninoCtx.beginPath();
  state.nino.forEach((point, index) => {
    const x = xForIndex(index, plot);
    const y = yForNino(point.value, plot);
    if (index === 0) ninoCtx.moveTo(x, y);
    else ninoCtx.lineTo(x, y);
  });
  ninoCtx.strokeStyle = "rgba(255,255,255,0.9)";
  ninoCtx.lineWidth = 1.4;
  ninoCtx.stroke();
  const cursorX = xForIndex(Math.round(state.cursor), plot);
  ninoCtx.strokeStyle = "#fff";
  ninoCtx.beginPath();
  ninoCtx.moveTo(cursorX, plot.top);
  ninoCtx.lineTo(cursorX, plot.bottom);
  ninoCtx.stroke();
  drawMiniLabels(ninoCtx, plot, "1982", "2024", "Niño 3.4 anomaly");
}

function drawDistribution() {
  const width = distCanvas.clientWidth;
  const height = distCanvas.clientHeight;
  const plot = { left: 40, right: width - 16, top: 18, bottom: height - 28 };
  plot.width = plot.right - plot.left;
  plot.height = plot.bottom - plot.top;
  const values = currentCells().map((cell) => cell.sst).filter(Number.isFinite);
  const bins = binValues(values, TEMP_SCALE.min, TEMP_SCALE.max, 24);
  const maxCount = Math.max(...bins.map((bin) => bin.count), 1);
  distCtx.clearRect(0, 0, width, height);
  distCtx.fillStyle = "#101010";
  distCtx.fillRect(0, 0, width, height);
  distCtx.fillStyle = "rgba(255,255,255,0.82)";
  bins.forEach((bin, index) => {
    const barWidth = plot.width / bins.length - 1;
    const barHeight = (bin.count / maxCount) * plot.height;
    distCtx.fillRect(plot.left + index * (plot.width / bins.length), plot.bottom - barHeight, barWidth, barHeight);
  });
  drawMiniLabels(distCtx, plot, `${TEMP_SCALE.min} C`, `${TEMP_SCALE.max} C`, "Cell count");
}

function drawMiniLabels(ctx, plot, leftLabel, rightLabel, yLabel) {
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.45)";
  ctx.fillStyle = "rgba(255,255,255,0.66)";
  ctx.font = "11px system-ui, sans-serif";
  ctx.strokeRect(plot.left, plot.top, plot.width, plot.height);
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText(leftLabel, plot.left, plot.bottom + 8);
  ctx.textAlign = "right";
  ctx.fillText(rightLabel, plot.right, plot.bottom + 8);
  ctx.save();
  ctx.translate(12, plot.top + plot.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = "center";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
  ctx.restore();
}

function currentNino() {
  return state.nino[Math.max(0, Math.min(state.nino.length - 1, Math.round(state.cursor)))] ?? { date: "2024-01-01", value: 0 };
}

function currentFrameDate() {
  const target = Date.parse(`${currentNino().date}T00:00:00Z`);
  return FRAME_DATES.reduce((best, date) => {
    const bestDistance = Math.abs(Date.parse(`${best}T00:00:00Z`) - target);
    const distance = Math.abs(Date.parse(`${date}T00:00:00Z`) - target);
    return distance < bestDistance ? date : best;
  }, FRAME_DATES[0]);
}

function currentCells() {
  return state.frames.get(currentFrameDate()) ?? [];
}

function makeFrameDates() {
  const dates = new Set([
    "1982-12-01",
    "1983-01-01",
    "1988-12-01",
    "1997-12-01",
    "1998-01-01",
    "2010-12-01",
    "2015-12-01",
    "2016-01-01",
    "2022-12-01",
    "2023-12-01",
    "2024-02-01",
    "2024-03-01",
    "2024-05-01",
    "2024-06-01",
    "2024-08-01",
    "2024-09-01",
    "2024-11-01",
    "2024-12-01",
  ]);
  for (let year = 1982; year <= 2024; year += 1) {
    ["01", "04", "07", "10"].forEach((month) => dates.add(`${year}-${month}-01`));
  }
  return [...dates].sort();
}

function xForIndex(index, plot) {
  return plot.left + (index / Math.max(1, state.nino.length - 1)) * plot.width;
}

function yForNino(value, plot) {
  return plot.bottom - ((clamp(value, -3, 3) + 3) / 6) * plot.height;
}

function binValues(values, min, max, count) {
  const bins = Array.from({ length: count }, () => ({ count: 0 }));
  values.forEach((value) => {
    const index = clamp(Math.floor(((value - min) / (max - min)) * count), 0, count - 1);
    bins[index].count += 1;
  });
  return bins;
}

function tempColor(t) {
  return new THREE.Color(rgb(interpolateStops([[0, [11, 35, 74]], [0.22, [35, 96, 145]], [0.45, [82, 153, 139]], [0.65, [210, 185, 106]], [0.82, [204, 94, 50]], [1, [130, 34, 28]]], t)));
}

function anomalyColor(t) {
  return new THREE.Color(rgb(interpolateStops([[0, [48, 79, 148]], [0.42, [200, 215, 230]], [0.5, [238, 238, 238]], [0.58, [236, 205, 184]], [1, [170, 54, 42]]], t)));
}

function interpolateStops(stops, t) {
  for (let i = 0; i < stops.length - 1; i += 1) {
    const [aT, aColor] = stops[i];
    const [bT, bColor] = stops[i + 1];
    if (t >= aT && t <= bT) {
      const local = (t - aT) / (bT - aT);
      return aColor.map((channel, index) => Math.round(channel + (bColor[index] - channel) * local));
    }
  }
  return stops[stops.length - 1][1];
}

function rgb([r, g, b]) {
  return `rgb(${r},${g},${b})`;
}

function normalizeLongitude(lon) {
  return lon > 180 ? lon - 360 : lon;
}

function wrappedLonDifference(a, b) {
  let diff = a - b;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}

function ensoLabel(value) {
  if (value >= 0.5) return "El Niño";
  if (value <= -0.5) return "La Niña";
  return "Neutral";
}

function formatDate(date) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en", { month: "short", year: "numeric", timeZone: "UTC" });
}

function formatLat(lat) {
  if (lat === 0) return "0";
  return `${Math.abs(lat).toFixed(0)} ${lat > 0 ? "N" : "S"}`;
}

function formatLon(lon) {
  if (lon === 0) return "0";
  if (Math.abs(lon) === 180) return "180";
  return `${Math.abs(lon).toFixed(0)} ${lon > 0 ? "E" : "W"}`;
}

function formatValue(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "n/a";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
