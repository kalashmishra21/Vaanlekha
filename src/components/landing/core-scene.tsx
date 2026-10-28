"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { CoreMode } from "./saathi-core";

type CoreProps = { mode: CoreMode; onReady: () => void; onContextLost: () => void };

function makeAssembly() {
  const rig = new THREE.Group();
  const shell = new THREE.Group();
  shell.rotation.set(0.18, -0.22, 0.11);
  rig.add(shell);
  const resources: Array<{ dispose: () => void }> = [];
  const darkCore = new THREE.Mesh(new THREE.SphereGeometry(1.34, 32, 24), new THREE.MeshPhysicalMaterial({ color: 0x1b3023, metalness: 0.42, roughness: 0.27, clearcoat: 0.75, clearcoatRoughness: 0.18 }));
  darkCore.castShadow = true;
  shell.add(darkCore);
  resources.push(darkCore.geometry, darkCore.material);

  const source = new THREE.IcosahedronGeometry(1.73, 0);
  const position = source.getAttribute("position");
  const triangles: Array<{ vertices: THREE.Vector3[]; center: THREE.Vector3; normal: THREE.Vector3 }> = [];
  for (let index = 0; index < position.count; index += 3) {
    const vertices = [0, 1, 2].map((offset) => new THREE.Vector3().fromBufferAttribute(position, index + offset));
    const center = vertices[0].clone().add(vertices[1]).add(vertices[2]).divideScalar(3);
    triangles.push({ vertices, center, normal: center.clone().normalize() });
  }
  source.dispose();
  const apertureIndex = triangles.reduce((best, triangle, index) => triangle.center.z > triangles[best].center.z ? index : best, 0);
  const plateColors = [0xb6c9aa, 0x729478, 0xe0e9d7, 0x496f55, 0x8faf8b];
  const plateMaterials = plateColors.map((color) => new THREE.MeshPhysicalMaterial({ color, metalness: 0.34, roughness: 0.33, clearcoat: 0.72, clearcoatRoughness: 0.24, emissive: 0x1b3c27, emissiveIntensity: 0.04, side: THREE.DoubleSide }));
  resources.push(...plateMaterials);
  const plates: Array<{ plate: THREE.Mesh; normal: THREE.Vector3; phase: number }> = [];

  triangles.forEach((triangle, index) => {
    if (index === apertureIndex) return;
    const vertices: number[] = [];
    for (const depth of [0.115, -0.055]) {
      for (const vertex of triangle.vertices) {
        const inset = depth > 0 ? 0.115 : 0.035;
        const point = vertex.clone().lerp(triangle.center, inset).addScaledVector(triangle.normal, depth);
        vertices.push(point.x, point.y, point.z);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex([0, 1, 2, 5, 4, 3, 0, 3, 4, 0, 4, 1, 1, 4, 5, 1, 5, 2, 2, 5, 3, 2, 3, 0]);
    geometry.computeVertexNormals();
    const plate = new THREE.Mesh(geometry, plateMaterials[index % plateMaterials.length]);
    plate.castShadow = true;
    plate.receiveShadow = true;
    shell.add(plate);
    plates.push({ plate, normal: triangle.normal, phase: index * 0.67 });
    resources.push(geometry);
    const outlineGeometry = new THREE.EdgesGeometry(geometry, 20);
    const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xe8efde, transparent: true, opacity: 0.45 });
    plate.add(new THREE.LineSegments(outlineGeometry, outlineMaterial));
    resources.push(outlineGeometry, outlineMaterial);
  });

  const apertureNormal = triangles[apertureIndex].normal;
  const aperture = new THREE.Group();
  aperture.position.copy(apertureNormal).multiplyScalar(1.5);
  aperture.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), apertureNormal);
  const apertureBase = new THREE.Mesh(new THREE.CircleGeometry(0.33, 40), new THREE.MeshPhysicalMaterial({ color: 0x17281d, metalness: 0.25, roughness: 0.23, clearcoat: 1 }));
  const apertureRing = new THREE.Mesh(new THREE.TorusGeometry(0.31, 0.034, 8, 64), new THREE.MeshStandardMaterial({ color: 0xd4e2c4, metalness: 0.62, roughness: 0.24, emissive: 0x52775a, emissiveIntensity: 0.22 }));
  apertureRing.position.z = 0.015;
  const apertureEye = new THREE.Mesh(new THREE.SphereGeometry(0.12, 20, 12), new THREE.MeshStandardMaterial({ color: 0xf0f2dc, metalness: 0.18, roughness: 0.2, emissive: 0x9dbf91, emissiveIntensity: 0.7 }));
  apertureEye.position.z = 0.045;
  aperture.add(apertureBase, apertureRing, apertureEye);
  shell.add(aperture);
  resources.push(apertureBase.geometry, apertureBase.material, apertureRing.geometry, apertureRing.material, apertureEye.geometry, apertureEye.material);

  const ringMaterial = new THREE.MeshStandardMaterial({ color: 0xb8d0ac, metalness: 0.68, roughness: 0.3, transparent: true, opacity: 0.62 });
  const outerRing = new THREE.Mesh(new THREE.TorusGeometry(2.28, 0.018, 6, 96), ringMaterial);
  outerRing.rotation.set(1.02, 0.18, -0.4);
  const innerRing = new THREE.Mesh(new THREE.TorusGeometry(2.01, 0.013, 6, 96), ringMaterial.clone());
  innerRing.rotation.set(0.25, 1.06, 0.35);
  rig.add(outerRing, innerRing);
  resources.push(ringMaterial, outerRing.geometry, innerRing.geometry, innerRing.material);

  // A radial signal path makes the object read as a voice system, not a spinning gem.
  const waveGeometry = new THREE.CylinderGeometry(0.012, 0.012, 1, 5, 1, true);
  const waveMaterial = new THREE.MeshStandardMaterial({
    color: 0xb8d0ac,
    metalness: 0.35,
    roughness: 0.28,
    emissive: 0x527b57,
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.86,
  });
  const waveCount = 56;
  const voiceWave = new THREE.InstancedMesh(waveGeometry, waveMaterial, waveCount);
  voiceWave.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rig.add(voiceWave);
  resources.push(waveGeometry, waveMaterial);
  const nodeMaterial = new THREE.MeshStandardMaterial({ color: 0xd5e4c8, metalness: 0.55, roughness: 0.23, emissive: 0x6e926e, emissiveIntensity: 0.3 });
  for (const [ring, angle] of [[outerRing, 0], [outerRing, Math.PI], [innerRing, Math.PI / 2]] as const) {
    const node = new THREE.Mesh(new THREE.OctahedronGeometry(0.075, 0), nodeMaterial);
    const radius = ring === outerRing ? 2.28 : 2.01;
    node.position.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    ring.add(node);
    resources.push(node.geometry);
  }
  resources.push(nodeMaterial);
  return { rig, shell, plates, outerRing, innerRing, apertureEye, plateMaterials, voiceWave, waveMaterial, waveCount, resources };
}

export default function CoreScene({ mode, onReady, onContextLost }: CoreProps) {
  const host = useRef<HTMLDivElement>(null);
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => {
    const mount = host.current;
    if (!mount) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "high-performance" });
    } catch {
      onContextLost();
      return;
    }
    const assembly = makeAssembly();
    const scene = new THREE.Scene();
    scene.add(assembly.rig);
    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
    camera.position.set(0.18, 0.2, 9.1);
    camera.lookAt(0, 0, 0);
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.35));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = document.documentElement.dataset.theme === "light" ? 1.15 : 1.32;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = "core-webgl";
    renderer.domElement.setAttribute("aria-hidden", "true");
    mount.append(renderer.domElement);

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8), new THREE.ShadowMaterial({ color: 0x06091b, opacity: 0.085 }));
    floor.position.set(0.25, -0.12, -2.15);
    floor.receiveShadow = true;
    scene.add(floor);
    const ambient = new THREE.AmbientLight(0xe4edda, 1.55);
    const key = new THREE.DirectionalLight(0xe5eedf, 4.8);
    key.position.set(-3.5, 5, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.radius = 3;
    key.shadow.camera.left = -4; key.shadow.camera.right = 4; key.shadow.camera.top = 4; key.shadow.camera.bottom = -4;
    const rim = new THREE.DirectionalLight(0xa6c39b, 4);
    rim.position.set(3.5, 1, -3.4);
    const specular = new THREE.PointLight(0xe0eed8, 10, 12, 2);
    specular.position.set(3, -1.6, 4.1);
    scene.add(ambient, key, rim, specular);

    const pointer = { x: 0, y: 0 };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const bounds = mount.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 0.26;
      pointer.y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 0.18;
    };
    const onPointerLeave = () => { pointer.x = 0; pointer.y = 0; };
    const scroll = { value: 0 };
    const onScroll = () => {
      const section = document.querySelector("#story");
      if (!section) return;
      const rect = section.getBoundingClientRect();
      scroll.value = THREE.MathUtils.clamp((innerHeight - rect.top) / (innerHeight + rect.height), 0, 1);
    };
    const onTheme = () => {
      const light = document.documentElement.dataset.theme === "light";
      renderer.toneMappingExposure = light ? 1.18 : 1.32;
      const colors = light ? [0xc5d7b9, 0x8fac8b, 0x52765b, 0x789b7d, 0xe4edda] : [0xb6c9aa, 0x729478, 0xe0e9d7, 0x496f55, 0x8faf8b];
      assembly.plateMaterials.forEach((material, index) => material.color.setHex(colors[index % colors.length]));
      assembly.waveMaterial.color.setHex(light ? 0x5b845f : 0xb8d0ac);
    };
    const themeObserver = new MutationObserver(onTheme);
    const onContextLostEvent = (event: Event) => { event.preventDefault(); onContextLost(); };
    const resize = () => {
      const { width, height } = mount.getBoundingClientRect();
      if (!width || !height) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    mount.addEventListener("pointermove", onPointerMove);
    mount.addEventListener("pointerleave", onPointerLeave);
    renderer.domElement.addEventListener("webglcontextlost", onContextLostEvent);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    onScroll(); onTheme(); resize();

    let frame = 0;
    let last = performance.now();
    let elapsed = 0;
    let openness = 0;
    let visible = true;
    const voice = new THREE.Object3D();
    const waveDirection = new THREE.Vector3();
    const waveUp = new THREE.Vector3(0, 1, 0);
    const signalColor = new THREE.Color();
    const eyeColor = new THREE.Color();
    const render = (now: number) => {
      frame = 0;
      if (document.hidden || !visible) return;
      const delta = Math.min((now - last) / 1000, 0.05);
      last = now; elapsed += delta;
      const state = modeRef.current;
      const opening = state === "listening" ? 0.13 : state === "thinking" ? 0.19 : state === "action" ? 0.08 : 0;
      openness = THREE.MathUtils.damp(openness, opening, 4.2, delta);
      const speed = state === "thinking" ? 0.36 : state === "listening" ? 0.15 : 0.055;
      assembly.shell.rotation.y += delta * speed;
      assembly.shell.rotation.x = THREE.MathUtils.damp(assembly.shell.rotation.x, 0.18 + pointer.y + scroll.value * 0.22, 2.6, delta);
      assembly.rig.rotation.y = THREE.MathUtils.damp(assembly.rig.rotation.y, pointer.x + scroll.value * 0.23, 2.2, delta);
      assembly.rig.position.y = Math.sin(elapsed * 1.15) * 0.045;
      for (const { plate, normal, phase } of assembly.plates) {
        const pulse = state === "listening" ? Math.sin(elapsed * 7.5 + phase) * 0.024 : 0;
        plate.position.copy(normal).multiplyScalar(openness + pulse);
      }
      assembly.outerRing.rotation.z += delta * (state === "listening" ? 0.33 : 0.035);
      assembly.innerRing.rotation.y += delta * (state === "thinking" ? 0.32 : 0.026);
      const signalIntensity = state === "listening" ? 0.11 : state === "thinking" ? 0.065 : state === "action" ? 0.09 : state === "result" ? 0.052 : 0.035;
      for (let index = 0; index < assembly.waveCount; index += 1) {
        const angle = (index / assembly.waveCount) * Math.PI * 2;
        const pulse = Math.abs(Math.sin(elapsed * (state === "listening" ? 8.4 : state === "thinking" ? 3.1 : 1.8) + index * 0.61));
        const height = signalIntensity + pulse * (state === "listening" ? 0.25 : state === "action" ? 0.13 : state === "thinking" ? 0.075 : 0.045);
        waveDirection.set(Math.cos(angle), Math.sin(angle) * 0.78, 0).normalize();
        voice.position.set(Math.cos(angle) * 2.61, Math.sin(angle) * 2.05, -0.36);
        voice.quaternion.setFromUnitVectors(waveUp, waveDirection);
        voice.scale.set(1, height, 1);
        voice.updateMatrix();
        assembly.voiceWave.setMatrixAt(index, voice.matrix);
      }
      assembly.voiceWave.instanceMatrix.needsUpdate = true;
      signalColor.setHex(state === "result" ? 0x9bd3a0 : state === "listening" ? 0xa9c990 : 0xc79a69);
      assembly.waveMaterial.color.lerp(signalColor, Math.min(1, delta * 2.5));
      assembly.waveMaterial.emissiveIntensity = THREE.MathUtils.damp(assembly.waveMaterial.emissiveIntensity, state === "listening" ? 0.8 : state === "thinking" ? 0.48 : state === "action" ? 0.65 : 0.28, 3.5, delta);
      eyeColor.setHex(state === "result" ? 0x91d6a0 : state === "thinking" ? 0xffdf9f : 0xf5ca8d);
      assembly.apertureEye.material.emissive.lerp(eyeColor, Math.min(1, delta * 3.5));
      assembly.apertureEye.material.emissiveIntensity = THREE.MathUtils.damp(assembly.apertureEye.material.emissiveIntensity, state === "listening" ? 1.5 : state === "thinking" ? 1.2 : 0.7, 4, delta);
      for (const material of assembly.plateMaterials) material.emissiveIntensity = THREE.MathUtils.damp(material.emissiveIntensity, state === "thinking" ? 0.11 : 0.025, 3, delta);
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    const inView = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (!visible) { cancelAnimationFrame(frame); frame = 0; }
      else if (!frame) { last = performance.now(); frame = requestAnimationFrame(render); }
    }, { threshold: 0.04 });
    inView.observe(mount);
    function onVisibility() {
      if (document.hidden) { cancelAnimationFrame(frame); frame = 0; }
      else if (visible && !frame) { last = performance.now(); frame = requestAnimationFrame(render); }
    }
    frame = requestAnimationFrame((now) => {
      render(now);
      onReady();
    });
    return () => {
      cancelAnimationFrame(frame);
      inView.disconnect(); resizeObserver.disconnect(); themeObserver.disconnect();
      mount.removeEventListener("pointermove", onPointerMove);
      mount.removeEventListener("pointerleave", onPointerLeave);
      renderer.domElement.removeEventListener("webglcontextlost", onContextLostEvent);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibility);
      floor.geometry.dispose(); floor.material.dispose();
      assembly.resources.forEach((resource) => resource.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [onContextLost, onReady]);
  return <div className="core-three-host" ref={host} aria-hidden="true" />;
}
