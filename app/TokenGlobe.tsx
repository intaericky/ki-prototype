"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type GlobeToken = {
  id: string;
  categoryId: string;
  label: string;
  kg: number;
  color: string;
};

type Body = {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  angularVelocity: THREE.Vector3;
  radius: number;
  mass: number;
  inverseMass: number;
  delay: number;
  active: boolean;
};

const CONTAINER_RADIUS = 3.55;
const PACKED_VOLUME_AT_BUDGET = 0.42;
const FIXED_STEP = 1 / 120;
const MAX_SPEED = 7;
const QUIET_LINEAR_SPEED_SQ = 0.035 ** 2;
const QUIET_ANGULAR_SPEED_SQ = 0.045 ** 2;
const QUIET_STEPS_TO_SLEEP = 120;

const TOKEN_MARKS: Record<string, string> = {
  "red-meat": "RM",
  fish: "FI",
  pork: "PK",
  poultry: "PO",
  yogurt: "YO",
  "protein-starter": "PR",
  starch: "ST",
  pastry: "PA",
  cheese: "CH",
  egg: "EG",
  vegetable: "VE",
  grain: "GR",
  coffee: "CF",
  fruit: "FR",
  dairy: "DA",
  "plant-protein": "PL",
  salad: "SA",
  bread: "BR",
};

function radiusForCarbon(kg: number, budgetKg: number) {
  // Solid token volume is linear in kg CO2e. At one daily budget, tokens occupy
  // 42% of the shell so differently sized spheres still have room to pack.
  const safeBudget = Number.isFinite(budgetKg) && budgetKg > 0 ? budgetKg : 5.5;
  const safeKg = Number.isFinite(kg) && kg > 0 ? kg : 0.001;
  const shellVolume = 4 / 3 * Math.PI * CONTAINER_RADIUS ** 3;
  const volumeScale = shellVolume * PACKED_VOLUME_AT_BUDGET / safeBudget;
  const radius = Math.cbrt((3 * safeKg * volumeScale) / (4 * Math.PI));
  return THREE.MathUtils.clamp(radius, 0.08, CONTAINER_RADIUS * 0.72);
}

function tokenTexture(token: GlobeToken, renderer: THREE.WebGLRenderer) {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 384;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = token.color;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const light = context.createLinearGradient(0, 0, 0, canvas.height);
  light.addColorStop(0, "rgba(255,255,255,.13)");
  light.addColorStop(0.48, "rgba(255,255,255,0)");
  light.addColorStop(1, "rgba(0,0,0,.18)");
  context.fillStyle = light;
  context.fillRect(0, 0, canvas.width, canvas.height);

  // A restrained, repeatable stipple gives the painted tokens some material
  // grain without introducing random animation or noisy photographic texture.
  context.fillStyle = "rgba(255,255,255,.035)";
  for (let y = 7; y < canvas.height; y += 13) {
    for (let x = (y / 13) % 2 ? 5 : 11; x < canvas.width; x += 17) {
      context.fillRect(x, y, 1.2, 1.2);
    }
  }

  context.strokeStyle = "rgba(18,18,16,.28)";
  context.lineWidth = 3;
  context.beginPath();
  context.moveTo(0, 67);
  context.lineTo(canvas.width, 67);
  context.moveTo(0, canvas.height - 67);
  context.lineTo(canvas.width, canvas.height - 67);
  context.stroke();

  const mark = TOKEN_MARKS[token.categoryId] ?? token.label.slice(0, 2).toUpperCase();
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.font = "600 92px Arial, sans-serif";
  context.fillStyle = "rgba(255,255,255,.16)";
  context.fillText(mark, canvas.width / 2 - 2, canvas.height / 2 - 3);
  context.fillStyle = "rgba(14,14,12,.72)";
  context.fillText(mark, canvas.width / 2, canvas.height / 2);

  context.font = "500 22px Arial, sans-serif";
  context.letterSpacing = "3px";
  context.fillStyle = "rgba(14,14,12,.56)";
  context.fillText(`${token.kg.toFixed(2)} KG CO₂E`, canvas.width / 2, canvas.height / 2 + 72);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function circleLine(radius: number, material: THREE.LineBasicMaterial) {
  const points = Array.from({ length: 129 }, (_, index) => {
    const angle = index / 128 * Math.PI * 2;
    return new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  });
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

export default function TokenGlobe({ tokens, resetKey, budgetKg, theme = "dark" }: { tokens: GlobeToken[]; resetKey: number; budgetKg: number; theme?: "dark" | "light" }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [runtimeError, setRuntimeError] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setRuntimeError(false);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(theme === "light" ? 0xffffff : 0x000000, 0.022);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.25, 20.5);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch {
      queueMicrotask(() => setRuntimeError(true));
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(theme === "light" ? 0xffffff : 0x000000, 1);
    mount.appendChild(renderer.domElement);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, -0.18, 0);
    controls.enablePan = false;
    controls.enableDamping = !reducedMotion;
    controls.dampingFactor = 0.07;
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.8;
    controls.minDistance = 7.2;
    controls.maxDistance = 18;
    controls.minPolarAngle = 0.12;
    controls.maxPolarAngle = Math.PI - 0.12;
    controls.update();

    scene.add(new THREE.HemisphereLight(0xe9eef4, 0x070706, 1.45));
    const keyLight = new THREE.SpotLight(0xfff5e8, 82, 38, Math.PI / 5.5, 0.55, 1.4);
    keyLight.position.set(-6.5, 9, 10);
    keyLight.target.position.set(0, -0.7, 0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.00035;
    keyLight.shadow.normalBias = 0.025;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const fillLight = new THREE.PointLight(0x8aa9c4, 18, 26, 1.7);
    fillLight.position.set(7, 1.5, 7);
    scene.add(fillLight);

    const rimLight = new THREE.PointLight(0xffffff, 22, 24, 1.8);
    rimLight.position.set(-4, -3, -8);
    scene.add(rimLight);

    const shellGeometry = new THREE.SphereGeometry(CONTAINER_RADIUS, 96, 64);
    const shell = new THREE.Mesh(
      shellGeometry,
      new THREE.MeshPhysicalMaterial({
        color: 0xe8edf0,
        roughness: 0.12,
        metalness: 0,
        transmission: 0.12,
        thickness: 0.15,
        ior: 1.48,
        transparent: true,
        opacity: 0.07,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    shell.receiveShadow = true;
    shell.renderOrder = 3;
    scene.add(shell);

    const contourMaterial = new THREE.LineBasicMaterial({ color: 0xf1f2ee, transparent: true, opacity: 0.34, depthWrite: false });
    const contourFront = circleLine(CONTAINER_RADIUS * 1.002, contourMaterial);
    const contourSide = circleLine(CONTAINER_RADIUS * 1.002, contourMaterial);
    contourSide.rotation.y = Math.PI / 2;
    const contourHorizon = circleLine(CONTAINER_RADIUS * 1.002, contourMaterial);
    contourHorizon.rotation.x = Math.PI / 2;
    scene.add(contourFront, contourSide, contourHorizon);

    const innerReference = new THREE.Mesh(
      new THREE.SphereGeometry(CONTAINER_RADIUS * 0.985, 64, 40),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.018, depthWrite: false }),
    );
    innerReference.renderOrder = 2;
    scene.add(innerReference);

    const bodies: Body[] = tokens.map((token, index) => {
      const radius = radiusForCarbon(token.kg, budgetKg);
      const geometry = new THREE.SphereGeometry(radius, 48, 32);
      const map = tokenTexture(token, renderer);
      const material = new THREE.MeshStandardMaterial({
        color: map ? 0xffffff : token.color,
        map,
        roughness: 0.62,
        metalness: 0,
        envMapIntensity: 0.35,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData = token;
      mesh.rotation.set(index * 0.37, index * 1.19, index * 0.23);
      scene.add(mesh);

      const angle = index * 2.399963;
      const spread = Math.min(1.45, CONTAINER_RADIUS - radius - 0.2);
      const position = new THREE.Vector3(
        Math.cos(angle) * spread * 0.58,
        CONTAINER_RADIUS - radius - 0.08,
        Math.sin(angle) * spread * 0.58,
      );
      const mass = Math.max(0.01, token.kg);
      return {
        mesh,
        position,
        velocity: new THREE.Vector3(Math.sin(angle * 1.7) * 0.08, 0, Math.cos(angle * 1.3) * 0.08),
        angularVelocity: new THREE.Vector3(
          Math.sin(angle * 0.7) * 0.42,
          Math.cos(angle * 1.3) * 0.34,
          Math.sin(angle * 1.1) * 0.28,
        ),
        radius,
        mass,
        inverseMass: 1 / mass,
        delay: index * 0.2,
        active: false,
      };
    });

    const onContextLost = (event: Event) => {
      event.preventDefault();
      setRuntimeError(true);
    };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);

    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      renderer.setSize(Math.max(1, width), Math.max(1, height), false);
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    resize();

    let elapsed = 0;
    let frame = 0;
    let previousTime = performance.now() / 1000;
    let accumulator = 0;
    let quietSteps = 0;
    let physicsSleeping = false;
    const activationEnd = bodies.reduce((latest, body) => Math.max(latest, body.delay), 0);
    const overBudget = tokens.reduce((sum, token) => sum + token.kg, 0) > budgetKg;
    // An over-budget meal can exceed the geometric packing capacity of the
    // daily-budget shell. In that case the positional solver cannot find a
    // perfect non-overlapping state, so it receives a shorter hard settle time.
    const hardSleepAfter = activationEnd + (overBudget ? 5.5 : 9);
    const normal = new THREE.Vector3();
    const delta = new THREE.Vector3();
    const relative = new THREE.Vector3();

    const collideWithShell = (body: Body) => {
      const distance = body.position.length();
      const limit = CONTAINER_RADIUS - body.radius;
      if (distance <= limit) return;
      normal.copy(body.position).divideScalar(Math.max(distance, 0.0001));
      body.position.copy(normal).multiplyScalar(limit);
      const outward = body.velocity.dot(normal);
      if (outward > 0) body.velocity.addScaledVector(normal, -(1.18 * outward));
      body.velocity.multiplyScalar(0.97);
    };

    const collideBodies = (a: Body, b: Body) => {
      if (!a.active || !b.active) return;
      delta.copy(b.position).sub(a.position);
      let distance = delta.length();
      const minimum = a.radius + b.radius;
      if (distance >= minimum) return;
      if (distance < 0.0001) {
        delta.set(a.mesh.id % 2 ? 1 : -1, 0, 0);
        distance = 0;
      } else {
        delta.divideScalar(distance);
      }

      const inverseTotal = a.inverseMass + b.inverseMass;
      const correction = Math.max(0, minimum - distance - 0.001) * 0.82;
      a.position.addScaledVector(delta, -correction * (a.inverseMass / inverseTotal));
      b.position.addScaledVector(delta, correction * (b.inverseMass / inverseTotal));

      relative.copy(b.velocity).sub(a.velocity);
      const closing = relative.dot(delta);
      if (closing < 0) {
        const impulse = -(1.12 * closing) / inverseTotal;
        a.velocity.addScaledVector(delta, -impulse * a.inverseMass);
        b.velocity.addScaledVector(delta, impulse * b.inverseMass);
      }
    };

    const stepPhysics = (dt: number) => {
      if (physicsSleeping) return;
      elapsed += dt;
      for (const body of bodies) {
        if (!body.active && elapsed >= body.delay) {
          body.active = true;
          body.mesh.visible = true;
        }
        if (!body.active) continue;
        body.velocity.y -= 4.2 * dt;
        body.velocity.multiplyScalar(Math.pow(0.992, dt * 60));
        body.angularVelocity.multiplyScalar(Math.pow(0.986, dt * 60));
        if (body.velocity.lengthSq() > MAX_SPEED ** 2) body.velocity.setLength(MAX_SPEED);
        body.position.addScaledVector(body.velocity, dt);
        body.mesh.rotation.x += body.angularVelocity.x * dt;
        body.mesh.rotation.y += body.angularVelocity.y * dt;
        body.mesh.rotation.z += body.angularVelocity.z * dt;
        collideWithShell(body);
      }

      for (let iteration = 0; iteration < 4; iteration += 1) {
        for (let i = 0; i < bodies.length; i += 1) {
          for (let j = i + 1; j < bodies.length; j += 1) collideBodies(bodies[i], bodies[j]);
          if (bodies[i].active) collideWithShell(bodies[i]);
        }
      }

      if (elapsed < activationEnd || bodies.some((body) => !body.active)) return;
      const quiet = bodies.every((body) => (
        body.velocity.lengthSq() < QUIET_LINEAR_SPEED_SQ
        && body.angularVelocity.lengthSq() < QUIET_ANGULAR_SPEED_SQ
      ));
      quietSteps = quiet ? quietSteps + 1 : 0;

      if (quietSteps >= QUIET_STEPS_TO_SLEEP || elapsed >= hardSleepAfter) {
        physicsSleeping = true;
        for (const body of bodies) {
          body.velocity.set(0, 0, 0);
          body.angularVelocity.set(0, 0, 0);
        }
      }
    };

    const render = () => {
      for (const body of bodies) if (body.active) body.mesh.position.copy(body.position);
      if (!reducedMotion) controls.update();
      renderer.render(scene, camera);
    };

    if (reducedMotion) {
      for (let i = 0; i < 900; i += 1) stepPhysics(FIXED_STEP);
      controls.addEventListener("change", render);
      render();
    } else {
      const animate = (time: number) => {
        frame = requestAnimationFrame(animate);
        const now = time / 1000;
        accumulator += Math.min(now - previousTime, 0.05);
        previousTime = now;
        let substeps = 0;
        while (accumulator >= FIXED_STEP && substeps < 6) {
          stepPhysics(FIXED_STEP);
          accumulator -= FIXED_STEP;
          substeps += 1;
        }
        render();
      };
      frame = requestAnimationFrame(animate);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      renderer.domElement.removeEventListener("webglcontextlost", onContextLost);
      for (const body of bodies) {
        body.mesh.geometry.dispose();
        const material = body.mesh.material as THREE.MeshStandardMaterial;
        material.map?.dispose();
        material.dispose();
      }
      shellGeometry.dispose();
      (shell.material as THREE.Material).dispose();
      contourFront.geometry.dispose();
      contourSide.geometry.dispose();
      contourHorizon.geometry.dispose();
      contourMaterial.dispose();
      innerReference.geometry.dispose();
      (innerReference.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [tokens, resetKey, budgetKg, theme]);

  return (
    <div ref={mountRef} className="token-globe" role="img" aria-label={`${tokens.length}개의 탄소 토큰이 1일 탄소예산 구 안으로 낙하한다. 드래그해 회전하고 휠 또는 핀치로 확대할 수 있다.`}>
      {runtimeError && <div className="webgl-error">3D 표시를 시작하지 못했습니다.<br />메뉴 수치는 계속 확인할 수 있습니다.</div>}
    </div>
  );
}
