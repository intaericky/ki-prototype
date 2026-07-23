const THREE_URL = "./three.module.js";
const HIRES_MANIFEST_FILE = "oisst-hires-manifest.json";
const GEODESIC_TOPOLOGY_FILE = "geodesic-39.bin";
const FRAME_DATES = makeFrameDates();
if (new URLSearchParams(window.location.search).has("embed")) document.body.classList.add("embedded");

const TEMP_SCALE = { min: -2, max: 32, ground: 15 };
const ANOM_SCALE = { min: -4, max: 4, ground: 0 };
const CELL_DEGREES = 2;
const DEFAULT_EXTRUSION_RATIO = 0.14;
const GEODESIC_DETAIL = 39;
const ENSO_THRESHOLD = 0.5;
const ENSO_MIN_SEASONS = 5;
const MS_PER_MONTH_AT_PLAYBACK = 1000 / 12;

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
  globeState: document.querySelector("#ninoGlobeState"),
  globePhase: document.querySelector("#globePhaseReadout"),
  globeNino: document.querySelector("#globeNinoReadout"),
};

let THREE;
let renderer;
let scene;
let camera;
let globeGroup;
let cellMesh;
let outlineMesh;
let ninoGuideGroup;
let geodesicTopology;
let raycaster;
let pointer;

const state = {
  frames: new Map(),
  frameBinaries: [],
  frameManifest: null,
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
  episodesSent: false,
  ready: false,
};

window.addEventListener("message", (event) => {
  if (event.origin !== window.location.origin || event.data?.type !== "ENSO_CONTROL") return;
  const height = Number(event.data.height);
  if (Number.isFinite(height)) {
    state.heightScale = clamp(height, 0, 0.5);
    ui.heightScale.value = String(state.heightScale);
    if (state.ready) updateAll();
  }
});

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
  state.ready = true;
  updateAll();
  if (window.parent !== window) window.parent.postMessage({ type: "ARTWORK_READY" }, window.location.origin);
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
  ninoGuideGroup = new THREE.Group();
  ninoGuideGroup.renderOrder = 4;
  globeGroup.add(ninoGuideGroup);

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
  ui.status.textContent = "Loading high-resolution OISST + Three.js";
  const manifest = await fetch(HIRES_MANIFEST_FILE).then((response) => {
    if (!response.ok) throw new Error(`Missing ${HIRES_MANIFEST_FILE}`);
    return response.json();
  });
  const [frameBinaries, topologyBuffer] = await Promise.all([
    Promise.all(manifest.chunks.map(({ file }) => fetch(file).then((response) => {
      if (!response.ok) throw new Error(`Missing ${file}`);
      return response.arrayBuffer();
    }))),
    fetch(GEODESIC_TOPOLOGY_FILE).then((response) => {
      if (!response.ok) throw new Error(`Missing ${GEODESIC_TOPOLOGY_FILE}`);
      return response.arrayBuffer();
    }),
  ]);

  state.frameManifest = manifest;
  state.frameBinaries = frameBinaries;
  geodesicTopology = parseGeodesicTopology(topologyBuffer);
  if (manifest.dates.length !== FRAME_DATES.length || manifest.dates.some((date, index) => date !== FRAME_DATES[index])) {
    throw new Error("High-resolution frame manifest does not match the ENSO timeline");
  }
  state.nino = buildNino34FromPackedFrames();
  ui.source.textContent = "NOAA OISST 2° high-resolution frames, 1982–2025, packed for exhibition playback";
}

function parsePackedFrame(date) {
  if (state.frames.has(date)) return state.frames.get(date);
  const manifest = state.frameManifest;
  const frameIndex = manifest.dates.indexOf(date);
  if (frameIndex < 0) return [];
  const chunkIndex = manifest.chunks.findIndex(({ startFrame, frameCount }) => frameIndex >= startFrame && frameIndex < startFrame + frameCount);
  if (chunkIndex < 0) return [];
  const chunk = manifest.chunks[chunkIndex];
  const view = new DataView(state.frameBinaries[chunkIndex]);
  const cellCount = manifest.rows * manifest.cols;
  const frameOffset = (frameIndex - chunk.startFrame) * cellCount * 4;
  const cells = [];
  const gridCells = new Array(cellCount).fill(null);
  for (let row = 0; row < manifest.rows; row += 1) {
    for (let col = 0; col < manifest.cols; col += 1) {
      const cellIndex = row * manifest.cols + col;
      const offset = frameOffset + cellIndex * 4;
      const rawSst = view.getInt16(offset, true);
      const rawAnom = view.getInt16(offset + 2, true);
      if (rawSst === manifest.missing && rawAnom === manifest.missing) continue;
      const cell = {
        time: date,
        depth: 0,
        lat: manifest.latitudeStart + row * manifest.stepDegrees,
        lon: manifest.longitudeStart + col * manifest.stepDegrees,
        sst: rawSst === manifest.missing ? NaN : rawSst / 100,
        anom: rawAnom === manifest.missing ? NaN : rawAnom / 100,
      };
      cells.push(cell);
      gridCells[cellIndex] = cell;
    }
  }
  cells.gridCells = gridCells;
  cells.gridSpec = manifest;
  state.frames.set(date, cells);
  while (state.frames.size > 8) state.frames.delete(state.frames.keys().next().value);
  return cells;
}

function buildNino34FromPackedFrames() {
  const manifest = state.frameManifest;
  const cellCount = manifest.rows * manifest.cols;
  const points = manifest.dates.map((date, frameIndex) => {
    const chunkIndex = manifest.chunks.findIndex(({ startFrame, frameCount }) => frameIndex >= startFrame && frameIndex < startFrame + frameCount);
    const chunk = manifest.chunks[chunkIndex];
    const view = new DataView(state.frameBinaries[chunkIndex]);
    const frameOffset = (frameIndex - chunk.startFrame) * cellCount * 4;
    let total = 0;
    let count = 0;
    for (let row = 0; row < manifest.rows; row += 1) {
      const lat = manifest.latitudeStart + row * manifest.stepDegrees;
      if (lat < -5 || lat > 5) continue;
      for (let col = 0; col < manifest.cols; col += 1) {
        const lon = manifest.longitudeStart + col * manifest.stepDegrees;
        if (lon < -170 || lon > -120) continue;
        const offset = frameOffset + (row * manifest.cols + col) * 4 + 2;
        const rawAnom = view.getInt16(offset, true);
        if (rawAnom === manifest.missing) continue;
        total += rawAnom / 100;
        count += 1;
      }
    }
    return { date, value: count ? total / count : 0 };
  });

  points.forEach((point, index) => {
    const window = points.slice(Math.max(0, index - 1), Math.min(points.length, index + 2));
    point.rolling = window.reduce((sum, item) => sum + item.value, 0) / window.length;
    point.phase = "Neutral";
  });

  for (const phase of ["El Niño", "La Niña"]) {
    const qualifies = (value) => phase === "El Niño" ? value >= ENSO_THRESHOLD : value <= -ENSO_THRESHOLD;
    let start = 0;
    while (start < points.length) {
      while (start < points.length && !qualifies(points[start].rolling)) start += 1;
      let end = start;
      while (end < points.length && qualifies(points[end].rolling)) end += 1;
      if (end - start >= ENSO_MIN_SEASONS) {
        for (let index = start; index < end; index += 1) points[index].phase = phase;
      }
      start = Math.max(end, start + 1);
    }
  }
  return points;
}

function tick(now) {
  const dt = now - state.lastTick;
  state.lastTick = now;
  if (state.playing && state.nino.length) {
    const previous = Math.round(state.cursor);
    const next = state.cursor + dt / MS_PER_MONTH_AT_PLAYBACK;
    state.cursor = next >= state.nino.length ? 0 : next;
    ui.time.value = String(Math.round(state.cursor));
    if (Math.round(state.cursor) !== previous) updateAll();
    else renderScene();
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
  ui.nino.textContent = `${formatValue(nino.rolling)} deg C ${nino.phase}`;
  ui.frame.textContent = formatDate(currentFrameDate());
  ui.status.textContent = `Historical cursor ${formatDate(nino.date)}`;
  const phaseKey = nino.phase === "El Niño" ? "el-nino" : nino.phase === "La Niña" ? "la-nina" : "neutral";
  ui.globeState.dataset.phase = phaseKey;
  ui.globePhase.textContent = nino.phase.toUpperCase();
  ui.globeNino.textContent = `${nino.rolling >= 0 ? "+" : ""}${nino.rolling.toFixed(2)}°C`;
  if (window.parent !== window) {
    const message = {
      type: "ENSO_STATUS",
      date: nino.date,
      value: nino.rolling,
      phase: nino.phase,
    };
    if (!state.episodesSent) {
      message.episodes = ensoEpisodes();
      state.episodesSent = true;
    }
    window.parent.postMessage(message, window.location.origin);
  }
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
  const variable = ui.variable.value;
  const cells = currentCells();
  updateInstancedGlobe(cells, variable);
  rebuildNinoGuides(cells);
}

function updateInstancedGlobe(cells, variable) {
  const { units } = getGeodesicTopology();
  if (!cellMesh) {
    cellMesh = new THREE.InstancedMesh(
      buildOpenHexPrismGeometry(),
      new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
      units.length
    );
    cellMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    cellMesh.renderOrder = 1;
    globeGroup.add(cellMesh);
  }
  const scale = variable === "sst" ? TEMP_SCALE : ANOM_SCALE;
  const matrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const size = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const normal = new THREE.Vector3();
  state.faceCells = [];
  let instance = 0;
  units.forEach((unit) => {
    const cell = nearestSourceCell(unit, cells);
    const value = cell ? cell[variable] : NaN;
    if (!cell || !Number.isFinite(value)) return;
    normal.copy(spherePoint(unit.lon, unit.lat, 1)).normalize();
    const height = reliefHeight(value, variable);
    const direction = height < 0 ? normal.clone().multiplyScalar(-1) : normal;
    const thickness = Math.max(0.004, Math.abs(height));
    const cellRadius = unit.boundary.reduce((sum, point) => sum + point.distanceTo(normal), 0) / unit.boundary.length;
    position.copy(normal).multiplyScalar(1 + height / 2);
    quaternion.setFromUnitVectors(up, direction);
    size.set(cellRadius * 1.06, thickness, cellRadius * 1.06);
    matrix.compose(position, quaternion, size);
    cellMesh.setMatrixAt(instance, matrix);
    cellMesh.setColorAt(instance, unitColor(value, variable, scale));
    state.faceCells[instance] = { ...cell, sampleLat: unit.lat, sampleLon: unit.lon };
    instance += 1;
  });
  cellMesh.count = instance;
  cellMesh.instanceMatrix.needsUpdate = true;
  if (cellMesh.instanceColor) cellMesh.instanceColor.needsUpdate = true;
  cellMesh.computeBoundingSphere();
}

function buildOpenHexPrismGeometry() {
  const positions = [];
  const top = Array.from({ length: 6 }, (_, index) => {
    const angle = Math.PI / 6 + index * Math.PI / 3;
    return new THREE.Vector3(Math.cos(angle), 0.5, Math.sin(angle));
  });
  const bottom = top.map((point) => new THREE.Vector3(point.x, -0.5, point.z));
  for (let index = 0; index < 6; index += 1) {
    const next = (index + 1) % 6;
    [bottom[index], top[index], top[next], bottom[index], top[next], bottom[next]].forEach((point) => positions.push(point.x, point.y, point.z));
    [new THREE.Vector3(0, 0.5, 0), top[index], top[next]].forEach((point) => positions.push(point.x, point.y, point.z));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function buildReliefGeometry(cells, variable) {
  const positionsOut = [];
  const colors = [];
  state.faceCells = [];

  const { units, edges } = getGeodesicTopology();
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

function getGeodesicTopology() {
  if (!geodesicTopology) geodesicTopology = buildDualGeodesicUnits(GEODESIC_DETAIL);
  return geodesicTopology;
}

function parseGeodesicTopology(buffer) {
  const view = new DataView(buffer);
  let offset = 0;
  if (view.getUint32(offset, true) !== 0x4b494754) throw new Error("Invalid geodesic topology"); offset += 4;
  const version = view.getUint32(offset, true); offset += 4;
  if (version !== 1) throw new Error(`Unsupported geodesic topology ${version}`);
  const unitCount = view.getUint32(offset, true); offset += 4;
  const edgeCount = view.getUint32(offset, true); offset += 4;
  const units = [];
  for (let index = 0; index < unitCount; index += 1) {
    const id = view.getUint32(offset, true); offset += 4;
    const boundaryCount = view.getUint8(offset); offset += 4;
    const lat = view.getFloat32(offset, true); offset += 4;
    const lon = view.getFloat32(offset, true); offset += 4;
    const boundary = [];
    for (let pointIndex = 0; pointIndex < 6; pointIndex += 1) {
      const point = new THREE.Vector3(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true));
      offset += 12;
      if (pointIndex < boundaryCount) boundary.push(point);
    }
    units.push({ id, boundary, lat, lon });
  }
  const edges = [];
  for (let index = 0; index < edgeCount; index += 1) {
    const a = view.getUint32(offset, true); offset += 4;
    const b = view.getUint32(offset, true); offset += 4;
    const ends = [];
    for (let pointIndex = 0; pointIndex < 2; pointIndex += 1) {
      ends.push(new THREE.Vector3(view.getFloat32(offset, true), view.getFloat32(offset + 4, true), view.getFloat32(offset + 8, true)));
      offset += 12;
    }
    edges.push({ a, b, ends });
  }
  return { units, edges };
}

function rebuildNinoGuides(cells) {
  while (ninoGuideGroup.children.length) {
    const child = ninoGuideGroup.children[0];
    ninoGuideGroup.remove(child);
    child.geometry.dispose();
    child.material.dispose();
  }
  const phase = currentNino().phase;
  const currentColor = phase === "El Niño" ? 0xff2400 : phase === "La Niña" ? 0x004cff : 0xffffff;
  [
    { offset: -ENSO_THRESHOLD, color: 0x004cff, opacity: 0.78 },
    { offset: ENSO_THRESHOLD, color: 0xff2400, opacity: 0.78 },
    { offset: null, color: currentColor, opacity: 1 },
  ].forEach(({ offset, color, opacity }) => {
    const geometry = offset === null ? buildNinoGuideGeometry(cells) : buildNinoBoundaryGeometry(cells, offset);
    const material = offset === null
      ? new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false })
      : new THREE.PointsMaterial({ color, size: 3.2, sizeAttenuation: false, transparent: true, opacity: 1, depthTest: false, depthWrite: false });
    const guide = offset === null ? new THREE.LineSegments(geometry, material) : new THREE.Points(geometry, material);
    guide.renderOrder = offset === null ? 6 : 7;
    ninoGuideGroup.add(guide);
  });
}

function buildNinoGuideGeometry(cells) {
  const positions = [];
  const { units } = getGeodesicTopology();
  units.forEach((unit) => {
    if (unit.lat < -5 || unit.lat > 5 || unit.lon < -170 || unit.lon > -120) return;
    const cell = nearestSourceCell(unit, cells);
    if (!cell || !Number.isFinite(cell.sst) || !Number.isFinite(cell.anom)) return;
    const radius = 1 + reliefHeight(cell.sst, "sst") + 0.0025;
    for (let index = 0; index < unit.boundary.length; index += 1) {
      const a = unit.boundary[index].clone().multiplyScalar(radius);
      const b = unit.boundary[(index + 1) % unit.boundary.length].clone().multiplyScalar(radius);
      positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function buildNinoBoundaryGeometry(cells, anomalyOffset) {
  const positions = [];
  const addPath = (samples) => {
    for (let index = 0; index < samples.length - 1; index += 1) {
      const points = [samples[index], samples[index + 1]].map(({ lat, lon }) => {
        const cell = nearestSourceCell({ lat, lon }, cells);
        if (!cell || !Number.isFinite(cell.sst) || !Number.isFinite(cell.anom)) return null;
        const thresholdSst = cell.sst - cell.anom + anomalyOffset;
        return spherePoint(lon, lat, 1 + reliefHeight(thresholdSst, "sst") + 0.0012);
      });
      if (points[0] && points[1]) positions.push(points[0].x, points[0].y, points[0].z, points[1].x, points[1].y, points[1].z);
    }
  };
  const longitudes = Array.from({ length: 51 }, (_, index) => -170 + index);
  const latitudes = Array.from({ length: 11 }, (_, index) => -5 + index);
  addPath(longitudes.map((lon) => ({ lat: -5, lon })));
  addPath(longitudes.map((lon) => ({ lat: 5, lon })));
  addPath(latitudes.map((lat) => ({ lat, lon: -170 })));
  addPath(latitudes.map((lat) => ({ lat, lon: -120 })));
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
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
  if (cells.gridCells && cells.gridSpec) {
    const spec = cells.gridSpec;
    const centerRow = Math.round((unit.lat - spec.latitudeStart) / spec.stepDegrees);
    const centerCol = Math.round((unit.lon - spec.longitudeStart) / spec.stepDegrees);
    for (let dr = -2; dr <= 2; dr += 1) {
      const row = centerRow + dr;
      if (row < 0 || row >= spec.rows) continue;
      for (let dc = -2; dc <= 2; dc += 1) {
        const col = (centerCol + dc + spec.cols) % spec.cols;
        const cell = cells.gridCells[row * spec.cols + col];
        if (!cell || !Number.isFinite(cell.sst)) continue;
        const dLat = cell.lat - unit.lat;
        const dLon = wrappedLonDifference(cell.lon, unit.lon) * Math.cos((unit.lat * Math.PI) / 180);
        const score = dLat * dLat + dLon * dLon;
        if (score < bestScore) { best = cell; bestScore = score; }
      }
    }
    return bestScore <= 20 ? best : null;
  }
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
  const hitIndex = hit?.instanceId ?? hit?.faceIndex;
  if (hit && Number.isInteger(hitIndex) && state.faceCells[hitIndex]) {
    const cell = state.faceCells[hitIndex];
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
  const warmY = yForNino(ENSO_THRESHOLD, plot);
  const coolY = yForNino(-ENSO_THRESHOLD, plot);
  ninoCtx.fillStyle = "rgba(190,68,49,0.13)";
  ninoCtx.fillRect(plot.left, plot.top, plot.width, warmY - plot.top);
  ninoCtx.fillStyle = "rgba(54,99,162,0.15)";
  ninoCtx.fillRect(plot.left, coolY, plot.width, plot.bottom - coolY);
  ninoCtx.setLineDash([4, 4]);
  ninoCtx.strokeStyle = "rgba(225,116,91,0.8)";
  ninoCtx.beginPath(); ninoCtx.moveTo(plot.left, warmY); ninoCtx.lineTo(plot.right, warmY); ninoCtx.stroke();
  ninoCtx.strokeStyle = "rgba(111,155,221,0.85)";
  ninoCtx.beginPath(); ninoCtx.moveTo(plot.left, coolY); ninoCtx.lineTo(plot.right, coolY); ninoCtx.stroke();
  ninoCtx.setLineDash([]);
  ninoCtx.font = "10px system-ui, sans-serif";
  ninoCtx.textAlign = "left";
  ninoCtx.fillStyle = "rgba(235,144,122,0.9)";
  ninoCtx.fillText("EL NIÑO +0.5", plot.left + 5, warmY - 5);
  ninoCtx.fillStyle = "rgba(139,177,232,0.95)";
  ninoCtx.fillText("LA NIÑA -0.5", plot.left + 5, coolY + 13);
  const zeroY = yForNino(0, plot);
  ninoCtx.strokeStyle = "rgba(255,255,255,0.45)";
  ninoCtx.beginPath();
  ninoCtx.moveTo(plot.left, zeroY);
  ninoCtx.lineTo(plot.right, zeroY);
  ninoCtx.stroke();
  ninoCtx.beginPath();
  state.nino.forEach((point, index) => {
    const x = xForIndex(index, plot);
    const y = yForNino(point.rolling, plot);
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
  drawMiniLabels(ninoCtx, plot, "1982", "2025", "Niño 3.4 anomaly");
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

function ensoEpisodes() {
  const episodes = [];
  let start = 0;
  while (start < state.nino.length) {
    const phase = state.nino[start].phase;
    let end = start + 1;
    while (end < state.nino.length && state.nino[end].phase === phase) end += 1;
    if (phase !== "Neutral") {
      episodes.push({
        phase,
        start: start / Math.max(1, state.nino.length - 1),
        end: (end - 1) / Math.max(1, state.nino.length - 1),
      });
    }
    start = end;
  }
  return episodes;
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
  return parsePackedFrame(currentFrameDate());
}

function makeFrameDates() {
  const dates = [];
  for (let year = 1982; year <= 2025; year += 1) {
    for (let month = 1; month <= 12; month += 1) dates.push(`${year}-${String(month).padStart(2, "0")}-01`);
  }
  return dates;
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
  return new THREE.Color(rgb(interpolateStops([[0, [0, 8, 255]], [0.2, [0, 64, 255]], [0.4, [0, 210, 255]], [0.58, [0, 255, 174]], [0.7, [255, 238, 0]], [0.84, [255, 92, 0]], [1, [255, 0, 22]]], t)));
}

function anomalyColor(t) {
  return new THREE.Color(rgb(interpolateStops([[0, [0, 22, 255]], [0.46, [0, 190, 255]], [0.5, [245, 245, 245]], [0.54, [255, 214, 0]], [1, [255, 0, 18]]], t)));
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
