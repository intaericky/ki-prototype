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

export default function TokenGlobe({ tokens, resetKey, budgetKg }: { tokens: GlobeToken[]; resetKey: number; budgetKg: number }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [runtimeError, setRuntimeError] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    setRuntimeError(false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0.25, 20.5);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setRuntimeError(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
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

    scene.add(new THREE.HemisphereLight(0xffffff, 0x181818, 2.6));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.4);
    keyLight.position.set(-4, 7, 8);
    scene.add(keyLight);

    const shellGeometry = new THREE.SphereGeometry(CONTAINER_RADIUS, 48, 32);
    const shell = new THREE.Mesh(
      shellGeometry,
      new THREE.MeshBasicMaterial({ color: 0xf3f3ef, wireframe: true, transparent: true, opacity: 0.14 }),
    );
    scene.add(shell);

    const rim = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.CircleGeometry(CONTAINER_RADIUS, 96)),
      new THREE.LineBasicMaterial({ color: 0xf3f3ef, transparent: true, opacity: 0.55 }),
    );
    rim.rotation.x = Math.PI / 2;
    scene.add(rim);

    const bodies: Body[] = tokens.map((token, index) => {
      const radius = radiusForCarbon(token.kg, budgetKg);
      const geometry = new THREE.SphereGeometry(radius, 32, 20);
      const material = new THREE.MeshStandardMaterial({ color: token.color, roughness: 0.52, metalness: 0 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      mesh.userData = token;
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
      elapsed += dt;
      for (const body of bodies) {
        if (!body.active && elapsed >= body.delay) {
          body.active = true;
          body.mesh.visible = true;
        }
        if (!body.active) continue;
        body.velocity.y -= 4.2 * dt;
        body.velocity.multiplyScalar(Math.pow(0.992, dt * 60));
        if (body.velocity.lengthSq() > MAX_SPEED ** 2) body.velocity.setLength(MAX_SPEED);
        body.position.addScaledVector(body.velocity, dt);
        collideWithShell(body);
      }

      for (let iteration = 0; iteration < 4; iteration += 1) {
        for (let i = 0; i < bodies.length; i += 1) {
          for (let j = i + 1; j < bodies.length; j += 1) collideBodies(bodies[i], bodies[j]);
          if (bodies[i].active) collideWithShell(bodies[i]);
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
        (body.mesh.material as THREE.Material).dispose();
      }
      shellGeometry.dispose();
      (shell.material as THREE.Material).dispose();
      rim.geometry.dispose();
      (rim.material as THREE.Material).dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [tokens, resetKey, budgetKg]);

  return (
    <div ref={mountRef} className="token-globe" role="img" aria-label={`${tokens.length}개의 탄소 토큰이 1일 탄소예산 구 안으로 낙하한다. 드래그해 회전하고 휠 또는 핀치로 확대할 수 있다.`}>
      {runtimeError && <div className="webgl-error">3D 표시를 시작하지 못했습니다.<br />메뉴 수치는 계속 확인할 수 있습니다.</div>}
    </div>
  );
}
