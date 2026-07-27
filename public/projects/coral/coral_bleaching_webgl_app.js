(() => {
  const canvas = document.getElementById("sphere");
  const gl = canvas.getContext("webgl", {
    antialias: true,
    alpha: false,
    powerPreference: "high-performance"
  });
  const data = window.CORAL_BLEACHING_DATA;
  const ui = {
    stressOut: document.getElementById("stressOut"),
    influenceOut: document.getElementById("influenceOut"),
    recoveryOut: document.getElementById("recoveryOut"),
    toggle: document.getElementById("toggle"),
    uiToggle: document.getElementById("uiToggle"),
    dhwOut: document.getElementById("dhwOut"),
    visibleChip: document.getElementById("visibleChip")
  };

  if (!gl || !data) {
    document.body.innerHTML = "<main><section class='stage'><div class='chip'><strong>WebGL is not available.</strong></div></section></main>";
    throw new Error("WebGL renderer could not start");
  }

  const TAU = Math.PI * 2;
  // NOAA CRW thresholds remain the semantic markers, but the visual response is
  // continuous so bleaching does not pause between alert bands.
  // Interaction changes SST anomaly first; HotSpot and DHW are derived from it.
  const SIM_DAYS_PER_SECOND = 8;
  const ACTIVE_SST_ANOMALY_MIN = 1.6;
  const ACTIVE_SST_ANOMALY_MAX = 2.2;
  const SST_HEATING_TAU_DAYS = 6;
  const SST_COOLING_TAU_DAYS = 112;
  const DHW_WINDOW_DAYS = 84;
  const BLEACH_ONSET_TAU_DAYS = 8;
  const COLOR_RECOVERY_TAU_DAYS = 180;
  const SEVERE_RECOVERY_TAU_DAYS = 1460;
  let lastParentUpdate = 0;
  let readySent = false;

  const vertexShaderSource = `
    attribute vec2 aPosition;
    varying vec2 vUv;

    void main() {
      vUv = aPosition * 0.5 + 0.5;
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;

    uniform vec2 uResolution;
    uniform float uTime;
    uniform float uDhw;
    uniform float uCoverage;
    uniform float uLightMode;
    uniform sampler2D uRiskMap;
    uniform vec4 uQuat;
    varying vec2 vUv;

    const float PI = 3.141592653589793;
    const float TAU = 6.283185307179586;

    float saturate(float v) {
      return clamp(v, 0.0, 1.0);
    }

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));
      return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.52;
      v += noise(p) * a; p = p * 2.08 + 11.7; a *= 0.48;
      v += noise(p) * a; p = p * 2.13 + 23.2; a *= 0.48;
      v += noise(p) * a;
      return v;
    }

    vec3 rotateByQuat(vec4 q, vec3 v) {
      return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
    }

    float sphereNoise(vec3 p, float scale, float t) {
      float a = fbm(p.xy * scale + vec2(t * 0.23, -t * 0.17));
      float b = fbm(p.yz * scale + vec2(-t * 0.13, t * 0.19));
      float c = fbm(p.zx * scale + vec2(t * 0.11, t * 0.07));
      return (a + b + c) * 0.3333333;
    }

    float cellDots(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      float nearest = 1.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 g = vec2(float(x), float(y));
          vec2 o = vec2(hash(i + g), hash(i + g + 19.37));
          vec2 r = g + o - f;
          nearest = min(nearest, dot(r, r));
        }
      }
      return sqrt(nearest);
    }

    float coralCells(vec3 p, float scale, float t) {
      float a = cellDots(p.xy * scale + vec2(t * 0.035, -t * 0.02));
      float b = cellDots(p.yz * scale + vec2(-t * 0.025, t * 0.03));
      float c = cellDots(p.zx * scale + vec2(t * 0.018, t * 0.022));
      float d = (a + b + c) * 0.3333333;
      return smoothstep(0.43, 0.08, d);
    }

    float coralDistance(vec3 p, float scale, float t) {
      float a = cellDots(p.xy * scale + vec2(t * 0.018, -t * 0.013));
      float b = cellDots(p.yz * scale + vec2(-t * 0.011, t * 0.016));
      float c = cellDots(p.zx * scale + vec2(t * 0.015, t * 0.012));
      return (a + b + c) * 0.3333333;
    }

    float swarmDots(vec3 p, float scale, float t, float drift) {
      vec3 q = p + vec3(
        sphereNoise(p, 2.2, t * 0.12) - 0.5,
        sphereNoise(p.yzx, 2.8, -t * 0.09) - 0.5,
        sphereNoise(p.zxy, 2.4, t * 0.1) - 0.5
      ) * drift;
      float a = cellDots(q.xy * scale + vec2(t * 0.08, -t * 0.05));
      float b = cellDots(q.yz * scale + vec2(-t * 0.06, t * 0.04));
      float c = cellDots(q.zx * scale + vec2(t * 0.045, t * 0.055));
      float d = min(min(a, b), c);
      return smoothstep(0.19, 0.02, d);
    }

    float riskSample(vec2 uv) {
      float a = texture2D(uRiskMap, vec2(fract(uv.x), clamp(uv.y, 0.002, 0.998))).r;
      float b = texture2D(uRiskMap, vec2(fract(uv.x + 0.018), clamp(uv.y, 0.002, 0.998))).r;
      float c = texture2D(uRiskMap, vec2(fract(uv.x - 0.018), clamp(uv.y, 0.002, 0.998))).r;
      return a * 0.7 + (b + c) * 0.15;
    }

    void main() {
      vec2 pixel = vUv * uResolution;
      vec2 center = uResolution * vec2(0.5, 0.51);
      float radius = min(uResolution.x, uResolution.y) * 0.28;
      vec2 p = (pixel - center) / radius;
      p.y *= -1.0;
      float d = dot(p, p);

      vec3 bg = vec3(uLightMode);

      if (d > 1.0) {
        float halo = exp(-abs(sqrt(d) - 1.0) * 18.0) * 0.035;
        gl_FragColor = vec4(bg + vec3(halo * (1.0 - uLightMode)) - vec3(halo * uLightMode * 2.2), 1.0);
        return;
      }

      float z = sqrt(1.0 - d);
      vec3 view = vec3(p.x, p.y, z);
      vec3 world = normalize(rotateByQuat(uQuat, view));
      float lon = atan(world.x, world.z);
      float lat = asin(clamp(world.y, -1.0, 1.0));
      vec2 geoUv = vec2(fract(lon / TAU + 0.5), lat / PI + 0.5);

      float nLow = sphereNoise(world, 1.8, uTime * 0.22);
      float nMid = sphereNoise(world, 5.0, -uTime * 0.18);
      float nFine = sphereNoise(world, 18.0, uTime * 0.1);
      float fieldA = sphereNoise(world + vec3(0.18, -0.11, 0.07), 3.1, uTime * 0.18);
      float fieldB = sphereNoise(world + vec3(-0.24, 0.13, 0.19), 8.5, -uTime * 0.14);
      float waveWarp = (fieldA - 0.5) * 1.25 + (fieldB - 0.5) * 0.55 + nLow * 0.25;
      float waveA = 0.5 + 0.5 * sin(dot(world, normalize(vec3(1.3, 2.1, -0.8))) * 4.6 + waveWarp * 1.35 + uTime * 0.08);
      float waveB = 0.5 + 0.5 * sin(dot(world, normalize(vec3(-1.7, 1.1, 1.4))) * 5.2 + fieldA * 1.9 - uTime * 0.055);
      float waveC = 0.5 + 0.5 * sin((world.x - world.y + world.z * 0.7) * 5.6 + fieldB * 2.2 + uTime * 0.04);
      waveA = smoothstep(0.14, 0.86, waveA);
      waveB = smoothstep(0.1, 0.84, waveB);
      waveC = smoothstep(0.12, 0.86, waveC);
      float ribbon = saturate(waveA * 0.52 + waveB * 0.36 + waveC * 0.24);
      float cloud = smoothstep(0.24, 0.86, sphereNoise(world + waveWarp * 0.06, 4.7, uTime * 0.035));
      float warmRibbon = smoothstep(0.48, 0.92, ribbon);
      float roseRibbon = smoothstep(0.22, 0.76, 1.0 - abs(waveA - waveB));
      float amberLift = smoothstep(0.58, 0.98, waveB * 0.7 + cloud * 0.35);
      float softDetail = sphereNoise(world + vec3(0.11, -0.07, 0.19), 11.0, -uTime * 0.035);
      float gradientField = saturate(ribbon * 0.62 + cloud * 0.32 + softDetail * 0.16);
      float waterFilm = smoothstep(0.0, 1.0, pow(1.0 - z * 0.82, 0.66));
      float waterFlow = sphereNoise(world + vec3(0.04, 0.18, -0.12), 3.2, uTime * 0.18);
      float waterMarble = sphereNoise(world + vec3(-0.08, 0.16, 0.21), 6.2, -uTime * 0.13);
      float waveDrift = sphereNoise(world + vec3(waterFlow * 0.2, -waterMarble * 0.14, waterFlow * 0.1), 2.2, uTime * 0.1);
      float travellingA = sphereNoise(world + vec3(uTime * 0.045, -uTime * 0.022, waterFlow * 0.15), 7.2, uTime * 0.24);
      float travellingB = sphereNoise(world.yzx + vec3(-uTime * 0.034, waterMarble * 0.14, uTime * 0.025), 10.4, -uTime * 0.2);
      float warpedWaveA = 0.5 + 0.5 * sin((world.y * 1.35 + world.x * 0.55 - world.z * 0.18 + waveDrift * 1.9) * 13.0 + uTime * 0.58);
      float warpedWaveB = 0.5 + 0.5 * sin((world.x * -0.38 + world.y * 1.1 + world.z * 0.42 + travellingB * 1.4) * 9.5 - uTime * 0.43);
      float waveBand = smoothstep(0.46, 0.74, travellingA + waveDrift * 0.34);
      float brokenLines = smoothstep(0.72, 0.96, warpedWaveA) * smoothstep(0.18, 0.92, travellingB);
      float passingSheets = smoothstep(0.62, 0.9, warpedWaveB + waterMarble * 0.28);
      float shimmer = smoothstep(0.5, 0.86, travellingB) * smoothstep(0.18, 0.82, waterMarble);
      float caustic = saturate(waveBand * 0.38 + brokenLines * 0.5 + passingSheets * 0.28 + shimmer * 0.22) * (0.28 + z * 0.72);
      float polypDist = coralDistance(world + (fieldA - 0.5) * 0.04, 23.0, uTime * 0.2);
      float polypRing = smoothstep(0.1, 0.21, polypDist) * (1.0 - smoothstep(0.23, 0.39, polypDist));
      float polypCup = smoothstep(0.15, 0.04, polypDist);
      float reefMottle = smoothstep(0.3, 0.76, sphereNoise(world + vec3(-0.19, 0.27, 0.08), 12.0, -uTime * 0.04));
      float reefChannel = smoothstep(0.44, 0.64, sphereNoise(world + vec3(0.22, -0.31, 0.14), 17.0, uTime * 0.03));
      reefChannel *= 1.0 - smoothstep(0.66, 0.84, sphereNoise(world + vec3(0.22, -0.31, 0.14), 17.0, uTime * 0.03));
      float coralGrain = saturate(polypRing * 0.44 + reefMottle * 0.25 + reefChannel * 0.28 + nFine * 0.1);

      vec3 coralPink = vec3(1.0, 0.24, 0.48);
      vec3 coralOrange = vec3(1.0, 0.42, 0.30);
      vec3 salmon = vec3(1.0, 0.62, 0.52);
      vec3 coralGold = vec3(1.0, 0.64, 0.34);
      vec3 deepCoral = vec3(0.96, 0.18, 0.34);
      vec3 bleachWhite = vec3(0.99, 0.98, 0.94);
      vec3 bleachGray = vec3(0.90, 0.89, 0.84);

      float flow = saturate(gradientField * 0.76 + nMid * 0.16 + fieldA * 0.12);
      vec3 color = mix(coralPink, coralOrange, flow);
      color = mix(color, salmon, saturate(warmRibbon * 0.42 + cloud * 0.14));
      color = mix(color, coralGold, saturate(amberLift * 0.09 + softDetail * 0.015));
      color = mix(color, vec3(1.0, 0.18, 0.44), roseRibbon * 0.24);
      color += vec3(1.0, 0.20, 0.24) * waveC * 0.06;
      color = mix(color, vec3(1.0, 0.36, 0.34), polypRing * 0.14);
      color = mix(color, deepCoral, polypCup * 0.08);
      color = mix(color, vec3(1.0, 0.31, 0.31), reefChannel * 0.075);
      color *= 0.86 + gradientField * 0.28 + nLow * 0.045;
      color *= 0.94 + coralGrain * 0.11 - polypCup * 0.06;
      color = mix(color, vec3(0.06, 0.48, 0.58), waterFilm * (0.34 + waterMarble * 0.08));
      color += vec3(0.12, 0.74, 0.86) * caustic * 0.2;
      color += vec3(0.03, 0.20, 0.24) * waterFlow * waterFilm * 0.08;

      float geoRisk = riskSample(geoUv);
      float tropical = smoothstep(0.58, 0.08, abs(lat) / (PI * 0.5));
      float localRisk = saturate(
        pow(geoRisk, 0.74) * 0.72 +
        tropical * 0.06 +
        nLow * 0.08 +
        nMid * 0.07 +
        cloud * 0.05
      );
      float patchNoise = sphereNoise(world + vec3(0.41, -0.23, 0.17), 6.8, -uTime * 0.025);
      float fineBreakup = sphereNoise(world + vec3(-0.17, 0.29, -0.31), 15.0, uTime * 0.018);
      float localSensitivity = mix(0.72, 1.24, localRisk);
      float effectiveDhw = uDhw * localSensitivity;
      float dhwNorm = saturate((effectiveDhw - 1.2) / 22.8);
      float thermalProbability = smoothstep(0.0, 1.0, pow(dhwNorm, 0.78));
      thermalProbability = max(thermalProbability, smoothstep(0.0, 1.0, uCoverage) * 0.9);
      float bleachRank = saturate(localRisk * 0.66 + patchNoise * 0.25 + fineBreakup * 0.09);
      float expansionCut = mix(1.03, -0.08, thermalProbability);
      float bleachEdge = mix(0.045, 0.17, thermalProbability);
      float bleached = smoothstep(expansionCut - bleachEdge, expansionCut + bleachEdge, bleachRank);
      bleached = smoothstep(0.08, 0.92, bleached);
      bleached *= mix(0.52, 1.0, thermalProbability);
      float edge = bleached * (1.0 - bleached) * 4.0;

      float chalk = sphereNoise(world + vec3(0.07, -0.13, 0.21), 22.0, -uTime * 0.025);
      float grayVein = smoothstep(0.54, 0.86, sphereNoise(world + vec3(-0.23, 0.09, 0.14), 11.0, uTime * 0.018));
      float chalkSpeckle = smoothstep(0.62, 0.9, nFine) * (0.55 + chalk * 0.45);
      vec3 chalkBase = mix(bleachWhite, bleachGray, saturate(grayVein * 0.055 + (1.0 - chalk) * 0.035));
      chalkBase += vec3(0.035) * chalkSpeckle;
      chalkBase = mix(chalkBase, vec3(0.93, 0.91, 0.86), polypCup * bleached * 0.1);
      color = mix(color, chalkBase, bleached * 0.98);
      color = mix(color, bleachWhite, bleached * chalkSpeckle * 0.06);

      vec3 lightDir = normalize(vec3(-0.42, 0.45, 0.78));
      float lambert = saturate(dot(normalize(view + vec3((nMid - 0.5) * 0.025, (nFine - 0.5) * 0.018, 0.0)), lightDir));
      float rim = pow(1.0 - z, 1.65);
      float living = 1.0 - bleached;
      float spec = pow(saturate(lambert + cloud * 0.04), 10.0) * (0.055 + living * 0.045);
      spec *= living;
      float shade = 0.7 + lambert * 0.2 + gradientField * 0.11;
      shade *= mix(0.9, 1.0, living);
      color *= shade;
      color += vec3(1.0, 0.62, 0.48) * spec;
      color += vec3(1.0, 0.42, 0.34) * warmRibbon * living * 0.065;
      color += vec3(1.0, 0.66, 0.34) * amberLift * living * 0.055;
      color += vec3(1.0, 0.55, 0.42) * polypRing * living * 0.045;
      color += vec3(1.0, 0.46, 0.36) * reefChannel * living * 0.035;
      color -= vec3(0.12, 0.045, 0.035) * polypCup * living * 0.12;
      color += vec3(0.48, 0.45, 0.40) * edge * bleached * 0.055;
      color += vec3(0.36, 0.9, 1.0) * caustic * waterFilm * 0.16;
      color += vec3(0.02, 0.22, 0.28) * passingSheets * waterFilm * 0.07;
      color += vec3(1.0, 0.54, 0.48) * rim * 0.08 * living;
      color += vec3(0.12, 0.48, 0.56) * rim * (0.08 + waterFlow * 0.04);
      color += vec3(0.55, 0.86, 0.9) * pow(1.0 - z, 5.2) * 0.08;
      color *= 1.0 - d * 0.018;

      gl_FragColor = vec4(pow(color, vec3(0.92)), 1.0);
    }
  `;

  let running = true;
  let frame = 0;
  let program = null;
  let locations = null;
  let riskTexture = null;
  let orientationQuat = null;
  let isDragging = false;
  let dragStart = null;
  let pointerInside = false;
  let touchInfluence = false;
  let lightMode = 0;
  let lastTime = 0;
  const sim = {
    sstAnomaly: 0,
    hotSpot: 0,
    dhw: 0,
    coverage: 0,
    influenceSeconds: 0,
    maxDhwMemory: 0,
    activeSstTarget: 0
  };

  function mix(a, b, p) {
    return a + (b - a) * p;
  }

  function clamp01(v) {
    return Math.max(0, Math.min(1, v));
  }

  function smoothstep(edge0, edge1, x) {
    const t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }

  function fract(v) {
    return v - Math.floor(v);
  }

  function hash2(x, y) {
    return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
  }

  function quatNormalize(q) {
    const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
    return [q[0] / len, q[1] / len, q[2] / len, q[3] / len];
  }

  function quatMultiply(a, b) {
    return [
      a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
      a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
      a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
      a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]
    ];
  }

  function quatFromAxisAngle(x, y, z, angle) {
    const half = angle * 0.5;
    const s = Math.sin(half);
    return quatNormalize([x * s, y * s, z * s, Math.cos(half)]);
  }

  function quatFromTo(from, to) {
    const dot = from[0] * to[0] + from[1] * to[1] + from[2] * to[2];
    if (dot > 0.9999) return [0, 0, 0, 1];
    if (dot < -0.9999) {
      const axis = Math.abs(from[0]) < 0.8 ? [0, -from[2], from[1]] : [-from[1], from[0], 0];
      const len = Math.hypot(axis[0], axis[1], axis[2]) || 1;
      return [axis[0] / len, axis[1] / len, axis[2] / len, 0];
    }
    const cross = [
      from[1] * to[2] - from[2] * to[1],
      from[2] * to[0] - from[0] * to[2],
      from[0] * to[1] - from[1] * to[0]
    ];
    return quatNormalize([cross[0], cross[1], cross[2], 1 + dot]);
  }

  function inverseQuat(q) {
    return [-q[0], -q[1], -q[2], q[3]];
  }

  function quatFromYawPitch(yaw, pitch) {
    const yawQuat = quatFromAxisAngle(0, 1, 0, yaw);
    const pitchQuat = quatFromAxisAngle(1, 0, 0, pitch);
    return quatNormalize(quatMultiply(yawQuat, pitchQuat));
  }

  function metrics() {
    const r = Math.min(canvas.width, canvas.height) * 0.28;
    return { cx: canvas.width * 0.5, cy: canvas.height * 0.51, r };
  }

  function pointerToTrackball(event) {
    const rect = canvas.getBoundingClientRect();
    const { cx, cy, r } = metrics();
    let x = ((event.clientX - rect.left) * (canvas.width / rect.width) - cx) / r;
    let y = (cy - (event.clientY - rect.top) * (canvas.height / rect.height)) / r;
    const d = x * x + y * y;
    if (d > 1) {
      const len = Math.sqrt(d);
      x /= len;
      y /= len;
      return [x, y, 0];
    }
    return [x, y, Math.sqrt(1 - d)];
  }

  function pointerIsOnSphere(event) {
    const rect = canvas.getBoundingClientRect();
    const { cx, cy, r } = metrics();
    const x = ((event.clientX - rect.left) * (canvas.width / rect.width) - cx) / r;
    const y = (cy - (event.clientY - rect.top) * (canvas.height / rect.height)) / r;
    return x * x + y * y <= 1;
  }

  function buildRiskPixels(points) {
    const cols = 512;
    const rows = 256;
    const values = new Float32Array(cols * rows);

    for (const p of points) {
      const col = Math.max(0, Math.min(cols - 1, Math.floor(((p.lon + 180) / 360) * cols)));
      const row = Math.max(0, Math.min(rows - 1, Math.floor(((90 - p.lat) / 180) * rows)));
      const severity = p.known ? p.p / 100 : 0.34;
      const recency = 0.74 + smoothstep(data.metadata.yearMin, data.metadata.yearMax, p.year) * 0.26;
      const radius = p.known ? 13 : 8;

      for (let yy = -radius; yy <= radius; yy++) {
        for (let xx = -radius; xx <= radius; xx++) {
          const x = (col + xx + cols) % cols;
          const y = Math.max(0, Math.min(rows - 1, row + yy));
          const smear = 0.55 + hash2(col * 1.7, row * 2.1) * 0.65;
          const dist = Math.hypot(xx * smear, yy * (1.28 - smear * 0.28));
          const soft = Math.max(0, 1 - dist / (radius + 1.8));
          const w = soft * soft * (3 - 2 * soft);
          values[y * cols + x] += (0.12 + severity * 0.88) * recency * w;
        }
      }
    }

    let max = 0;
    for (let i = 0; i < values.length; i++) max = Math.max(max, values[i]);
    const pixels = new Uint8Array(cols * rows * 4);
    for (let i = 0; i < values.length; i++) {
      const v = max ? Math.pow(values[i] / max, 0.72) : 0;
      const b = Math.max(0, Math.min(255, Math.round(v * 255)));
      pixels[i * 4] = b;
      pixels[i * 4 + 1] = b;
      pixels[i * 4 + 2] = b;
      pixels[i * 4 + 3] = 255;
    }
    return { cols, rows, pixels };
  }

  function responseFromDhw(dhw) {
    const value = Math.max(0, dhw);
    const normalized = clamp01((value - 1.2) / 22.8);
    return smoothstep(0, 1, Math.pow(normalized, 0.78));
  }

  function alertFromDhw(dhw, hotSpot = 0) {
    if (hotSpot <= 0 && dhw <= 0) return "No stress";
    if (hotSpot > 0 && hotSpot < 1) return "Watch";
    if (hotSpot >= 1 && dhw < 4) return "Warning";
    if (dhw < 4) return "Watch";
    if (dhw < 8) return "AL1";
    if (dhw < 12) return "AL2";
    if (dhw < 16) return "AL3";
    if (dhw < 20) return "AL4";
    return "AL5";
  }

  function bleachingState(dhw, coverage = responseFromDhw(dhw)) {
    return {
      coverage: clamp01(coverage),
      alert: alertFromDhw(dhw, sim.hotSpot)
    };
  }

  function updateUi(state) {
    const dhw = sim.dhw;
    const active = pointerInside || touchInfluence;
    const recovery = sim.coverage < 0.01
      ? "stable"
      : (active ? "stressed" : "restoring");
    ui.stressOut.textContent = `+${sim.sstAnomaly.toFixed(1)}°C`;
    ui.visibleChip.textContent = `${Math.round(state.coverage * 100)}%`;
    ui.dhwOut.textContent = `${state.alert} · ${dhw.toFixed(1)} DHW`;
    ui.influenceOut.textContent = active
      ? `${sim.influenceSeconds.toFixed(1)}s`
      : "idle";
    ui.recoveryOut.textContent = recovery;
    const now = performance.now();
    if (window.parent !== window && now - lastParentUpdate > 100) {
      lastParentUpdate = now;
      window.parent.postMessage({
        type: "CORAL_STATUS",
        anomaly: sim.sstAnomaly,
        dhw,
        coverage: state.coverage,
        alert: state.alert,
        influence: sim.influenceSeconds,
        recovery,
        active,
      }, window.location.origin);
    }
  }

  function updateSimulation(dt) {
    const active = pointerInside || touchInfluence;
    const simDays = dt * SIM_DAYS_PER_SECOND;

    if (active) {
      sim.influenceSeconds += dt;
      const sustained = smoothstep(0, 18, sim.influenceSeconds);
      sim.activeSstTarget = mix(ACTIVE_SST_ANOMALY_MIN, ACTIVE_SST_ANOMALY_MAX, sustained);
    } else {
      sim.influenceSeconds = 0;
      sim.activeSstTarget = 0;
    }

    const sstTau = active ? SST_HEATING_TAU_DAYS : SST_COOLING_TAU_DAYS;
    const sstResponse = 1 - Math.exp(-simDays / sstTau);
    sim.sstAnomaly += (sim.activeSstTarget - sim.sstAnomaly) * sstResponse;
    if (sim.sstAnomaly < 0.01 && !active) sim.sstAnomaly = 0;

    sim.hotSpot = Math.max(0, sim.sstAnomaly);
    sim.dhw *= Math.exp(-simDays / DHW_WINDOW_DAYS);
    if (sim.hotSpot >= 1) {
      sim.dhw += (sim.hotSpot / 7) * simDays;
    }
    if (sim.dhw < 0.02 && sim.hotSpot < 1) sim.dhw = 0;
    sim.dhw = Math.min(24, sim.dhw);
    sim.maxDhwMemory = Math.max(sim.dhw, sim.maxDhwMemory * Math.exp(-simDays / (365 * 2.5)));

    const targetCoverage = responseFromDhw(sim.dhw);
    if (targetCoverage > sim.coverage) {
      const rise = 1 - Math.exp(-simDays / BLEACH_ONSET_TAU_DAYS);
      sim.coverage += (targetCoverage - sim.coverage) * rise;
    } else {
      const severeMemory = smoothstep(8, 20, sim.maxDhwMemory);
      const tau = mix(COLOR_RECOVERY_TAU_DAYS, SEVERE_RECOVERY_TAU_DAYS, severeMemory);
      const recovery = 1 - Math.exp(-simDays / tau);
      sim.coverage += (targetCoverage - sim.coverage) * recovery;
      if (sim.coverage < 0.005 && sim.dhw === 0) sim.coverage = 0;
    }
  }

  function applyContactPulse() {
    sim.influenceSeconds = Math.max(sim.influenceSeconds, 4);
    sim.sstAnomaly = Math.max(sim.sstAnomaly, 1.25);
    sim.hotSpot = Math.max(sim.hotSpot, sim.sstAnomaly);
    sim.dhw = Math.max(sim.dhw, 4.2);
    sim.coverage = Math.max(sim.coverage, 0.12);
    sim.maxDhwMemory = Math.max(sim.maxDhwMemory, sim.dhw);
  }

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const message = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(message);
    }
    return shader;
  }

  function createProgram() {
    const vs = compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fs = compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
    const linked = gl.createProgram();
    gl.attachShader(linked, vs);
    gl.attachShader(linked, fs);
    gl.linkProgram(linked);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(linked);
      gl.deleteProgram(linked);
      throw new Error(message);
    }
    return linked;
  }

  function uploadRiskTexture() {
    const risk = buildRiskPixels(data.points);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, risk.cols, risk.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, risk.pixels);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(680, Math.floor(rect.width * dpr));
    const height = Math.max(520, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render(time = 0) {
    const seconds = time * 0.001;
    const dt = lastTime ? Math.min(0.08, Math.max(0, seconds - lastTime)) : 0;
    lastTime = seconds;
    updateSimulation(dt);
    if (running) frame = time * 0.06;
    const state = bleachingState(sim.dhw, sim.coverage);
    const autoQuat = running
      ? quatFromAxisAngle(0, 1, 0, (frame * 0.018 * Math.PI) / 180)
      : [0, 0, 0, 1];
    const viewQuat = quatNormalize(quatMultiply(autoQuat, orientationQuat));
    const shaderQuat = inverseQuat(viewQuat);

    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, riskTexture);
    gl.uniform1i(locations.riskMap, 0);
    gl.uniform2f(locations.resolution, canvas.width, canvas.height);
    gl.uniform1f(locations.time, time * 0.001);
    gl.uniform1f(locations.dhw, sim.dhw);
    gl.uniform1f(locations.coverage, state.coverage);
    gl.uniform1f(locations.lightMode, lightMode);
    gl.uniform4f(locations.quat, shaderQuat[0], shaderQuat[1], shaderQuat[2], shaderQuat[3]);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    if (!readySent && window.parent !== window) {
      readySent = true;
      window.parent.postMessage({ type: "ARTWORK_READY" }, window.location.origin);
    }

    updateUi(state);
    requestAnimationFrame(render);
  }

  canvas.addEventListener("pointerdown", (event) => {
    pointerInside = pointerIsOnSphere(event);
    touchInfluence = event.pointerType !== "mouse" && pointerInside;
    if (pointerInside) applyContactPulse();
    if (running) {
      const autoQuat = quatFromAxisAngle(0, 1, 0, (frame * 0.018 * Math.PI) / 180);
      orientationQuat = quatNormalize(quatMultiply(autoQuat, orientationQuat));
      frame = 0;
    }
    isDragging = true;
    dragStart = {
      vector: pointerToTrackball(event),
      orientation: orientationQuat.slice(),
      resume: running
    };
    running = false;
    ui.toggle.textContent = "Resume rotation";
    canvas.style.cursor = "grabbing";
    canvas.setPointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointermove", (event) => {
    pointerInside = pointerIsOnSphere(event);
    if (!isDragging || !dragStart) return;
    const current = pointerToTrackball(event);
    const delta = quatFromTo(dragStart.vector, current);
    orientationQuat = quatNormalize(quatMultiply(delta, dragStart.orientation));
  });

  canvas.addEventListener("pointerup", (event) => {
    const resume = dragStart?.resume ?? true;
    isDragging = false;
    dragStart = null;
    running = resume;
    ui.toggle.textContent = running ? "Pause rotation" : "Resume rotation";
    touchInfluence = false;
    pointerInside = event.pointerType === "mouse" && pointerIsOnSphere(event);
    canvas.style.cursor = "grab";
    canvas.releasePointerCapture(event.pointerId);
  });

  canvas.addEventListener("pointercancel", () => {
    const resume = dragStart?.resume ?? true;
    isDragging = false;
    dragStart = null;
    running = resume;
    ui.toggle.textContent = running ? "Pause rotation" : "Resume rotation";
    touchInfluence = false;
    pointerInside = false;
    canvas.style.cursor = "grab";
  });

  canvas.addEventListener("pointerleave", () => {
    pointerInside = false;
  });

  ui.toggle.addEventListener("click", () => {
    running = !running;
    ui.toggle.textContent = running ? "Pause rotation" : "Resume rotation";
  });

  ui.uiToggle.addEventListener("click", () => {
    const hidden = document.body.classList.toggle("ui-hidden");
    ui.uiToggle.textContent = hidden ? "Show UI" : "Hide UI";
    ui.uiToggle.setAttribute("aria-pressed", hidden ? "true" : "false");
  });

  window.addEventListener("message", (event) => {
    if (event.origin !== window.location.origin || !event.data) return;
    if (event.data.type === "KI_THEME") {
      lightMode = event.data.theme === "light" ? 1 : 0;
      document.documentElement.dataset.theme = lightMode ? "light" : "dark";
      document.documentElement.style.colorScheme = lightMode ? "light" : "dark";
      return;
    }
    if (event.data.type === "CORAL_EMBED") {
      document.body.classList.add("ui-hidden");
      ui.uiToggle.textContent = "Show UI";
      ui.uiToggle.setAttribute("aria-pressed", "true");
    }
    if (event.data.type === "CORAL_TOUCH") {
      const active = Boolean(event.data.active);
      touchInfluence = active;
      pointerInside = active;
      if (active) applyContactPulse();
    }
  });

  function init() {
    canvas.style.cursor = "grab";
    orientationQuat = quatFromAxisAngle(0, 1, 0, 80 * Math.PI / 180);
    program = createProgram();
    locations = {
      position: gl.getAttribLocation(program, "aPosition"),
      resolution: gl.getUniformLocation(program, "uResolution"),
      time: gl.getUniformLocation(program, "uTime"),
      dhw: gl.getUniformLocation(program, "uDhw"),
      coverage: gl.getUniformLocation(program, "uCoverage"),
      lightMode: gl.getUniformLocation(program, "uLightMode"),
      riskMap: gl.getUniformLocation(program, "uRiskMap"),
      quat: gl.getUniformLocation(program, "uQuat")
    };

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 1, -1, -1, 1,
      -1, 1, 1, -1, 1, 1
    ]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 2, gl.FLOAT, false, 0, 0);

    riskTexture = uploadRiskTexture();
    resize();
    requestAnimationFrame(render);
  }

  window.addEventListener("resize", resize);
  init();
})();
