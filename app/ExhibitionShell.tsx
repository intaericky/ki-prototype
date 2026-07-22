"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { estimateMenu, type MenuEstimate } from "../lib/carbon";
import { TOKEN_COLORS } from "../lib/token-colors";

type ProjectId = "ocean" | "daisy" | "coral" | "food";
type OceanVariable = "sst" | "anom";
type MealId = "breakfast" | "lunch" | "dinner";

type Project = {
  id: ProjectId;
  number: string;
  ko: string;
  en: string;
  maker: string;
  description: string;
  dataset: string;
  interaction: string;
};

const PROJECTS: Project[] = [
  {
    id: "ocean",
    number: "01",
    ko: "해양의 진동",
    en: "ENSO",
    maker: "황인태",
    description:
      "〈ENSO〉는 NOAA 해수면 온도 자료를 구형 디스플레이 위에 펼쳐, 적도 태평양의 온도 변화가 행성 규모의 진동으로 이어지는 과정을 보여준다. 월별 해수면 온도와 평년 편차를 오가며 엘니뇨와 라니냐가 어느 한 지점의 사건이 아니라 연결된 해양 시스템의 움직임임을 관찰한다.",
    dataset: "NOAA NCEI OISST v2.1 · 0.25° daily grid · exhibition subset sampled at 2°",
    interaction: "월별 타임라인을 이동하고, 해수면 온도와 평년 편차 레이어를 전환한다.",
  },
  {
    id: "daisy",
    number: "02",
    ko: "데이지월드",
    en: "Daisy World",
    maker: "정진",
    description:
      "〈데이지월드〉는 가이아 가설의 ‘데이지월드 모델’을 바탕으로 생명체와 환경이 상호작용하며 행성의 온도를 조절하는 메커니즘을 시각화한다. 관람객은 생명 활동이 지구의 항상성을 지켜내는 과정과, 온실가스 증가로 그 균형이 무너지는 임계점을 감각적으로 마주한다.",
    dataset: "Daisyworld model simulation · video prototype",
    interaction: "iPad에서 영상을 재생·정지하거나 원하는 시점으로 이동한다.",
  },
  {
    id: "coral",
    number: "03",
    ko: "산호 백화",
    en: "Coral Bleaching",
    maker: "서민혁",
    description:
      "해양 표면 온도에 따른 산호의 백화 현상을 시각화한 인터랙티브 데이터 작업이다. 구 전체는 지구상의 산호 전체를 은유한다. 인간의 터치가 구의 온도 상승에 기여하여 산호빛 구가 하얗게 물드는 장면을 보여준다. 적극적으로 백화를 가속할 수도, 개입하지 않고 관망할 수도 있다.",
    dataset: "NOAA regional coral bleaching records · DHW risk levels · coral recovery rate",
    interaction: "터치 패드를 누르는 동안 수온과 DHW가 상승해 백화가 진행되고, 손을 떼면 천천히 회복한다.",
  },
  {
    id: "food",
    number: "04",
    ko: "한 끼의 무게",
    en: "The Weight of a Meal",
    maker: "황인태",
    description:
      "〈한 끼의 무게〉는 KAIST 교내 식당 메뉴를 탄소 데이터로 번역한다. 메뉴의 주요 식재료군과 대표 제공량별 배출계수를 바탕으로 예상 배출량을 계산하고, 서로 다른 색과 부피의 토큰으로 구 안에 쌓는다. 바깥 구는 한 사람의 하루 탄소예산 5.5 kg CO₂e를 나타낸다.",
    dataset: "KAIST official cafeteria menus · 18 food-group portion emission factors · 5.5 kg CO₂e daily budget",
    interaction: "날짜·식당·끼니를 바꾸며 탄소 토큰의 구성과 하루 예산에서 차지하는 비율을 비교한다.",
  },
];

const OCEAN_DATES = Array.from({ length: 12 }, (_, index) => `2025-${String(index + 1).padStart(2, "0")}-01`);
const MONTH_LABELS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

type OceanCell = { lat: number; lon: number; sst: number; anom: number };
type Cafeteria = {
  code: string;
  short: string;
  name: string;
  status: string;
  meals: Record<MealId, { time: string; lines: string[] }>;
};

type SceneApi = {
  sphere: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  foodGroup: THREE.Group;
  oceanTexture: THREE.CanvasTexture;
  coralTexture: THREE.CanvasTexture;
  videoTexture: THREE.VideoTexture;
  coralCanvas: HTMLCanvasElement;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function oceanColor(value: number, variable: OceanVariable) {
  const stops = variable === "sst"
    ? [[-2, "#25185f"], [5, "#194a92"], [13, "#168eaa"], [21, "#56c99d"], [27, "#f2cc4d"], [32, "#e8472f"]] as const
    : [[-4, "#30216d"], [-2, "#2865aa"], [0, "#d9d9d2"], [2, "#e99345"], [4, "#bd2f39"]] as const;
  const n = clamp(value, stops[0][0], stops[stops.length - 1][0]);
  let index = 0;
  while (index < stops.length - 2 && n > stops[index + 1][0]) index += 1;
  const a = stops[index];
  const b = stops[index + 1];
  const t = (n - a[0]) / (b[0] - a[0]);
  const ca = new THREE.Color(a[1]);
  const cb = new THREE.Color(b[1]);
  return `#${ca.lerp(cb, t).getHexString()}`;
}

function drawOcean(canvas: HTMLCanvasElement, cells: OceanCell[], variable: OceanVariable) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#060606";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const w = Math.ceil(canvas.width / 180);
  const h = Math.ceil(canvas.height / 90);
  for (const cell of cells) {
    const value = cell[variable];
    if (!Number.isFinite(value)) continue;
    const x = ((cell.lon + 180) / 360) * canvas.width;
    const y = ((90 - cell.lat) / 180) * canvas.height;
    ctx.fillStyle = oceanColor(value, variable);
    ctx.fillRect(x - w / 2, y - h / 2, w + 1, h + 1);
  }
}

function drawCoral(canvas: HTMLCanvasElement, bleach: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const image = ctx.createImageData(canvas.width, canvas.height);
  const whiten = bleach / 100;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const u = x / canvas.width;
      const v = y / canvas.height;
      const reef = Math.sin(u * 33 + Math.sin(v * 19) * 2.4) + Math.cos(v * 39 - u * 11) + Math.sin((u + v) * 71) * .45;
      const pocket = clamp((reef + 2.2) / 4.4, 0, 1);
      const base = new THREE.Color().setHSL(.02 + pocket * .055, .78, .42 + pocket * .18);
      const localBleach = clamp(whiten * 1.18 + (pocket - .5) * .12, 0, 1);
      base.lerp(new THREE.Color("#f4f1e8"), localBleach);
      const i = (y * canvas.width + x) * 4;
      image.data[i] = base.r * 255;
      image.data[i + 1] = base.g * 255;
      image.data[i + 2] = base.b * 255;
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function makePerson(color: number, scale = 1) {
  const person = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: .9 });
  const skin = new THREE.MeshStandardMaterial({ color: 0xa7a39d, roughness: 1 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.14 * scale, .42 * scale, 4, 8), material);
  torso.position.y = .78 * scale;
  const head = new THREE.Mesh(new THREE.SphereGeometry(.13 * scale, 12, 8), skin);
  head.position.y = 1.23 * scale;
  person.add(torso, head);
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(.055 * scale, .42 * scale, 3, 6), material);
    leg.position.set(side * .075 * scale, .31 * scale, 0);
    leg.name = `leg${side}`;
    person.add(leg);
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(.04 * scale, .34 * scale, 3, 6), material);
    arm.position.set(side * .2 * scale, .8 * scale, 0);
    arm.rotation.z = side * -.12;
    arm.name = `arm${side}`;
    person.add(arm);
  }
  return person;
}

function todayKorea() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export default function ExhibitionShell() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sceneApi = useRef<SceneApi | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = PROJECTS[activeIndex];
  const [oceanMonth, setOceanMonth] = useState(0);
  const [oceanVariable, setOceanVariable] = useState<OceanVariable>("sst");
  const [oceanCells, setOceanCells] = useState<OceanCell[]>([]);
  const [oceanLoading, setOceanLoading] = useState(true);
  const [oceanPlaying, setOceanPlaying] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [videoProgress, setVideoProgress] = useState(0);
  const [bleach, setBleach] = useState(8);
  const [touching, setTouching] = useState(false);
  const [foodDate, setFoodDate] = useState(todayKorea);
  const [meal, setMeal] = useState<MealId>("lunch");
  const [cafeterias, setCafeterias] = useState<Cafeteria[]>([]);
  const [cafeteriaCode, setCafeteriaCode] = useState("fclt");
  const [foodLoading, setFoodLoading] = useState(true);

  const selectProject = useCallback((index: number) => {
    setActiveIndex((index + PROJECTS.length) % PROJECTS.length);
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === "ArrowRight") selectProject(activeIndex + 1);
      if (event.key === "ArrowLeft") selectProject(activeIndex - 1);
      const number = Number(event.key);
      if (number >= 1 && number <= 4) selectProject(number - 1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeIndex, selectProject]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = .85;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x060606);
    scene.fog = new THREE.FogExp2(0x060606, .026);
    const camera = new THREE.PerspectiveCamera(36, 1, .1, 80);
    camera.position.set(7.8, 4.4, 10.8);
    camera.lookAt(-.65, 2.2, 0);

    scene.add(new THREE.HemisphereLight(0xf1f0e8, 0x151515, 1.6));
    const key = new THREE.SpotLight(0xffffff, 90, 24, .48, .65, 1.3);
    key.position.set(-3, 10, 5);
    key.target.position.set(-1, 2.2, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    scene.add(key, key.target);
    const rim = new THREE.PointLight(0x8797ff, 12, 13, 2);
    rim.position.set(5, 4, -5);
    scene.add(rim);

    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a19, roughness: .96, metalness: .03 });
    const floor = new THREE.Mesh(new THREE.CircleGeometry(18, 96), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const floorRing = new THREE.Mesh(new THREE.RingGeometry(5.8, 5.83, 96), new THREE.MeshBasicMaterial({ color: 0x343431, side: THREE.DoubleSide }));
    floorRing.rotation.x = -Math.PI / 2;
    floorRing.position.y = .008;
    scene.add(floorRing);

    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(28, 10), new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 1 }));
    backWall.position.set(0, 5, -8);
    scene.add(backWall);
    for (let x = -11; x <= 11; x += 2.2) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(.018, 7.5, .03), new THREE.MeshBasicMaterial({ color: 0x232322 }));
      line.position.set(x, 4.1, -7.96);
      line.rotation.z = x * .018;
      scene.add(line);
    }

    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x171718, roughness: .5, metalness: .55 });
    const plinth = new THREE.Mesh(new THREE.TorusGeometry(2.22, .34, 20, 80), baseMaterial);
    plinth.rotation.x = Math.PI / 2;
    plinth.position.set(-1.1, .36, 0);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    scene.add(plinth);
    const innerBase = new THREE.Mesh(new THREE.CylinderGeometry(.72, .92, .2, 48), baseMaterial);
    innerBase.position.set(-1.1, .2, 0);
    scene.add(innerBase);
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(.16, .23, 1.55, 24), baseMaterial);
    stem.position.set(-1.1, 1.05, 0);
    stem.castShadow = true;
    scene.add(stem);

    const oceanCanvas = document.createElement("canvas");
    oceanCanvas.width = 720;
    oceanCanvas.height = 360;
    drawOcean(oceanCanvas, [], "sst");
    const oceanTexture = new THREE.CanvasTexture(oceanCanvas);
    oceanTexture.colorSpace = THREE.SRGBColorSpace;
    oceanTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const coralCanvas = document.createElement("canvas");
    coralCanvas.width = 360;
    coralCanvas.height = 180;
    drawCoral(coralCanvas, 8);
    const coralTexture = new THREE.CanvasTexture(coralCanvas);
    coralTexture.colorSpace = THREE.SRGBColorSpace;

    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.colorSpace = THREE.SRGBColorSpace;
    videoTexture.minFilter = THREE.LinearFilter;

    const sphereMaterial = new THREE.MeshStandardMaterial({ map: oceanTexture, roughness: .32, metalness: .02, emissive: 0x111111, emissiveIntensity: .28 });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1.52, 128, 64), sphereMaterial);
    sphere.position.set(-1.1, 3.18, 0);
    sphere.castShadow = true;
    scene.add(sphere);

    const halo = new THREE.Mesh(new THREE.SphereGeometry(1.55, 48, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: .025 }));
    halo.position.copy(sphere.position);
    scene.add(halo);

    const foodGroup = new THREE.Group();
    foodGroup.position.copy(sphere.position);
    foodGroup.visible = false;
    scene.add(foodGroup);

    const kiosk = new THREE.Group();
    const kioskStem = new THREE.Mesh(new THREE.BoxGeometry(.25, 1.5, .32), baseMaterial);
    kioskStem.position.y = .84;
    const kioskFoot = new THREE.Mesh(new THREE.CylinderGeometry(.55, .62, .12, 32), baseMaterial);
    kioskFoot.position.y = .06;
    const tablet = new THREE.Mesh(new THREE.BoxGeometry(1.12, .75, .09), new THREE.MeshStandardMaterial({ color: 0x050505, roughness: .4, metalness: .5 }));
    tablet.position.y = 1.72;
    tablet.rotation.x = -.32;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(.98, .61), new THREE.MeshBasicMaterial({ color: 0xdeddd5 }));
    screen.position.set(0, 1.72, .06);
    screen.rotation.x = -.32;
    kiosk.add(kioskStem, kioskFoot, tablet, screen);
    kiosk.position.set(2.55, 0, .7);
    kiosk.rotation.y = -.28;
    scene.add(kiosk);

    const people = [
      { person: makePerson(0x4c4d50, .9), radius: 4.8, speed: .09, phase: .2 },
      { person: makePerson(0x77736c, 1.05), radius: 5.7, speed: -.065, phase: 2.7 },
      { person: makePerson(0x30343b, .82), radius: 4.1, speed: .075, phase: 4.4 },
    ];
    people.forEach(({ person }) => {
      person.castShadow = true;
      scene.add(person);
    });

    sceneApi.current = { sphere, foodGroup, oceanTexture, coralTexture, videoTexture, coralCanvas };

    let pointerDown = false;
    let previousX = 0;
    let orbit = .62;
    const onPointerDown = (event: PointerEvent) => {
      pointerDown = true;
      previousX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!pointerDown) return;
      orbit += (event.clientX - previousX) * .004;
      previousX = event.clientX;
    };
    const onPointerUp = () => { pointerDown = false; };
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const { width, height } = parent.getBoundingClientRect();
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    resize();

    const clock = new THREE.Clock();
    let frame = 0;
    const animate = () => {
      const time = clock.getElapsedTime();
      sphere.rotation.y += .0014;
      halo.rotation.y -= .0005;
      people.forEach(({ person, radius, speed, phase }, index) => {
        const theta = phase + time * speed;
        person.position.set(-.4 + Math.cos(theta) * radius, 0, Math.sin(theta) * radius * .58);
        person.rotation.y = -theta + (speed > 0 ? 0 : Math.PI);
        const stride = Math.sin(time * 4.5 + index) * .42;
        person.children.forEach((child) => {
          if (child.name.startsWith("leg")) child.rotation.x = child.name === "leg1" ? stride : -stride;
          if (child.name.startsWith("arm")) child.rotation.x = child.name === "arm1" ? -stride : stride;
        });
      });
      const distance = 13.2;
      camera.position.x = Math.sin(orbit) * distance - .5;
      camera.position.z = Math.cos(orbit) * distance;
      camera.position.y = 4.6;
      camera.lookAt(-.75, 2.25, 0);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      renderer.dispose();
      oceanTexture.dispose();
      coralTexture.dispose();
      videoTexture.dispose();
      sceneApi.current = null;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/projects/enso/oisst-hires-${OCEAN_DATES[oceanMonth]}.csv`)
      .then((response) => {
        if (!response.ok) throw new Error("OISST frame unavailable");
        return response.text();
      })
      .then((csv) => {
        if (cancelled) return;
        const cells = csv.trim().split(/\r?\n/).map((line) => {
          const [, , lat, lon, sst, anom] = line.split(",");
          return { lat: Number(lat), lon: Number(lon), sst: Number(sst), anom: Number(anom) };
        }).filter((cell) => Number.isFinite(cell.lat) && Number.isFinite(cell.lon) && (Number.isFinite(cell.sst) || Number.isFinite(cell.anom)));
        setOceanCells(cells);
      })
      .catch(() => setOceanCells([]))
      .finally(() => { if (!cancelled) setOceanLoading(false); });
    return () => { cancelled = true; };
  }, [oceanMonth]);

  useEffect(() => {
    const api = sceneApi.current;
    if (!api) return;
    const canvas = api.oceanTexture.image as HTMLCanvasElement;
    drawOcean(canvas, oceanCells, oceanVariable);
    api.oceanTexture.needsUpdate = true;
  }, [oceanCells, oceanVariable]);

  useEffect(() => {
    if (!oceanPlaying || active.id !== "ocean") return;
    const timer = window.setInterval(() => setOceanMonth((value) => (value + 1) % 12), 1100);
    return () => window.clearInterval(timer);
  }, [oceanPlaying, active.id]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBleach((value) => clamp(value + (touching ? 1.45 : -.16), 0, 100));
    }, 50);
    return () => window.clearInterval(timer);
  }, [touching]);

  useEffect(() => {
    const api = sceneApi.current;
    if (!api) return;
    drawCoral(api.coralCanvas, bleach);
    api.coralTexture.needsUpdate = true;
  }, [bleach]);

  useEffect(() => {
    const api = sceneApi.current;
    const video = videoRef.current;
    if (!api || !video) return;
    const material = api.sphere.material;
    api.foodGroup.visible = active.id === "food";
    material.wireframe = false;
    material.transparent = false;
    material.opacity = 1;
    material.color.set(0xffffff);
    material.emissive.set(0x111111);
    material.emissiveIntensity = .28;
    if (active.id === "ocean") material.map = api.oceanTexture;
    if (active.id === "daisy") {
      material.map = api.videoTexture;
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
    if (active.id === "coral") material.map = api.coralTexture;
    if (active.id === "food") {
      material.map = null;
      material.wireframe = true;
      material.transparent = true;
      material.opacity = .22;
      material.color.set(0xe6e6df);
      material.emissive.set(0x000000);
    }
    material.needsUpdate = true;
  }, [active.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const update = () => setVideoProgress(video.duration ? (video.currentTime / video.duration) * 100 : 0);
    const onPlay = () => setVideoPlaying(true);
    const onPause = () => setVideoPlaying(false);
    video.addEventListener("timeupdate", update);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    return () => {
      video.removeEventListener("timeupdate", update);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/menu?date=${foodDate}`)
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) return;
        setCafeterias(data.cafeterias ?? []);
        if (data.cafeterias?.length && !data.cafeterias.some((item: Cafeteria) => item.code === cafeteriaCode)) {
          setCafeteriaCode(data.cafeterias[0].code);
        }
      })
      .catch(() => setCafeterias([]))
      .finally(() => { if (!cancelled) setFoodLoading(false); });
    return () => { cancelled = true; };
  }, [foodDate, cafeteriaCode]);

  const selectedCafeteria = cafeterias.find((item) => item.code === cafeteriaCode);
  const menuLines = useMemo(() => selectedCafeteria?.meals?.[meal]?.lines ?? [], [selectedCafeteria, meal]);
  const foodEstimate: MenuEstimate = useMemo(() => estimateMenu(menuLines), [menuLines]);

  useEffect(() => {
    const group = sceneApi.current?.foodGroup;
    if (!group) return;
    group.clear();
    const totals = foodEstimate.totals.length
      ? foodEstimate.totals
      : [
          { id: "starch", contribution: .55 },
          { id: "vegetable", contribution: .32 },
          { id: "plant-protein", contribution: .28 },
          { id: "poultry", contribution: .42 },
        ];
    totals.slice(0, 12).forEach((item, index) => {
      const value = Math.max(.05, item.contribution);
      const radius = clamp(.12 + Math.cbrt(value) * .14, .14, .38);
      const token = new THREE.Mesh(
        new THREE.SphereGeometry(radius, 24, 16),
        new THREE.MeshStandardMaterial({ color: TOKEN_COLORS[item.id] ?? "#b8b8b0", roughness: .65, metalness: .04 }),
      );
      const angle = index * 2.399;
      const spread = .18 + (index % 4) * .23;
      token.position.set(Math.cos(angle) * spread, -1.12 + index * .17, Math.sin(angle) * spread);
      token.castShadow = true;
      group.add(token);
    });
  }, [foodEstimate]);

  const dhw = bleach * .13;
  const toggleVideo = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => undefined);
    else video.pause();
  };

  const renderControls = () => {
    if (active.id === "ocean") {
      return (
        <div className="tablet-controls">
          <div className="readout-grid">
            <span><b>DATE</b>{OCEAN_DATES[oceanMonth]}</span>
            <span><b>GRID</b>{oceanCells.length.toLocaleString()} CELLS</span>
          </div>
          <label className="range-control">
            <span>MONTH <output>{MONTH_LABELS[oceanMonth]}</output></span>
            <input type="range" min="0" max="11" value={oceanMonth} onChange={(event) => setOceanMonth(Number(event.target.value))} />
          </label>
          <div className="segmented-control">
            <button className={oceanVariable === "sst" ? "active" : ""} onClick={() => setOceanVariable("sst")}>SST</button>
            <button className={oceanVariable === "anom" ? "active" : ""} onClick={() => setOceanVariable("anom")}>ANOMALY</button>
          </div>
          <button className="primary-control" onClick={() => setOceanPlaying((value) => !value)}>{oceanPlaying ? "PAUSE TIMELINE" : oceanLoading ? "LOADING NOAA DATA" : "PLAY 2025 TIMELINE"}</button>
        </div>
      );
    }
    if (active.id === "daisy") {
      return (
        <div className="tablet-controls">
          <div className="readout-grid"><span><b>MODE</b>VIDEO PROTOTYPE</span><span><b>STATE</b>{videoPlaying ? "PLAYING" : "PAUSED"}</span></div>
          <label className="range-control"><span>POSITION <output>{Math.round(videoProgress)}%</output></span><input type="range" min="0" max="100" value={videoProgress} onChange={(event) => { const video = videoRef.current; if (video?.duration) video.currentTime = video.duration * Number(event.target.value) / 100; }} /></label>
          <button className="primary-control" onClick={toggleVideo}>{videoPlaying ? "PAUSE VIDEO" : "PLAY VIDEO"}</button>
        </div>
      );
    }
    if (active.id === "coral") {
      return (
        <div className="tablet-controls">
          <div className="readout-grid"><span><b>BLEACHING</b>{bleach.toFixed(0)}%</span><span><b>DHW</b>{dhw.toFixed(1)} °C-WEEKS</span></div>
          <div className="bleach-bar"><i style={{ width: `${bleach}%` }} /></div>
          <button
            className={`touch-pad ${touching ? "active" : ""}`}
            onPointerDown={() => setTouching(true)}
            onPointerUp={() => setTouching(false)}
            onPointerCancel={() => setTouching(false)}
            onPointerLeave={() => setTouching(false)}
            onKeyDown={(event) => { if (event.key === " " || event.key === "Space" || event.code === "Space" || event.key === "Enter") setTouching(true); }}
            onKeyUp={(event) => { if (event.key === " " || event.key === "Space" || event.code === "Space" || event.key === "Enter") setTouching(false); }}
          >
            <span>{touching ? "HEAT APPLIED" : "TOUCH + HOLD"}</span>
            <small>{touching ? "BLEACHING IN PROGRESS" : "RELEASE TO STOP HEATING"}</small>
          </button>
          <button className="text-control" onClick={() => setBleach(0)}>RESET RECOVERY</button>
        </div>
      );
    }
    return (
      <div className="tablet-controls">
        <div className="readout-grid"><span><b>MEAL</b>{foodEstimate.kg.toFixed(2)} KG CO₂E</span><span><b>DAILY BUDGET</b>{(foodEstimate.kg / 5.5 * 100).toFixed(0)}%</span></div>
        <input className="date-input" type="date" value={foodDate} onChange={(event) => setFoodDate(event.target.value)} />
        <select value={cafeteriaCode} onChange={(event) => setCafeteriaCode(event.target.value)} aria-label="Cafeteria">
          {cafeterias.length ? cafeterias.map((item) => <option key={item.code} value={item.code}>{item.short} · {item.name}</option>) : <option>{foodLoading ? "LOADING KAIST MENU" : "MENU UNAVAILABLE"}</option>}
        </select>
        <div className="segmented-control three-way">
          {(["breakfast", "lunch", "dinner"] as MealId[]).map((item) => <button key={item} className={meal === item ? "active" : ""} onClick={() => setMeal(item)}>{item.slice(0, 1).toUpperCase()}</button>)}
        </div>
        <p className="menu-preview">{menuLines.length ? menuLines.slice(0, 4).join(" · ") : "선택한 날짜의 메뉴를 불러오면 식재료 토큰이 구 안에 쌓입니다."}</p>
      </div>
    );
  };

  return (
    <main className="installation-shell">
      <section className="scene-stage" aria-label="Spherical display exhibition simulation">
        <canvas ref={canvasRef} className="installation-canvas" />
        <div className="scene-caption">
          <span>SPHERICAL STUDIES / WIP 2026</span>
          <small>DRAG THE SPACE TO ORBIT</small>
        </div>
        <div className="display-label">
          <span>NOW DISPLAYING</span>
          <strong>{active.en}</strong>
        </div>
      </section>

      <aside className="tablet-panel" aria-label="iPad exhibition controller">
        <div className="tablet-camera" aria-hidden="true" />
        <header className="tablet-header"><span>KI / SPHERE CONTROL</span><b>LIVE</b></header>
        <nav className="tablet-projects" aria-label="Projects">
          {PROJECTS.map((project, index) => (
            <button key={project.id} className={index === activeIndex ? "active" : ""} onClick={() => selectProject(index)} aria-label={project.en}>
              <span>{project.number}</span><i />
            </button>
          ))}
        </nav>
        <section className="tablet-title" key={active.id}>
          <p>{active.number} / 04</p>
          <h1>{active.ko}</h1>
          <h2>{active.en}</h2>
          <span>제작자 / {active.maker}</span>
        </section>
        {renderControls()}
        <section className="tablet-about">
          <p>{active.description}</p>
          <dl>
            <div><dt>DATA / SOURCE</dt><dd>{active.dataset}</dd></div>
            <div><dt>INTERACTION</dt><dd>{active.interaction}</dd></div>
          </dl>
        </section>
        <footer className="tablet-footer"><span>← → OR 1—4 TO SWITCH</span><button onClick={() => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()}>FULLSCREEN</button></footer>
      </aside>
      <video ref={videoRef} className="texture-video" src="/projects/daisy/daisy-world.mp4" muted loop playsInline preload="metadata" />
    </main>
  );
}
