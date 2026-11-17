import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type {
  CameraPreset,
  CharacterAction,
  LightingMood,
  StageSet,
  StoryActivity,
} from '../types/studio';
import { startWorkerInterval } from '../utils/videoExport';

export interface Stage3DViewportProps {
  action: CharacterAction;
  storyActivity?: StoryActivity;
  scriptCue?: string;
  cameraPreset: CameraPreset;
  lightingMood: LightingMood;
  stageSet: StageSet;
  actionIntensity: number;
  onScreenText: string;
  showOnScreenText: boolean;
  lipSyncRef: React.MutableRefObject<{
    jawOpen: number;
    lipSpread: number;
    isPlaying: boolean;
  }>;
  orbitUnlocked: boolean;
  onCameraPresetClear?: () => void;
}

export interface Stage3DViewportHandle {
  captureFramePng: () => string | null;
  startVideoCaptureStream: () => MediaStream | null;
  stopVideoCaptureStream: () => void;
}

const CAMERA_PRESETS: Record<
  CameraPreset,
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  wide_stage: { pos: [0, 2.35, 6.55], target: [0, 1.38, 0] },
  medium_shot: { pos: [0.35, 1.88, 3.85], target: [0, 1.5, 0] },
  closeup_lipsync: { pos: [0.1, 2.04, 1.75], target: [0, 1.94, 0.08] },
  low_hero: { pos: [-1.25, 1.05, 3.45], target: [0, 1.62, 0] },
};

const LIGHTING_PRESETS: Record<
  LightingMood,
  {
    bg: number;
    fog: number;
    keyColor: number;
    keyIntensity: number;
    hemiSky: number;
    hemiGround: number;
    hemiIntensity: number;
    rimColor: number;
    rimIntensity: number;
    accentColor: number;
    beamOpacity: number;
  }
> = {
  warm_dawn: {
    bg: 0x0c111e,
    fog: 0x0c111e,
    keyColor: 0xffcd82,
    keyIntensity: 2.45,
    hemiSky: 0x7aa4db,
    hemiGround: 0x2a1d14,
    hemiIntensity: 0.82,
    rimColor: 0xf59e0b,
    rimIntensity: 2.9,
    accentColor: 0xffb347,
    beamOpacity: 0.075,
  },
  torchlit_mythic: {
    bg: 0x0b0912,
    fog: 0x0b0912,
    keyColor: 0xff8b42,
    keyIntensity: 2.2,
    hemiSky: 0x4b5c84,
    hemiGround: 0x33160d,
    hemiIntensity: 0.65,
    rimColor: 0xf97316,
    rimIntensity: 3.35,
    accentColor: 0xff6b2b,
    beamOpacity: 0.085,
  },
  obsidian_studio: {
    bg: 0x070b13,
    fog: 0x070b13,
    keyColor: 0xe6efff,
    keyIntensity: 2.25,
    hemiSky: 0x89a8db,
    hemiGround: 0x161c28,
    hemiIntensity: 0.76,
    rimColor: 0xfbbf24,
    rimIntensity: 2.7,
    accentColor: 0xf59e0b,
    beamOpacity: 0.065,
  },
};

export function resolveStoryActivity(
  explicit: StoryActivity | undefined,
  scriptCue: string | undefined,
  action: CharacterAction,
): StoryActivity {
  if (explicit) return explicit;
  const text = (scriptCue || '').toLowerCase();
  if (/\b(climb|mountain|summit|ascend|step|stair|peak|journey|path|bridge|walk|march)\b/.test(text)) {
    return 'climb_ascent';
  }
  if (/\b(forge|hammer|anvil|chisel|carve|build|craft|work|labor|sweat|stone|iron|train|discipline)\b/.test(text)) {
    return 'forge_labor';
  }
  if (/\b(battle|fight|shadow|fear|enemy|obstacle|warrior|sword|spear|confront|struggle|storm|defeat|guard)\b/.test(text)) {
    return 'duel_overcome';
  }
  if (/\b(scroll|book|read|write|study|library|archive|scholar|sage|monk|learn|teach|secret|ink)\b/.test(text)) {
    return 'scholar_study';
  }
  if (/\b(triumph|victory|sunrise|crown|torch|shine|rise|awaken|win|glory|believed)\b/.test(text)) {
    return 'triumph_raise';
  }
  if (action === 'heroic_stance') return 'triumph_raise';
  if (action === 'dramatic_lean') return 'duel_overcome';
  if (action === 'reflective_nod') return 'scholar_study';
  return 'orator_walk';
}

// Pre-allocated math helpers (zero GC inside animation loop)
const _camPos = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _targetBgColor = new THREE.Color();
const _targetKeyColor = new THREE.Color();
const _targetHemiSky = new THREE.Color();
const _targetRimColor = new THREE.Color();
const _targetAccentColor = new THREE.Color();

function createRadialShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(128, 128, 12, 128, 128, 124);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.78)');
    grad.addColorStop(0.45, 'rgba(0, 0, 0, 0.36)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createFloorStoneTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#111725';
    ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 4200; i++) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 43758.5453) % 1;
      const px = Math.abs(x) * 1024;
      const py = Math.abs(y) * 1024;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(0,0,0,0.14)';
      ctx.fillRect(px, py, 3, 3);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.045)';
    ctx.lineWidth = 2;
    const step = 128;
    for (let i = 0; i <= 1024; i += step) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 1024);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(1024, i);
      ctx.stroke();
    }
    const cx = 512;
    const cy = 512;
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.19)';
    ctx.lineWidth = 2.5;
    [160, 265, 360, 440].forEach((r, idx) => {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      if (idx % 2 === 1) ctx.setLineDash([12, 10]);
      else ctx.setLineDash([]);
      ctx.stroke();
    });
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.14)';
    ctx.lineWidth = 2;
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const r0 = a % 2 === 0 ? 160 : 265;
      const r1 = 440;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createFabricTexture(baseHex: string, weaveHex: string): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = baseHex;
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = weaveHex;
    ctx.lineWidth = 1;
    for (let i = 0; i < 256; i += 6) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i, 256);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i);
      ctx.lineTo(256, i);
      ctx.stroke();
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 3);
  return tex;
}

function createEmberSpriteTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 252, 235, 1)');
    grad.addColorStop(0.28, 'rgba(251, 191, 36, 0.85)');
    grad.addColorStop(0.65, 'rgba(245, 158, 11, 0.25)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function createVolumetricBeamTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.85)');
    grad.addColorStop(0.45, 'rgba(255, 255, 255, 0.25)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 256);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export const Stage3DViewport = forwardRef<Stage3DViewportHandle, Stage3DViewportProps>(
  function Stage3DViewport(
    {
      action,
      storyActivity,
      scriptCue,
      cameraPreset,
      lightingMood,
      stageSet,
      actionIntensity,
      onScreenText,
      showOnScreenText,
      lipSyncRef,
      orbitUnlocked,
    },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const [contextLost, setContextLost] = useState(false);

    const activeActivity = resolveStoryActivity(storyActivity, scriptCue, action);

    const stateRef = useRef({
      action,
      storyActivity: activeActivity,
      cameraPreset,
      lightingMood,
      stageSet,
      actionIntensity,
      orbitUnlocked,
      transitionCamera: true,
    });

    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const overlayRef = useRef({ onScreenText, showOnScreenText });
    const stepAndRenderRef = useRef<(() => void) | null>(null);
    const lastRenderPerfRef = useRef<number>(0);
    const captureWorkerStopRef = useRef<(() => void) | null>(null);
    const recordStateRef = useRef<{
      active: boolean;
      canvas: HTMLCanvasElement | null;
      ctx: CanvasRenderingContext2D | null;
      stream: MediaStream | null;
    }>({ active: false, canvas: null, ctx: null, stream: null });

    useEffect(() => {
      overlayRef.current = { onScreenText, showOnScreenText };
    }, [onScreenText, showOnScreenText]);

    useEffect(() => {
      const prevPreset = stateRef.current.cameraPreset;
      stateRef.current.action = action;
      stateRef.current.storyActivity = activeActivity;
      stateRef.current.cameraPreset = cameraPreset;
      stateRef.current.lightingMood = lightingMood;
      stateRef.current.stageSet = stageSet;
      stateRef.current.actionIntensity = actionIntensity;
      stateRef.current.orbitUnlocked = orbitUnlocked;
      if (prevPreset !== cameraPreset) {
        stateRef.current.transitionCamera = true;
      }
    }, [action, activeActivity, cameraPreset, lightingMood, stageSet, actionIntensity, orbitUnlocked]);

    useImperativeHandle(ref, () => ({
      captureFramePng: () => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (!renderer || !scene || !camera) return null;
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      },
      startVideoCaptureStream: () => {
        const renderer = rendererRef.current;
        if (!renderer) return null;
        captureWorkerStopRef.current?.();
        const recCanvas = document.createElement('canvas');
        recCanvas.width = 1280;
        recCanvas.height = 720;
        const ctx = recCanvas.getContext('2d');
        if (!ctx) return null;
        const stream = recCanvas.captureStream(30);
        recordStateRef.current = { active: true, canvas: recCanvas, ctx, stream };

        // Ensure smooth 30fps rendering + captureStream pumping even when browser tab is hidden
        captureWorkerStopRef.current = startWorkerInterval(() => {
          const now = performance.now();
          if (document.hidden || now - lastRenderPerfRef.current >= 45) {
            stepAndRenderRef.current?.();
          }
        }, 33);

        return stream;
      },
      stopVideoCaptureStream: () => {
        captureWorkerStopRef.current?.();
        captureWorkerStopRef.current = null;
        recordStateRef.current.stream?.getTracks().forEach((t) => t.stop());
        recordStateRef.current = { active: false, canvas: null, ctx: null, stream: null };
      },
    }));

    useEffect(() => {
      const container = mountRef.current;
      if (!container) return;

      const isSoftwareGl = (() => {
        try {
          const probe = document.createElement('canvas').getContext('webgl2');
          if (!probe) return true;
          const ext = probe.getExtension('WEBGL_debug_renderer_info');
          const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
          const gpu = String(probe.getParameter(param));
          probe.getExtension('WEBGL_lose_context')?.loseContext();
          return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
        } catch {
          return true;
        }
      })();

      const width = container.clientWidth || 720;
      const height = container.clientHeight || 420;

      const scene = new THREE.Scene();
      const initialLight = LIGHTING_PRESETS[stateRef.current.lightingMood];
      scene.background = new THREE.Color(initialLight.bg);
      scene.fog = new THREE.FogExp2(initialLight.fog, 0.042);

      const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 65);
      const initCam = CAMERA_PRESETS[stateRef.current.cameraPreset];
      camera.position.set(...initCam.pos);

      const renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.shadowMap.enabled = !isSoftwareGl;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      container.innerHTML = '';
      container.appendChild(renderer.domElement);
      renderer.domElement.style.display = 'block';
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';

      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;

      const pmremGenerator = new THREE.PMREMGenerator(renderer);
      const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envTexture;
      pmremGenerator.dispose();

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(...initCam.target);
      controls.enableDamping = !isSoftwareGl;
      controls.dampingFactor = 0.08;
      controls.minDistance = 1.3;
      controls.maxDistance = 9.8;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.minPolarAngle = Math.PI * 0.14;
      controls.enabled = stateRef.current.orbitUnlocked;

      const onOrbitStart = () => {
        stateRef.current.transitionCamera = false;
      };
      controls.addEventListener('start', onOrbitStart);

      // Lighting Rig
      const hemiLight = new THREE.HemisphereLight(
        initialLight.hemiSky,
        initialLight.hemiGround,
        initialLight.hemiIntensity,
      );
      scene.add(hemiLight);

      const keyLight = new THREE.DirectionalLight(initialLight.keyColor, initialLight.keyIntensity);
      keyLight.position.set(3.8, 5.8, 4.2);
      keyLight.castShadow = !isSoftwareGl;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 22;
      keyLight.shadow.camera.left = -5.4;
      keyLight.shadow.camera.right = 5.4;
      keyLight.shadow.camera.top = 5.4;
      keyLight.shadow.camera.bottom = -5.4;
      keyLight.shadow.bias = -0.0005;
      keyLight.shadow.normalBias = 0.02;
      scene.add(keyLight);

      const rimLight = new THREE.SpotLight(
        initialLight.rimColor,
        initialLight.rimIntensity,
        18,
        Math.PI / 4,
        0.58,
        1.15,
      );
      rimLight.position.set(-2.9, 4.4, -3.4);
      rimLight.target.position.set(0, 1.5, 0);
      scene.add(rimLight);
      scene.add(rimLight.target);

      const propPointLight = new THREE.PointLight(initialLight.accentColor, 2.5, 8.5, 1.5);
      propPointLight.position.set(-1.35, 1.65, 0.35);
      scene.add(propPointLight);

      const disposables: { dispose: () => void }[] = [envTexture];

      // Shared Procedural Textures & Materials
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const floorTex = createFloorStoneTexture();
      floorTex.anisotropy = maxAniso;
      const robeTex = createFabricTexture('#1c273b', 'rgba(255,255,255,0.035)');
      robeTex.anisotropy = maxAniso;
      const companionRobeTex = createFabricTexture('#3a251c', 'rgba(251,191,36,0.04)');
      companionRobeTex.anisotropy = maxAniso;
      const cloakTex = createFabricTexture('#101624', 'rgba(245,158,11,0.03)');
      cloakTex.anisotropy = maxAniso;
      const emberSpriteTex = createEmberSpriteTexture();
      const beamTex = createVolumetricBeamTexture();
      const shadowTex = createRadialShadowTexture();
      disposables.push(
        floorTex,
        robeTex,
        companionRobeTex,
        cloakTex,
        emberSpriteTex,
        beamTex,
        shadowTex,
      );

      const brassMat = new THREE.MeshStandardMaterial({ color: 0xdca032, roughness: 0.22, metalness: 0.92 });
      const darkBronzeMat = new THREE.MeshStandardMaterial({ color: 0x5c472c, roughness: 0.42, metalness: 0.78 });
      const stoneMat = new THREE.MeshStandardMaterial({ color: 0x283145, roughness: 0.86, metalness: 0.1 });
      const obsidianMat = new THREE.MeshStandardMaterial({ color: 0x161d2b, roughness: 0.46, metalness: 0.34 });
      const emberMat = new THREE.MeshStandardMaterial({
        color: 0xf59e0b,
        emissive: 0xf59e0b,
        emissiveIntensity: 1.4,
        roughness: 0.2,
        metalness: 0.2,
      });
      const runeMat = new THREE.MeshStandardMaterial({
        color: 0xfbbf24,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.85,
        roughness: 0.35,
        metalness: 0.6,
      });
      const shadowTitanMat = new THREE.MeshStandardMaterial({
        color: 0x090b12,
        roughness: 0.72,
        metalness: 0.35,
      });
      const crimsonGlowMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 1.7,
        roughness: 0.2,
      });
      disposables.push(
        brassMat,
        darkBronzeMat,
        stoneMat,
        obsidianMat,
        emberMat,
        runeMat,
        shadowTitanMat,
        crimsonGlowMat,
      );

      // Amphitheater Floor & Stepped Stone Dais (Wider platform for active figure locomotion)
      const floorGeo = new THREE.CircleGeometry(16, 64);
      const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0.14 });
      const floorMesh = new THREE.Mesh(floorGeo, floorMat);
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.receiveShadow = true;
      scene.add(floorMesh);
      disposables.push(floorGeo, floorMat);

      const lowerStepGeo = new THREE.CylinderGeometry(2.35, 2.55, 0.08, 48);
      const lowerStep = new THREE.Mesh(lowerStepGeo, stoneMat);
      lowerStep.position.y = 0.04;
      lowerStep.receiveShadow = true;
      scene.add(lowerStep);

      const daisGeo = new THREE.CylinderGeometry(1.92, 2.1, 0.12, 48);
      const daisMesh = new THREE.Mesh(daisGeo, obsidianMat);
      daisMesh.position.y = 0.1;
      daisMesh.receiveShadow = true;
      daisMesh.castShadow = true;
      scene.add(daisMesh);

      const daisRingGeo = new THREE.TorusGeometry(1.93, 0.024, 16, 72);
      const daisRing = new THREE.Mesh(daisRingGeo, brassMat);
      daisRing.rotation.x = Math.PI / 2;
      daisRing.position.y = 0.163;
      scene.add(daisRing);

      const daisInnerRuneGeo = new THREE.TorusGeometry(1.38, 0.012, 12, 64);
      const daisInnerRune = new THREE.Mesh(daisInnerRuneGeo, runeMat);
      daisInnerRune.rotation.x = Math.PI / 2;
      daisInnerRune.position.y = 0.164;
      scene.add(daisInnerRune);
      disposables.push(lowerStepGeo, daisGeo, daisRingGeo, daisInnerRuneGeo);

      // Perimeter Chamber Sconces & Distant Sanctuary Colonnade
      const sconceBaseGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.24, 8);
      const sconceFlameGeo = new THREE.OctahedronGeometry(0.048, 0);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
        const radius = 3.75;
        const sx = Math.cos(ang) * radius;
        const sz = Math.sin(ang) * radius;
        if (sz > 1.8 && Math.abs(sx) < 1.8) continue;
        const sconce = new THREE.Mesh(sconceBaseGeo, darkBronzeMat);
        sconce.position.set(sx, 0.12, sz);
        sconce.castShadow = true;
        const ember = new THREE.Mesh(sconceFlameGeo, emberMat);
        ember.position.set(sx, 0.29, sz);
        scene.add(sconce, ember);
      }
      disposables.push(sconceBaseGeo, sconceFlameGeo);

      const bgColGeo = new THREE.CylinderGeometry(0.24, 0.28, 5.2, 12);
      const bgCapGeo = new THREE.BoxGeometry(0.75, 0.24, 0.75);
      for (let i = -3; i <= 3; i++) {
        if (i === 0) continue;
        const angle = (i / 4) * Math.PI * 0.55 - Math.PI / 2;
        const r = 7.6;
        const bx = Math.cos(angle) * r;
        const bz = Math.sin(angle) * r;
        const pillar = new THREE.Mesh(bgColGeo, stoneMat);
        pillar.position.set(bx, 2.6, bz);
        const cap = new THREE.Mesh(bgCapGeo, stoneMat);
        cap.position.set(bx, 5.25, bz);
        scene.add(pillar, cap);
      }
      disposables.push(bgColGeo, bgCapGeo);

      // Volumetric Spotlight Cones
      const keyBeamGeo = new THREE.ConeGeometry(1.9, 6.4, 32, 1, true);
      const keyBeamMat = new THREE.MeshBasicMaterial({
        color: initialLight.keyColor,
        alphaMap: beamTex,
        transparent: true,
        opacity: initialLight.beamOpacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const keyBeam = new THREE.Mesh(keyBeamGeo, keyBeamMat);
      keyBeam.position.set(1.25, 3.1, 1.35);
      keyBeam.rotation.z = 0.34;
      keyBeam.rotation.x = -0.32;
      scene.add(keyBeam);

      const rimBeamGeo = new THREE.ConeGeometry(1.55, 5.8, 32, 1, true);
      const rimBeamMat = new THREE.MeshBasicMaterial({
        color: initialLight.rimColor,
        alphaMap: beamTex,
        transparent: true,
        opacity: initialLight.beamOpacity * 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const rimBeam = new THREE.Mesh(rimBeamGeo, rimBeamMat);
      rimBeam.position.set(-1.1, 2.85, -1.35);
      rimBeam.rotation.z = -0.32;
      rimBeam.rotation.x = 0.34;
      scene.add(rimBeam);
      disposables.push(keyBeamGeo, keyBeamMat, rimBeamGeo, rimBeamMat);

      // Rising Floating Golden Embers / Sparks
      const particleCount = 80;
      const particlePos = new Float32Array(particleCount * 3);
      const particleSeed = new Float32Array(particleCount * 3);
      for (let i = 0; i < particleCount; i++) {
        const ang = Math.random() * Math.PI * 2;
        const rad = 0.45 + Math.random() * 3.5;
        particlePos[i * 3] = Math.cos(ang) * rad;
        particlePos[i * 3 + 1] = 0.25 + Math.random() * 3.8;
        particlePos[i * 3 + 2] = Math.sin(ang) * rad;
        particleSeed[i * 3] = 0.18 + Math.random() * 0.32;
        particleSeed[i * 3 + 1] = Math.random() * Math.PI * 2;
        particleSeed[i * 3 + 2] = 0.16 + Math.random() * 0.38;
      }
      const emberGeo = new THREE.BufferGeometry();
      const emberPosAttr = new THREE.BufferAttribute(particlePos, 3);
      emberGeo.setAttribute('position', emberPosAttr);
      const emberPointsMat = new THREE.PointsMaterial({
        size: 0.088,
        map: emberSpriteTex,
        color: initialLight.accentColor,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const emberPoints = new THREE.Points(emberGeo, emberPointsMat);
      scene.add(emberPoints);
      disposables.push(emberGeo, emberPointsMat);

      // Shared Articulated Character Materials & Geometries
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xdca888, roughness: 0.58, metalness: 0.04 });
      const companionSkinMat = new THREE.MeshStandardMaterial({ color: 0xc48f6e, roughness: 0.6, metalness: 0.04 });
      const heroRobeMat = new THREE.MeshStandardMaterial({ map: robeTex, color: 0x22304a, roughness: 0.76, metalness: 0.08 });
      const companionRobeMat = new THREE.MeshStandardMaterial({
        map: companionRobeTex,
        color: 0x6b3a28,
        roughness: 0.78,
        metalness: 0.08,
      });
      const cloakMat = new THREE.MeshStandardMaterial({ map: cloakTex, color: 0x101726, roughness: 0.86, metalness: 0.06 });
      const lipMat = new THREE.MeshStandardMaterial({ color: 0x9e5447, roughness: 0.42, metalness: 0.05 });
      const innerMouthMat = new THREE.MeshStandardMaterial({ color: 0x1f0c0d, roughness: 0.9 });
      const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.18 });
      const irisMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.12, metalness: 0.15 });
      const hairMat = new THREE.MeshStandardMaterial({ color: 0x231d19, roughness: 0.74, metalness: 0.08 });
      disposables.push(
        skinMat,
        companionSkinMat,
        heroRobeMat,
        companionRobeMat,
        cloakMat,
        lipMat,
        innerMouthMat,
        eyeWhiteMat,
        irisMat,
        hairMat,
      );

      // Shared Humanoid Part Geometries (reused efficiently across Hero & Companion)
      const pelvisGeo = new THREE.CylinderGeometry(0.21, 0.23, 0.16, 18);
      const thighGeo = new THREE.CylinderGeometry(0.082, 0.068, 0.42, 14);
      const shinGeo = new THREE.CylinderGeometry(0.065, 0.052, 0.4, 14);
      const bootGeo = new THREE.CapsuleGeometry(0.062, 0.13, 8, 14);
      const splitTunicPanelGeo = new THREE.CylinderGeometry(0.22, 0.3, 0.56, 16, 1, true, Math.PI * 0.42, Math.PI * 1.16);
      const beltGeo = new THREE.CylinderGeometry(0.24, 0.235, 0.085, 22);
      const buckleGeo = new THREE.TorusGeometry(0.056, 0.013, 8, 20);
      const chestGeo = new THREE.CylinderGeometry(0.275, 0.22, 0.55, 24);
      const mantleGeo = new THREE.TorusGeometry(0.265, 0.068, 12, 30, Math.PI * 1.48);
      const collarGeo = new THREE.CylinderGeometry(0.155, 0.19, 0.13, 20, 1, true, Math.PI * 0.68, Math.PI * 1.64);
      const capeGeo = new THREE.CylinderGeometry(0.21, 0.44, 1.24, 16, 1, false, Math.PI * 0.72, Math.PI * 0.56);
      const medallionRingGeo = new THREE.TorusGeometry(0.058, 0.009, 8, 24);
      const medallionGeo = new THREE.OctahedronGeometry(0.04, 0);
      const neckGeo = new THREE.CylinderGeometry(0.078, 0.095, 0.13, 16);
      const craniumGeo = new THREE.SphereGeometry(0.192, 24, 20);
      const earGeo = new THREE.SphereGeometry(0.033, 10, 10);
      const hairGeo = new THREE.SphereGeometry(0.2, 22, 18, 0, Math.PI * 2, 0, Math.PI * 0.58);
      const noseGeo = new THREE.ConeGeometry(0.024, 0.084, 10);
      const eyeGeo = new THREE.SphereGeometry(0.024, 14, 14);
      const irisGeo = new THREE.SphereGeometry(0.013, 10, 10);
      const lidGeo = new THREE.SphereGeometry(0.0265, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55);
      const browGeo = new THREE.BoxGeometry(0.055, 0.013, 0.018);
      const cavityGeo = new THREE.BoxGeometry(0.058, 0.034, 0.03);
      const upperLipGeo = new THREE.BoxGeometry(0.068, 0.015, 0.024);
      const lowerJawGeo = new THREE.SphereGeometry(0.14, 18, 14, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
      const lowerLipGeo = new THREE.BoxGeometry(0.064, 0.015, 0.024);
      const beardGeo = new THREE.ConeGeometry(0.105, 0.125, 14);
      const shoulderGeo = new THREE.SphereGeometry(0.082, 14, 14);
      const pauldronTrimGeo = new THREE.TorusGeometry(0.08, 0.011, 8, 16);
      const upperArmGeo = new THREE.CylinderGeometry(0.053, 0.045, 0.29, 12);
      const forearmGeo = new THREE.CylinderGeometry(0.045, 0.036, 0.26, 12);
      const cuffGeo = new THREE.CylinderGeometry(0.043, 0.04, 0.042, 12);
      const palmGeo = new THREE.BoxGeometry(0.04, 0.068, 0.06);
      const fingersGeo = new THREE.BoxGeometry(0.034, 0.064, 0.054);
      const thumbGeo = new THREE.CapsuleGeometry(0.011, 0.03, 6, 8);
      const contactGeo = new THREE.PlaneGeometry(1.35, 1.35);

      const doubleCloakMat = cloakMat.clone();
      doubleCloakMat.side = THREE.DoubleSide;
      const doubleRobeMat = heroRobeMat.clone();
      doubleRobeMat.side = THREE.DoubleSide;

      disposables.push(
        pelvisGeo,
        thighGeo,
        shinGeo,
        bootGeo,
        splitTunicPanelGeo,
        beltGeo,
        buckleGeo,
        chestGeo,
        mantleGeo,
        collarGeo,
        capeGeo,
        medallionRingGeo,
        medallionGeo,
        neckGeo,
        craniumGeo,
        earGeo,
        hairGeo,
        noseGeo,
        eyeGeo,
        irisGeo,
        lidGeo,
        browGeo,
        cavityGeo,
        upperLipGeo,
        lowerJawGeo,
        lowerLipGeo,
        beardGeo,
        shoulderGeo,
        pauldronTrimGeo,
        upperArmGeo,
        forearmGeo,
        cuffGeo,
        palmGeo,
        fingersGeo,
        thumbGeo,
        contactGeo,
        doubleCloakMat,
        doubleRobeMat,
      );

      function buildArticulatedActor(opts: {
        robe: THREE.MeshStandardMaterial;
        skin: THREE.MeshStandardMaterial;
        withBeard: boolean;
        withMedallion: boolean;
      }) {
        const root = new THREE.Group();
        root.position.set(0, 0.16, 0);
        scene.add(root);

        const contactMat = new THREE.MeshBasicMaterial({
          map: shadowTex,
          transparent: true,
          depthWrite: false,
          opacity: 0.56,
        });
        disposables.push(contactMat);
        const shadow = new THREE.Mesh(contactGeo, contactMat);
        shadow.rotation.x = -Math.PI / 2;
        shadow.position.y = 0.008;
        root.add(shadow);

        // Pelvis sits at y = 0.88 above actor foot-ground plane
        const pelvisGroup = new THREE.Group();
        pelvisGroup.position.y = 0.88;
        root.add(pelvisGroup);

        const pelvisMesh = new THREE.Mesh(pelvisGeo, cloakMat);
        pelvisMesh.castShadow = true;
        pelvisGroup.add(pelvisMesh);

        // Split Open-Front Tunic Skirt so moving thighs/knees/boots are visibly clear!
        const tunicWrap = new THREE.Mesh(splitTunicPanelGeo, doubleRobeMat);
        tunicWrap.position.y = -0.26;
        tunicWrap.castShadow = true;
        pelvisGroup.add(tunicWrap);

        // Articulated Legs (Hip -> Thigh -> Knee -> Shin -> Boot)
        function buildLeg(side: -1 | 1) {
          const hipPivot = new THREE.Group();
          hipPivot.position.set(side * 0.125, -0.04, 0);
          pelvisGroup.add(hipPivot);

          const thigh = new THREE.Mesh(thighGeo, cloakMat);
          thigh.position.y = -0.21;
          thigh.castShadow = true;
          hipPivot.add(thigh);

          const kneePivot = new THREE.Group();
          kneePivot.position.y = -0.42;
          hipPivot.add(kneePivot);

          const shin = new THREE.Mesh(shinGeo, cloakMat);
          shin.position.y = -0.2;
          shin.castShadow = true;
          kneePivot.add(shin);

          const boot = new THREE.Mesh(bootGeo, darkBronzeMat);
          boot.position.set(0, -0.38, 0.055);
          boot.rotation.x = Math.PI / 2;
          boot.castShadow = true;
          kneePivot.add(boot);

          return { hipPivot, kneePivot };
        }
        const leftLeg = buildLeg(-1);
        const rightLeg = buildLeg(1);

        // Upper Torso Pivot
        const torsoPivot = new THREE.Group();
        torsoPivot.position.y = 0.06;
        pelvisGroup.add(torsoPivot);

        const beltMesh = new THREE.Mesh(beltGeo, cloakMat);
        beltMesh.position.y = 0.025;
        const buckleMesh = new THREE.Mesh(buckleGeo, brassMat);
        buckleMesh.position.set(0, 0.025, 0.232);
        torsoPivot.add(beltMesh, buckleMesh);

        const chestMesh = new THREE.Mesh(chestGeo, opts.robe);
        chestMesh.position.y = 0.31;
        chestMesh.scale.set(1.06, 1, 0.82);
        chestMesh.castShadow = true;
        torsoPivot.add(chestMesh);

        const mantleMesh = new THREE.Mesh(mantleGeo, cloakMat);
        mantleMesh.rotation.x = Math.PI / 2;
        mantleMesh.rotation.z = -Math.PI * 0.24;
        mantleMesh.position.set(0, 0.55, -0.02);
        mantleMesh.castShadow = true;

        const collarMesh = new THREE.Mesh(collarGeo, doubleCloakMat);
        collarMesh.position.set(0, 0.62, -0.02);
        torsoPivot.add(mantleMesh, collarMesh);

        const capePivot = new THREE.Group();
        capePivot.position.set(0, 0.54, -0.2);
        torsoPivot.add(capePivot);
        const capeMesh = new THREE.Mesh(capeGeo, doubleCloakMat);
        capeMesh.position.set(0, -0.6, 0.02);
        capeMesh.castShadow = true;
        capePivot.add(capeMesh);

        let medallionGroup: THREE.Group | null = null;
        let medallionMesh: THREE.Mesh | null = null;
        if (opts.withMedallion) {
          medallionGroup = new THREE.Group();
          medallionGroup.position.set(0, 0.41, 0.228);
          const mRing = new THREE.Mesh(medallionRingGeo, brassMat);
          medallionMesh = new THREE.Mesh(medallionGeo, emberMat);
          medallionGroup.add(mRing, medallionMesh);
          torsoPivot.add(medallionGroup);
        }

        const neckMesh = new THREE.Mesh(neckGeo, opts.skin);
        neckMesh.position.y = 0.64;
        torsoPivot.add(neckMesh);

        const headPivot = new THREE.Group();
        headPivot.position.set(0, 0.71, 0);
        torsoPivot.add(headPivot);

        const craniumMesh = new THREE.Mesh(craniumGeo, opts.skin);
        craniumMesh.position.y = 0.16;
        craniumMesh.scale.set(0.9, 1.06, 0.96);
        craniumMesh.castShadow = true;
        headPivot.add(craniumMesh);

        const leftEar = new THREE.Mesh(earGeo, opts.skin);
        leftEar.position.set(-0.17, 0.15, -0.01);
        leftEar.scale.set(0.45, 1, 0.72);
        const rightEar = new THREE.Mesh(earGeo, opts.skin);
        rightEar.position.set(0.17, 0.15, -0.01);
        rightEar.scale.set(0.45, 1, 0.72);
        headPivot.add(leftEar, rightEar);

        const hairMesh = new THREE.Mesh(hairGeo, hairMat);
        hairMesh.position.set(0, 0.18, -0.015);
        hairMesh.rotation.x = -0.24;
        hairMesh.scale.set(0.94, 1.06, 1.01);
        headPivot.add(hairMesh);

        const noseMesh = new THREE.Mesh(noseGeo, opts.skin);
        noseMesh.position.set(0, 0.15, 0.188);
        noseMesh.rotation.x = Math.PI * 0.38;
        headPivot.add(noseMesh);

        const leftEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
        leftEye.position.set(-0.064, 0.194, 0.16);
        const leftIris = new THREE.Mesh(irisGeo, irisMat);
        leftIris.position.set(0, 0, 0.016);
        leftEye.add(leftIris);

        const leftLid = new THREE.Mesh(lidGeo, opts.skin);
        leftLid.position.set(-0.064, 0.194, 0.16);
        leftLid.rotation.x = -0.78;

        const rightEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
        rightEye.position.set(0.064, 0.194, 0.16);
        const rightIris = new THREE.Mesh(irisGeo, irisMat);
        rightIris.position.set(0, 0, 0.016);
        rightEye.add(rightIris);

        const rightLid = new THREE.Mesh(lidGeo, opts.skin);
        rightLid.position.set(0.064, 0.194, 0.16);
        rightLid.rotation.x = -0.78;

        const leftBrow = new THREE.Mesh(browGeo, hairMat);
        leftBrow.position.set(-0.064, 0.236, 0.168);
        const rightBrow = new THREE.Mesh(browGeo, hairMat);
        rightBrow.position.set(0.064, 0.236, 0.168);

        headPivot.add(leftEye, rightEye, leftLid, rightLid, leftBrow, rightBrow);

        const mouthCavity = new THREE.Mesh(cavityGeo, innerMouthMat);
        mouthCavity.position.set(0, 0.075, 0.158);
        const upperLip = new THREE.Mesh(upperLipGeo, lipMat);
        upperLip.position.set(0, 0.088, 0.172);
        headPivot.add(mouthCavity, upperLip);

        const jawPivot = new THREE.Group();
        jawPivot.position.set(0, 0.084, 0.038);
        headPivot.add(jawPivot);

        const lowerJawMesh = new THREE.Mesh(lowerJawGeo, opts.skin);
        lowerJawMesh.position.set(0, 0.01, 0.02);
        lowerJawMesh.scale.set(0.85, 0.85, 0.96);
        jawPivot.add(lowerJawMesh);

        const lowerLip = new THREE.Mesh(lowerLipGeo, lipMat);
        lowerLip.position.set(0, -0.012, 0.132);
        jawPivot.add(lowerLip);

        if (opts.withBeard) {
          const beardMesh = new THREE.Mesh(beardGeo, hairMat);
          beardMesh.position.set(0, -0.066, 0.062);
          beardMesh.rotation.x = Math.PI;
          beardMesh.scale.set(0.95, 1, 0.72);
          jawPivot.add(beardMesh);
        }

        function buildArm(side: -1 | 1) {
          const shoulderPivot = new THREE.Group();
          shoulderPivot.position.set(side * 0.32, 0.5, 0);

          const shoulderCap = new THREE.Mesh(shoulderGeo, cloakMat);
          shoulderCap.scale.set(1.05, 0.95, 1.1);
          shoulderCap.castShadow = true;
          shoulderPivot.add(shoulderCap);

          const pauldronTrim = new THREE.Mesh(pauldronTrimGeo, brassMat);
          pauldronTrim.rotation.y = Math.PI / 2;
          shoulderPivot.add(pauldronTrim);

          const upperArm = new THREE.Mesh(upperArmGeo, opts.robe);
          upperArm.position.y = -0.145;
          upperArm.castShadow = true;
          shoulderPivot.add(upperArm);

          const elbowPivot = new THREE.Group();
          elbowPivot.position.y = -0.29;
          shoulderPivot.add(elbowPivot);

          const forearm = new THREE.Mesh(forearmGeo, opts.robe);
          forearm.position.y = -0.13;
          forearm.castShadow = true;
          elbowPivot.add(forearm);

          const cuff = new THREE.Mesh(cuffGeo, brassMat);
          cuff.position.y = -0.245;
          elbowPivot.add(cuff);

          const wristPivot = new THREE.Group();
          wristPivot.position.y = -0.275;
          elbowPivot.add(wristPivot);

          const palm = new THREE.Mesh(palmGeo, opts.skin);
          palm.position.y = -0.036;
          wristPivot.add(palm);

          const fingers = new THREE.Mesh(fingersGeo, opts.skin);
          fingers.position.set(0, -0.09, 0.01);
          fingers.rotation.x = 0.25;
          wristPivot.add(fingers);

          const thumb = new THREE.Mesh(thumbGeo, opts.skin);
          thumb.position.set(-side * 0.02, -0.034, 0.032);
          thumb.rotation.x = 0.5;
          thumb.rotation.z = side * 0.45;
          wristPivot.add(thumb);

          const propMount = new THREE.Group();
          propMount.position.set(0, -0.068, 0.035);
          wristPivot.add(propMount);

          torsoPivot.add(shoulderPivot);
          return { shoulderPivot, elbowPivot, wristPivot, propMount };
        }

        const leftArm = buildArm(-1);
        const rightArm = buildArm(1);

        return {
          root,
          pelvisGroup,
          torsoPivot,
          headPivot,
          jawPivot,
          upperLip,
          lowerLip,
          leftLid,
          rightLid,
          leftIris,
          rightIris,
          leftBrow,
          rightBrow,
          capePivot,
          leftLeg,
          rightLeg,
          leftArm,
          rightArm,
          medallionGroup,
          medallionMesh,
        };
      }

      // Build Hero + Companion Story Figures
      const hero = buildArticulatedActor({
        robe: heroRobeMat,
        skin: skinMat,
        withBeard: true,
        withMedallion: true,
      });

      const companion = buildArticulatedActor({
        robe: companionRobeMat,
        skin: companionSkinMat,
        withBeard: false,
        withMedallion: false,
      });
      companion.root.scale.setScalar(0.92);
      companion.root.position.set(-1.15, 0.16, -0.2);

      // Build Dynamic Hero Hand Props (mounted on hero's right & left hands)
      const hammerGroup = new THREE.Group();
      const handleGeo = new THREE.CylinderGeometry(0.018, 0.02, 0.58, 10);
      const hammerHeadGeo = new THREE.BoxGeometry(0.22, 0.12, 0.12);
      const hammerHandle = new THREE.Mesh(handleGeo, darkBronzeMat);
      hammerHandle.rotation.x = Math.PI / 2;
      hammerHandle.position.z = 0.18;
      const hammerHead = new THREE.Mesh(hammerHeadGeo, brassMat);
      hammerHead.position.z = 0.44;
      hammerHead.castShadow = true;
      hammerGroup.add(hammerHandle, hammerHead);
      hero.rightArm.propMount.add(hammerGroup);

      const torchGroup = new THREE.Group();
      const torchShaft = new THREE.Mesh(handleGeo, darkBronzeMat);
      torchShaft.rotation.x = Math.PI / 2;
      torchShaft.position.z = 0.14;
      const torchBowlGeo = new THREE.CylinderGeometry(0.065, 0.035, 0.11, 12);
      const torchBowl = new THREE.Mesh(torchBowlGeo, brassMat);
      torchBowl.rotation.x = Math.PI / 2;
      torchBowl.position.z = 0.42;
      const torchFlameGeo = new THREE.OctahedronGeometry(0.068, 0);
      const torchFlame = new THREE.Mesh(torchFlameGeo, emberMat);
      torchFlame.position.z = 0.51;
      torchGroup.add(torchShaft, torchBowl, torchFlame);
      hero.rightArm.propMount.add(torchGroup);

      const staffGroup = new THREE.Group();
      const staffPoleGeo = new THREE.CylinderGeometry(0.02, 0.022, 1.85, 12);
      const staffPole = new THREE.Mesh(staffPoleGeo, darkBronzeMat);
      staffPole.rotation.x = Math.PI / 2;
      staffPole.position.z = 0.25;
      const spearTipGeo = new THREE.OctahedronGeometry(0.075, 0);
      const spearTip = new THREE.Mesh(spearTipGeo, emberMat);
      spearTip.scale.set(0.7, 0.7, 1.8);
      spearTip.position.z = 1.22;
      staffGroup.add(staffPole, spearTip);
      hero.rightArm.propMount.add(staffGroup);

      const scrollPropGroup = new THREE.Group();
      const handScrollGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.28, 12);
      const parchmentMat = new THREE.MeshStandardMaterial({ color: 0xe8d9bc, roughness: 0.62, metalness: 0.04 });
      const handScroll = new THREE.Mesh(handScrollGeo, parchmentMat);
      handScroll.rotation.z = Math.PI / 2;
      scrollPropGroup.add(handScroll);
      hero.leftArm.propMount.add(scrollPropGroup);

      disposables.push(
        handleGeo,
        hammerHeadGeo,
        torchBowlGeo,
        torchFlameGeo,
        staffPoleGeo,
        spearTipGeo,
        handScrollGeo,
        parchmentMat,
      );

      // ------------------------------------------------------------------
      // Activity-Specific Dynamic Stage Props & Adversary Sentinel
      // ------------------------------------------------------------------

      // 1) Forge Labor Cluster: Stone Hearth Plinth + Anvil + Glowing Ingot + Impact Burst Ring
      const forgeCluster = new THREE.Group();
      const anvilBaseGeo = new THREE.BoxGeometry(0.55, 0.55, 0.48);
      const anvilHornGeo = new THREE.BoxGeometry(0.72, 0.18, 0.28);
      const ingotGeo = new THREE.BoxGeometry(0.28, 0.08, 0.14);
      const sparkBurstGeo = new THREE.TorusGeometry(0.26, 0.015, 8, 24);
      const anvilBase = new THREE.Mesh(anvilBaseGeo, stoneMat);
      anvilBase.position.set(0.25, 0.435, 0.15);
      anvilBase.castShadow = true;
      const anvilTop = new THREE.Mesh(anvilHornGeo, obsidianMat);
      anvilTop.position.set(0.25, 0.8, 0.15);
      anvilTop.castShadow = true;
      const hotIngot = new THREE.Mesh(ingotGeo, emberMat);
      hotIngot.position.set(0.25, 0.92, 0.15);
      const sparkBurst = new THREE.Mesh(sparkBurstGeo, emberMat);
      sparkBurst.rotation.x = Math.PI / 2;
      sparkBurst.position.set(0.25, 0.94, 0.15);
      forgeCluster.add(anvilBase, anvilTop, hotIngot, sparkBurst);
      scene.add(forgeCluster);
      disposables.push(anvilBaseGeo, anvilHornGeo, ingotGeo, sparkBurstGeo);

      // 2) Climb Ascent Cluster: 4 Illuminated Ascending Stone Steps
      const stepsCluster = new THREE.Group();
      const stepBlockGeo = new THREE.BoxGeometry(1.1, 0.22, 0.55);
      const stepTrimGeo = new THREE.BoxGeometry(1.12, 0.03, 0.05);
      for (let s = 0; s < 4; s++) {
        const stMesh = new THREE.Mesh(stepBlockGeo, stoneMat);
        stMesh.position.set(-0.65 + s * 0.46, 0.27 + s * 0.22, 0.15 - s * 0.18);
        stMesh.castShadow = true;
        stMesh.receiveShadow = true;
        const stTrim = new THREE.Mesh(stepTrimGeo, runeMat);
        stTrim.position.set(-0.65 + s * 0.46, 0.385 + s * 0.22, 0.42 - s * 0.18);
        stepsCluster.add(stMesh, stTrim);
      }
      scene.add(stepsCluster);
      disposables.push(stepBlockGeo, stepTrimGeo);

      // 3) Duel Overcome Cluster: Towering Articulated Shadow Guardian / Adversary
      const duelCluster = new THREE.Group();
      const sentinelRoot = new THREE.Group();
      sentinelRoot.position.set(0.95, 0.16, -0.05);
      sentinelRoot.rotation.y = -Math.PI * 0.42;

      const sentBodyGeo = new THREE.ConeGeometry(0.42, 1.45, 7);
      const sentChestGeo = new THREE.BoxGeometry(0.62, 0.65, 0.38);
      const sentHeadGeo = new THREE.OctahedronGeometry(0.21, 0);
      const sentHornGeo = new THREE.ConeGeometry(0.06, 0.34, 6);
      const sentEyeGeo = new THREE.BoxGeometry(0.07, 0.03, 0.04);
      const sentBladeGeo = new THREE.ConeGeometry(0.065, 0.95, 4);

      const sentBody = new THREE.Mesh(sentBodyGeo, shadowTitanMat);
      sentBody.position.y = 0.72;
      sentBody.castShadow = true;
      const sentTorso = new THREE.Group();
      sentTorso.position.y = 1.25;
      const sentChest = new THREE.Mesh(sentChestGeo, shadowTitanMat);
      sentChest.position.y = 0.25;
      sentChest.castShadow = true;
      const sentHead = new THREE.Mesh(sentHeadGeo, shadowTitanMat);
      sentHead.position.y = 0.72;
      const hornL = new THREE.Mesh(sentHornGeo, shadowTitanMat);
      hornL.position.set(-0.15, 0.9, 0);
      hornL.rotation.z = 0.35;
      const hornR = new THREE.Mesh(sentHornGeo, shadowTitanMat);
      hornR.position.set(0.15, 0.9, 0);
      hornR.rotation.z = -0.35;
      const eyeL = new THREE.Mesh(sentEyeGeo, crimsonGlowMat);
      eyeL.position.set(-0.07, 0.74, 0.16);
      const eyeR = new THREE.Mesh(sentEyeGeo, crimsonGlowMat);
      eyeR.position.set(0.07, 0.74, 0.16);

      const sentArmPivot = new THREE.Group();
      sentArmPivot.position.set(-0.38, 0.45, 0);
      const sentBlade = new THREE.Mesh(sentBladeGeo, crimsonGlowMat);
      sentBlade.rotation.x = Math.PI / 2;
      sentBlade.position.set(0, -0.15, 0.48);
      sentArmPivot.add(sentBlade);

      sentTorso.add(sentChest, sentHead, hornL, hornR, eyeL, eyeR, sentArmPivot);
      sentinelRoot.add(sentBody, sentTorso);
      duelCluster.add(sentinelRoot);
      scene.add(duelCluster);
      disposables.push(
        sentBodyGeo,
        sentChestGeo,
        sentHeadGeo,
        sentHornGeo,
        sentEyeGeo,
        sentBladeGeo,
      );

      // ------------------------------------------------------------------
      // 3 Switchable Cinematic Stage Environments
      // ------------------------------------------------------------------
      const pillarSet = new THREE.Group();
      const colPlinthGeo = new THREE.BoxGeometry(0.68, 0.22, 0.68);
      const colShaftGeo = new THREE.CylinderGeometry(0.22, 0.26, 2.5, 20);
      const colCapitalGeo = new THREE.BoxGeometry(0.66, 0.18, 0.66);
      const lintelGeo = new THREE.BoxGeometry(4.1, 0.32, 0.64);
      const brazierPedestalGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.08, 12);
      const brazierBowlGeo = new THREE.CylinderGeometry(0.32, 0.14, 0.2, 16);
      const astrolabeRing1Geo = new THREE.TorusGeometry(0.28, 0.015, 10, 32);
      const astrolabeRing2Geo = new THREE.TorusGeometry(0.21, 0.012, 10, 28);
      const flameCoreGeo = new THREE.OctahedronGeometry(0.085, 0);
      disposables.push(
        colPlinthGeo,
        colShaftGeo,
        colCapitalGeo,
        lintelGeo,
        brazierPedestalGeo,
        brazierBowlGeo,
        astrolabeRing1Geo,
        astrolabeRing2Geo,
        flameCoreGeo,
      );

      [-1.75, 1.75].forEach((px) => {
        const plinth = new THREE.Mesh(colPlinthGeo, stoneMat);
        plinth.position.set(px, 0.11, -1.65);
        plinth.castShadow = true;
        plinth.receiveShadow = true;
        const shaft = new THREE.Mesh(colShaftGeo, stoneMat);
        shaft.position.set(px, 1.45, -1.65);
        shaft.castShadow = true;
        const cap = new THREE.Mesh(colCapitalGeo, stoneMat);
        cap.position.set(px, 2.79, -1.65);
        const trimBand = new THREE.Mesh(colCapitalGeo, brassMat);
        trimBand.scale.set(0.92, 0.25, 0.92);
        trimBand.position.set(px, 2.68, -1.65);
        pillarSet.add(plinth, shaft, cap, trimBand);
      });
      const archLintel = new THREE.Mesh(lintelGeo, obsidianMat);
      archLintel.position.set(0, 3.04, -1.65);
      const archTrim = new THREE.Mesh(lintelGeo, brassMat);
      archTrim.scale.set(1.01, 0.14, 1.03);
      archTrim.position.set(0, 2.89, -1.65);
      const brazierPedestal = new THREE.Mesh(brazierPedestalGeo, stoneMat);
      brazierPedestal.position.set(-1.55, 0.54, -0.55);
      const brazierBowl = new THREE.Mesh(brazierBowlGeo, darkBronzeMat);
      brazierBowl.position.set(-1.55, 1.18, -0.55);
      const astrolabeRing1 = new THREE.Mesh(astrolabeRing1Geo, brassMat);
      astrolabeRing1.position.set(-1.55, 1.62, -0.55);
      const astrolabeRing2 = new THREE.Mesh(astrolabeRing2Geo, brassMat);
      astrolabeRing2.position.set(-1.55, 1.62, -0.55);
      const lanternCore = new THREE.Mesh(flameCoreGeo, emberMat);
      lanternCore.position.set(-1.55, 1.62, -0.55);
      pillarSet.add(
        archLintel,
        archTrim,
        brazierPedestal,
        brazierBowl,
        astrolabeRing1,
        astrolabeRing2,
        lanternCore,
      );
      scene.add(pillarSet);

      const summitSet = new THREE.Group();
      const rockGeo = new THREE.DodecahedronGeometry(0.68, 0);
      const spireGeo = new THREE.ConeGeometry(0.65, 2.8, 5);
      const rockMat = new THREE.MeshStandardMaterial({ color: 0x21293a, roughness: 0.92, metalness: 0.08 });
      const eclipseHaloGeo = new THREE.RingGeometry(1.35, 1.52, 48);
      const eclipseDiscGeo = new THREE.CircleGeometry(1.32, 48);
      const eclipseHaloMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.72,
        side: THREE.DoubleSide,
      });
      const eclipseDiscMat = new THREE.MeshBasicMaterial({ color: 0x0b0e18, side: THREE.DoubleSide });
      const beaconGeo = new THREE.ConeGeometry(0.22, 1.85, 6);
      const poleGeo = new THREE.CylinderGeometry(0.025, 0.03, 2.6, 10);
      const bannerGeo = new THREE.PlaneGeometry(0.55, 1.1, 6, 8);
      const bannerMat = new THREE.MeshStandardMaterial({
        color: 0x9a3412,
        roughness: 0.75,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });
      disposables.push(
        rockGeo,
        spireGeo,
        rockMat,
        eclipseHaloGeo,
        eclipseDiscGeo,
        eclipseHaloMat,
        eclipseDiscMat,
        beaconGeo,
        poleGeo,
        bannerGeo,
        bannerMat,
      );

      [
        [-2.05, 0.42, -1.15, 1.35, 1.5, 1.1],
        [2.08, 0.35, -1.25, 1.25, 1.15, 1.35],
        [-3.2, 0.9, -2.8, 2.4, 2.8, 1.8],
        [3.1, 0.85, -3.1, 2.3, 2.4, 1.9],
      ].forEach(([x, y, z, sx, sy, sz]) => {
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.set(x, y, z);
        rock.scale.set(sx, sy, sz);
        summitSet.add(rock);
      });
      [
        [-2.4, -4.4, 1.3],
        [0.4, -5.2, 1.6],
        [2.5, -4.2, 1.2],
      ].forEach(([sx, sz, scaleY]) => {
        const spire = new THREE.Mesh(spireGeo, rockMat);
        spire.position.set(sx, 1.3 * scaleY, sz);
        spire.scale.set(1.2, scaleY, 1.0);
        summitSet.add(spire);
      });
      const eclipseDisc = new THREE.Mesh(eclipseDiscGeo, eclipseDiscMat);
      eclipseDisc.position.set(0, 2.55, -4.6);
      const eclipseHalo = new THREE.Mesh(eclipseHaloGeo, eclipseHaloMat);
      eclipseHalo.position.set(0, 2.55, -4.58);
      const beaconMesh = new THREE.Mesh(beaconGeo, stoneMat);
      beaconMesh.position.set(-1.6, 0.92, -0.55);
      const beaconOrb = new THREE.Mesh(flameCoreGeo, emberMat);
      beaconOrb.position.set(-1.6, 2.02, -0.55);
      const bannerPole = new THREE.Mesh(poleGeo, brassMat);
      bannerPole.position.set(1.65, 1.3, -0.85);
      const bannerCross = new THREE.Mesh(poleGeo, brassMat);
      bannerCross.scale.set(0.7, 0.25, 0.7);
      bannerCross.rotation.z = Math.PI / 2;
      bannerCross.position.set(1.92, 2.45, -0.85);
      const bannerMesh = new THREE.Mesh(bannerGeo, bannerMat);
      bannerMesh.position.set(1.92, 1.88, -0.85);
      summitSet.add(eclipseDisc, eclipseHalo, beaconMesh, beaconOrb, bannerPole, bannerCross, bannerMesh);
      scene.add(summitSet);

      const archiveSet = new THREE.Group();
      const woodMat = new THREE.MeshStandardMaterial({ color: 0x3a281f, roughness: 0.68, metalness: 0.14 });
      const bookGeo = new THREE.BoxGeometry(0.06, 0.24, 0.19);
      const bookMat = new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.1 });
      const lecternBaseGeo = new THREE.BoxGeometry(0.56, 1.05, 0.44);
      const lecternSlopeGeo = new THREE.BoxGeometry(0.68, 0.06, 0.48);
      const tomePageGeo = new THREE.BoxGeometry(0.46, 0.035, 0.32);
      const shelfFrameGeo = new THREE.BoxGeometry(1.45, 2.7, 0.38);
      const scrollGeo = new THREE.CylinderGeometry(0.048, 0.048, 0.38, 16);
      const scrollCapGeo = new THREE.CylinderGeometry(0.056, 0.056, 0.04, 12);
      const candleStemGeo = new THREE.CylinderGeometry(0.025, 0.04, 0.55, 10);
      disposables.push(
        woodMat,
        bookGeo,
        bookMat,
        lecternBaseGeo,
        lecternSlopeGeo,
        tomePageGeo,
        shelfFrameGeo,
        scrollGeo,
        scrollCapGeo,
        candleStemGeo,
      );

      const lecternBase = new THREE.Mesh(lecternBaseGeo, woodMat);
      lecternBase.position.set(-1.12, 0.525, 0.35);
      lecternBase.rotation.y = 0.55;
      const lecternTop = new THREE.Mesh(lecternSlopeGeo, woodMat);
      lecternTop.position.set(-1.12, 1.07, 0.35);
      lecternTop.rotation.y = 0.55;
      lecternTop.rotation.x = 0.32;
      const openTome = new THREE.Mesh(tomePageGeo, parchmentMat);
      openTome.position.set(-1.11, 1.12, 0.36);
      openTome.rotation.y = 0.55;
      openTome.rotation.x = 0.32;
      archiveSet.add(lecternBase, lecternTop, openTome);

      const floatingScrolls: THREE.Group[] = [];
      const scrollOffsets: [number, number, number][] = [
        [-1.3, 1.56, 0.18],
        [1.25, 1.62, -0.35],
        [-0.95, 1.88, -0.75],
      ];
      scrollOffsets.forEach(([sx, sy, sz]) => {
        const sg = new THREE.Group();
        sg.position.set(sx, sy, sz);
        const body = new THREE.Mesh(scrollGeo, parchmentMat);
        body.rotation.z = Math.PI / 2;
        const capL = new THREE.Mesh(scrollCapGeo, brassMat);
        capL.rotation.z = Math.PI / 2;
        capL.position.x = -0.2;
        const capR = new THREE.Mesh(scrollCapGeo, brassMat);
        capR.rotation.z = Math.PI / 2;
        capR.position.x = 0.2;
        sg.add(body, capL, capR);
        archiveSet.add(sg);
        floatingScrolls.push(sg);
      });

      const shelfPositions: [number, number, number][] = [
        [1.82, 1.35, -1.65],
        [-1.95, 1.35, -1.75],
      ];
      const bookInstances = 64;
      const bookInstanced = new THREE.InstancedMesh(bookGeo, bookMat, bookInstances);
      const dummy = new THREE.Object3D();
      const paletteHex = [0x7c2d12, 0x1e3a8a, 0x92400e, 0x3f2e26, 0x065f46, 0x713f12];
      const tempCol = new THREE.Color();
      let bIdx = 0;

      shelfPositions.forEach(([bx, by, bz], sIndex) => {
        const shelf = new THREE.Mesh(shelfFrameGeo, woodMat);
        shelf.position.set(bx, by, bz);
        shelf.rotation.y = sIndex === 0 ? -0.34 : 0.34;
        archiveSet.add(shelf);
        for (let row = 0; row < 4; row++) {
          for (let col = 0; col < 8; col++) {
            if (bIdx >= bookInstances) break;
            const localX = -0.5 + col * 0.14;
            const localY = 0.45 + row * 0.56;
            const rotY = sIndex === 0 ? -0.34 : 0.34;
            const cosR = Math.cos(rotY);
            const sinR = Math.sin(rotY);
            dummy.position.set(
              bx + localX * cosR + 0.14 * sinR,
              localY,
              bz - localX * sinR + 0.14 * cosR,
            );
            dummy.rotation.set(0, rotY, col % 5 === 0 ? 0.08 : 0);
            dummy.scale.set(0.9 + (col % 3) * 0.15, 0.85 + ((row + col) % 4) * 0.1, 1);
            dummy.updateMatrix();
            bookInstanced.setMatrixAt(bIdx, dummy.matrix);
            tempCol.setHex(paletteHex[(bIdx + row) % paletteHex.length]);
            bookInstanced.setColorAt(bIdx, tempCol);
            bIdx++;
          }
        }
      });
      bookInstanced.instanceMatrix.needsUpdate = true;
      if (bookInstanced.instanceColor) bookInstanced.instanceColor.needsUpdate = true;
      bookInstanced.computeBoundingSphere();
      archiveSet.add(bookInstanced);

      const candleStand = new THREE.Mesh(candleStemGeo, brassMat);
      candleStand.position.set(1.42, 0.28, 0.3);
      const candleFlame = new THREE.Mesh(flameCoreGeo, emberMat);
      candleFlame.scale.set(0.65, 1.1, 0.65);
      candleFlame.position.set(1.42, 0.64, 0.3);
      archiveSet.add(candleStand, candleFlame);
      scene.add(archiveSet);

      if (!isSoftwareGl) {
        renderer.compile(scene, camera);
      }

      const handleContextLost = (e: Event) => {
        e.preventDefault();
        setContextLost(true);
      };
      const handleContextRestored = () => {
        setContextLost(false);
      };
      renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

      const handleResize = () => {
        if (!container) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        // Preserve active WebGL dimensions while parent view is CSS-hidden during background export
        if (w < 10 || h < 10) return;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      };
      const resizeObs = new ResizeObserver(handleResize);
      resizeObs.observe(container);

      const clock = new THREE.Clock();
      let frameId = 0;
      let disposed = false;
      let nextBlinkAt = 2.6;
      let blinkAmount = 0;

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
        gl.flush();
        if (!sync) {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const poll = () => {
          if (disposed) {
            gl.deleteSync(sync);
            return;
          }
          const status = gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (status === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      }

      const stepAndRender = () => {
        if (disposed) return;
        lastRenderPerfRef.current = performance.now();
        const delta = Math.min(clock.getDelta(), 0.08);
        const t = clock.getElapsedTime();
        const st = stateRef.current;
        const intensity = st.actionIntensity;
        const lip = lipSyncRef.current;
        const act = st.storyActivity;

        controls.enabled = st.orbitUnlocked;

        // Environment set visibility
        pillarSet.visible = st.stageSet === 'philosopher_pillar';
        summitSet.visible = st.stageSet === 'summit_overlook';
        archiveSet.visible = st.stageSet === 'ancient_archive';

        // Activity-specific props & secondary characters visibility
        forgeCluster.visible = act === 'forge_labor';
        stepsCluster.visible = act === 'climb_ascent';
        duelCluster.visible = act === 'duel_overcome';

        hammerGroup.visible = act === 'forge_labor';
        torchGroup.visible = act === 'climb_ascent' || act === 'triumph_raise';
        staffGroup.visible = act === 'duel_overcome';
        scrollPropGroup.visible = act === 'scholar_study';

        // Animate stage props
        astrolabeRing1.rotation.y = t * 0.55;
        astrolabeRing1.rotation.x = Math.sin(t * 0.7) * 0.45;
        astrolabeRing2.rotation.z = -t * 0.85;
        lanternCore.rotation.y = t * 1.1;
        beaconOrb.rotation.y = -t * 0.95;
        beaconOrb.position.y = 2.02 + Math.sin(t * 2.2) * 0.05;
        eclipseHalo.rotation.z = t * 0.08;
        bannerMesh.rotation.y = Math.sin(t * 2.4) * 0.14;
        floatingScrolls.forEach((sg, idx) => {
          sg.position.y = scrollOffsets[idx][1] + Math.sin(t * 1.8 + idx * 1.7) * 0.055;
          sg.rotation.y = 0.45 + Math.sin(t * 0.65 + idx) * 0.35;
        });
        candleFlame.scale.y = 1.05 + Math.sin(t * 11) * 0.16;
        torchFlame.scale.setScalar(1 + Math.sin(t * 12) * 0.15);

        // Animate floating embers
        for (let i = 0; i < particleCount; i++) {
          const idx = i * 3;
          const speed = particleSeed[idx];
          const phase = particleSeed[idx + 1];
          const drift = particleSeed[idx + 2];
          let py = particlePos[idx + 1] + speed * delta * (lip.isPlaying ? 1.55 : 1.0);
          if (py > 4.1) py = 0.22;
          particlePos[idx + 1] = py;
          particlePos[idx] += Math.sin(t * 0.9 + phase) * drift * delta * 0.35;
          particlePos[idx + 2] += Math.cos(t * 0.85 + phase) * drift * delta * 0.35;
        }
        emberPosAttr.needsUpdate = true;

        // Lighting mood transitions
        const mood = LIGHTING_PRESETS[st.lightingMood];
        const dampRate = 1 - Math.exp(-4 * delta);
        _targetBgColor.setHex(mood.bg);
        if (scene.background instanceof THREE.Color) {
          scene.background.lerp(_targetBgColor, dampRate);
        }
        if (scene.fog instanceof THREE.FogExp2) {
          scene.fog.color.lerp(_targetBgColor, dampRate);
        }
        _targetKeyColor.setHex(mood.keyColor);
        keyLight.color.lerp(_targetKeyColor, dampRate);
        keyLight.intensity = THREE.MathUtils.damp(keyLight.intensity, mood.keyIntensity, 4, delta);
        keyBeamMat.color.lerp(_targetKeyColor, dampRate);
        keyBeamMat.opacity = THREE.MathUtils.damp(
          keyBeamMat.opacity,
          mood.beamOpacity + (lip.isPlaying ? lip.jawOpen * 0.025 : 0),
          4,
          delta,
        );
        _targetHemiSky.setHex(mood.hemiSky);
        hemiLight.color.lerp(_targetHemiSky, dampRate);
        hemiLight.intensity = THREE.MathUtils.damp(hemiLight.intensity, mood.hemiIntensity, 4, delta);
        _targetRimColor.setHex(mood.rimColor);
        rimLight.color.lerp(_targetRimColor, dampRate);
        rimLight.intensity = THREE.MathUtils.damp(rimLight.intensity, mood.rimIntensity, 4, delta);
        rimBeamMat.color.lerp(_targetRimColor, dampRate);
        _targetAccentColor.setHex(mood.accentColor);
        propPointLight.color.lerp(_targetAccentColor, dampRate);
        propPointLight.intensity = 2.25 + Math.sin(t * 5.2) * 0.28 + (lip.isPlaying ? lip.jawOpen * 0.6 : 0);
        emberPointsMat.color.lerp(_targetAccentColor, dampRate);

        // ------------------------------------------------------------------
        // FULL-BODY SCRIPT CHOREOGRAPHY (Hero + Companion + Adversary)
        // ------------------------------------------------------------------
        let heroTargetX = 0;
        let heroTargetY = 0.16;
        let heroTargetZ = 0;
        let heroYaw = 0;

        let strideFreq = 0;
        let strideAmp = 0;
        let torsoPitch = 0;
        let torsoYaw = Math.sin(t * 0.7) * 0.03;
        let headPitch = Math.sin(t * 1.1) * 0.03;
        let headYaw = Math.sin(t * 0.65) * 0.05;
        let lShoulderX = 0.08;
        let lShoulderZ = -0.14;
        let lElbowX = -0.32;
        let lWristX = 0;
        let rShoulderX = 0.08;
        let rShoulderZ = 0.14;
        let rElbowX = -0.32;
        let rWristX = 0;
        let browTilt = 0;

        // Companion targets
        let compX = -1.18;
        let compY = 0.16;
        let compZ = -0.22;
        let compYaw = 0.45;
        let compStrideFreq = 0;
        let compStrideAmp = 0;
        let compTorsoPitch = 0.04;
        let compRShoulderX = -0.2;
        let compRElbowX = -0.6;
        let compLShoulderX = -0.2;
        let compLElbowX = -0.5;

        if (act === 'orator_walk') {
          // Deliberately pace in a smooth stage arc while addressing audience with active stride
          const walkCycle = t * 0.65;
          heroTargetX = Math.sin(walkCycle) * 0.72;
          heroTargetZ = Math.cos(walkCycle * 2) * 0.24;
          heroYaw = Math.cos(walkCycle) * 0.48;
          strideFreq = 2.8;
          strideAmp = 0.34;
          compX = -1.25;
          compZ = -0.35;
          compYaw = 0.65;
          compTorsoPitch = 0.06 + Math.sin(t * 1.8) * 0.04;
        } else if (act === 'forge_labor') {
          // Stand to left of anvil, swing brass hammer down explosively in rhythmic smith cycle
          heroTargetX = -0.32;
          heroTargetZ = 0.18;
          heroYaw = 1.15; // face toward the anvil at x=+0.25
          const cycle = (t * 0.85) % 1;
          const strikeImpulse = cycle < 0.55 ? 0 : Math.sin(((cycle - 0.55) / 0.45) * Math.PI);
          const windUp = cycle < 0.55 ? cycle / 0.55 : 0;
          torsoPitch = cycle < 0.55 ? -0.14 * windUp : 0.38 * strikeImpulse;
          rShoulderX = cycle < 0.55 ? -2.15 * windUp : -0.35 + strikeImpulse * 0.15;
          rElbowX = cycle < 0.55 ? -0.95 : -0.25;
          rWristX = cycle < 0.55 ? -0.35 : 0.45;
          lShoulderX = -0.55;
          lElbowX = -0.85;
          browTilt = -0.1;

          // Anvil glow & impact ring burst
          const impact = cycle > 0.68 && cycle < 0.88 ? 1 : 0;
          sparkBurst.scale.setScalar(impact ? 1 + (cycle - 0.68) * 7 : 0.05);
          sparkBurst.visible = impact > 0;
          hotIngot.scale.y = 1 + Math.sin(t * 8) * 0.08;

          // Companion operates bellows / carries metal on far side
          compX = 0.92;
          compZ = -0.2;
          compYaw = -1.05;
          compTorsoPitch = 0.15 + Math.sin(t * 2.6) * 0.12;
          compRShoulderX = -0.75 + Math.sin(t * 2.6) * 0.38;
          compLShoulderX = -0.75 - Math.sin(t * 2.6) * 0.38;
        } else if (act === 'climb_ascent') {
          // Hero physically strides up the 4 illuminated ascending stone steps holding the glowing torch
          const climbT = (Math.sin(t * 0.58) + 1) * 0.5; // smoothly climbs up & steps cleanly along terrace
          heroTargetX = -0.65 + climbT * 1.38;
          heroTargetY = 0.38 + climbT * 0.66;
          heroTargetZ = 0.15 - climbT * 0.54;
          heroYaw = 0.95;
          strideFreq = 3.9;
          strideAmp = 0.52;
          torsoPitch = 0.22;
          rShoulderX = -1.45 + Math.sin(t * 3.9) * 0.14;
          rElbowX = -0.35;
          lShoulderX = Math.cos(t * 3.9) * 0.42;
          lElbowX = -0.65;

          // Companion climbs one step behind Hero
          const compClimb = Math.max(0, climbT - 0.28);
          compX = -0.65 + compClimb * 1.38;
          compY = 0.38 + compClimb * 0.66;
          compZ = 0.15 - compClimb * 0.54;
          compYaw = 0.95;
          compStrideFreq = 3.9;
          compStrideAmp = 0.46;
          compTorsoPitch = 0.24;
          compRShoulderX = -0.65 + Math.sin(t * 3.9) * 0.25;
        } else if (act === 'scholar_study') {
          // Hero moves near lectern/parchment, reads scroll, turns toward Apprentice while lecturing
          heroTargetX = -0.25 + Math.sin(t * 0.45) * 0.16;
          heroTargetZ = 0.22;
          heroYaw = -0.35 + Math.sin(t * 0.55) * 0.45;
          strideFreq = 1.4;
          strideAmp = 0.12;
          torsoPitch = 0.14;
          lShoulderX = -0.78;
          lElbowX = -0.95;
          rShoulderX = -0.58 + Math.sin(t * 2.1) * 0.18;
          rElbowX = -0.75 + Math.cos(t * 2.4) * 0.22;
          headPitch = 0.18 + Math.sin(t * 1.6) * 0.08;

          // Apprentice kneels/leans forward taking wisdom beside Hero
          compX = 0.85;
          compZ = 0.05;
          compYaw = -0.95;
          compTorsoPitch = 0.26 + Math.sin(t * 1.8) * 0.06;
          compRElbowX = -0.95;
          compLElbowX = -0.95;
        } else if (act === 'duel_overcome') {
          // Hero lunges into active spear/staff combat against looming Shadow Guardian!
          const lunge = (Math.sin(t * 2.4) + 1) * 0.5;
          heroTargetX = -0.55 + lunge * 0.32;
          heroTargetZ = 0.08;
          heroYaw = 1.35; // face adversary at x=+0.95
          strideFreq = 3.2;
          strideAmp = 0.38;
          torsoPitch = 0.24 + lunge * 0.14;
          torsoYaw = -0.25 + lunge * 0.45;
          rShoulderX = -1.15 - lunge * 0.35;
          rElbowX = -0.35 + lunge * 0.25;
          lShoulderX = -0.45;
          lElbowX = -0.9;
          browTilt = -0.14;

          // Shadow Guardian reacts dynamically: weaves forward then recoils on thrust
          sentinelRoot.position.x = 0.95 + lunge * 0.28;
          sentTorso.rotation.z = -lunge * 0.25;
          sentTorso.rotation.x = 0.12 - lunge * 0.26;
          sentArmPivot.rotation.x = -0.65 + Math.sin(t * 2.4) * 0.55;
          sentArmPivot.rotation.z = -0.25 + lunge * 0.35;

          // Companion raises shield-arm cheering from flank
          compX = -1.45;
          compZ = -0.55;
          compYaw = 1.05;
          compRShoulderX = -1.2 + Math.sin(t * 3.1) * 0.18;
        } else if (act === 'triumph_raise') {
          // Hero strides forward to front edge of dais & raises blazing torch skyward in triumph!
          heroTargetX = Math.sin(t * 0.5) * 0.18;
          heroTargetZ = 0.28;
          heroYaw = Math.sin(t * 0.5) * 0.12;
          torsoPitch = -0.12;
          rShoulderX = -2.42 + Math.sin(t * 2.2) * 0.08;
          rShoulderZ = 0.24;
          rElbowX = -0.18;
          lShoulderX = -0.4;
          lShoulderZ = -0.38;
          lElbowX = -0.65;
          headPitch = -0.14;

          // Companion salutes enthusiastically beside dais
          compX = -1.05;
          compZ = -0.25;
          compYaw = 0.45;
          compRShoulderX = -1.95 + Math.sin(t * 3.2) * 0.15;
          compLShoulderX = -0.3;
        }

        // Layer Stage 4 CharacterAction nuance smoothly on top of orator_walk/study
        if (act === 'orator_walk' || act === 'scholar_study') {
          switch (st.action) {
            case 'storyteller_gesture':
              lShoulderX = -0.46 * intensity + Math.sin(t * 2.2) * 0.15;
              lShoulderZ = -0.22;
              lElbowX = -0.88 + Math.cos(t * 2.4) * 0.18;
              rShoulderX = -0.42 * intensity + Math.cos(t * 2.0) * 0.16;
              rShoulderZ = 0.24;
              rElbowX = -0.82 + Math.sin(t * 2.4) * 0.18;
              break;
            case 'emphasize_point':
              rShoulderX = -1.08 * intensity + Math.sin(t * 4.2) * 0.12;
              rElbowX = -0.42 + Math.sin(t * 4.2) * 0.12;
              browTilt = -0.09;
              break;
            case 'heroic_stance':
              torsoPitch -= 0.08 * intensity;
              lShoulderZ = -0.34 * intensity;
              rShoulderZ = 0.34 * intensity;
              break;
            case 'dramatic_lean':
              torsoPitch += 0.14 * intensity;
              browTilt = -0.11;
              break;
            default:
              break;
          }
        }

        // Apply Hero Root Locomotion & Walking Stride Kinematics
        const heroStrideSin = strideFreq > 0 ? Math.sin(t * strideFreq) : 0;
        const heroHipBob = strideFreq > 0 ? Math.abs(heroStrideSin) * 0.032 : Math.sin(t * 1.8) * 0.01;

        hero.root.position.x = THREE.MathUtils.damp(hero.root.position.x, heroTargetX, 5.2, delta);
        hero.root.position.y = THREE.MathUtils.damp(hero.root.position.y, heroTargetY + heroHipBob, 8, delta);
        hero.root.position.z = THREE.MathUtils.damp(hero.root.position.z, heroTargetZ, 5.2, delta);
        hero.root.rotation.y = THREE.MathUtils.damp(hero.root.rotation.y, heroYaw, 5.5, delta);

        const targetLHip = heroStrideSin * strideAmp;
        const targetRHip = -heroStrideSin * strideAmp;
        const targetLKnee = strideAmp > 0 ? Math.max(0, -heroStrideSin) * strideAmp * 1.15 : 0.05;
        const targetRKnee = strideAmp > 0 ? Math.max(0, heroStrideSin) * strideAmp * 1.15 : 0.05;

        hero.leftLeg.hipPivot.rotation.x = THREE.MathUtils.damp(hero.leftLeg.hipPivot.rotation.x, targetLHip, 9, delta);
        hero.rightLeg.hipPivot.rotation.x = THREE.MathUtils.damp(hero.rightLeg.hipPivot.rotation.x, targetRHip, 9, delta);
        hero.leftLeg.kneePivot.rotation.x = THREE.MathUtils.damp(hero.leftLeg.kneePivot.rotation.x, targetLKnee, 9, delta);
        hero.rightLeg.kneePivot.rotation.x = THREE.MathUtils.damp(hero.rightLeg.kneePivot.rotation.x, targetRKnee, 9, delta);

        // Eyelid Blinking & Eye Saccades
        if (t >= nextBlinkAt) {
          blinkAmount = 1;
          nextBlinkAt = t + 3.2 + (Math.sin(t * 17.3) + 1) * 0.9;
        }
        blinkAmount = THREE.MathUtils.damp(blinkAmount, 0, 18, delta);
        const lidRot = -0.78 + blinkAmount * 0.78;
        hero.leftLid.rotation.x = lidRot;
        hero.rightLid.rotation.x = lidRot;
        const gazeX = Math.sin(t * 0.8) * 0.003;
        hero.leftIris.position.x = gazeX;
        hero.rightIris.position.x = gazeX;

        // Lip-Sync & Speaking Resonance
        const jawAngle = lip.isPlaying ? Math.min(0.46, lip.jawOpen * 0.42) : 0.01;
        const speakingHeadNod = lip.isPlaying ? lip.jawOpen * 0.075 : 0;

        hero.torsoPivot.rotation.x = THREE.MathUtils.damp(hero.torsoPivot.rotation.x, torsoPitch, 8, delta);
        hero.torsoPivot.rotation.y = THREE.MathUtils.damp(hero.torsoPivot.rotation.y, torsoYaw, 7, delta);
        hero.capePivot.rotation.z = THREE.MathUtils.damp(hero.capePivot.rotation.z, -torsoYaw * 0.45, 5, delta);
        hero.capePivot.rotation.x = THREE.MathUtils.damp(
          hero.capePivot.rotation.x,
          0.06 + (strideAmp > 0 ? Math.abs(heroStrideSin) * 0.14 : 0) + Math.max(0, -torsoPitch * 0.4),
          5,
          delta,
        );

        hero.headPivot.rotation.x = THREE.MathUtils.damp(
          hero.headPivot.rotation.x,
          headPitch + speakingHeadNod,
          10,
          delta,
        );
        hero.headPivot.rotation.y = THREE.MathUtils.damp(hero.headPivot.rotation.y, headYaw, 7, delta);

        hero.jawPivot.rotation.x = THREE.MathUtils.damp(hero.jawPivot.rotation.x, jawAngle, 22, delta);
        const spreadScale = 1 + (lip.isPlaying ? lip.lipSpread * 0.16 : 0);
        hero.upperLip.scale.x = THREE.MathUtils.damp(hero.upperLip.scale.x, spreadScale, 18, delta);
        hero.lowerLip.scale.x = THREE.MathUtils.damp(hero.lowerLip.scale.x, spreadScale, 18, delta);

        const browLift = lip.isPlaying ? 0.236 + lip.jawOpen * 0.016 : 0.236;
        hero.leftBrow.position.y = THREE.MathUtils.damp(hero.leftBrow.position.y, browLift, 14, delta);
        hero.rightBrow.position.y = THREE.MathUtils.damp(hero.rightBrow.position.y, browLift, 14, delta);
        hero.leftBrow.rotation.z = THREE.MathUtils.damp(hero.leftBrow.rotation.z, browTilt, 10, delta);
        hero.rightBrow.rotation.z = THREE.MathUtils.damp(hero.rightBrow.rotation.z, -browTilt, 10, delta);

        if (hero.medallionGroup && hero.medallionMesh) {
          hero.medallionGroup.rotation.z += delta * (0.45 + (lip.isPlaying ? lip.jawOpen * 2.8 : 0));
          hero.medallionMesh.rotation.y += delta * 1.2;
        }
        emberMat.emissiveIntensity = 1.25 + (lip.isPlaying ? lip.jawOpen * 1.6 : Math.sin(t * 2) * 0.18);
        runeMat.emissiveIntensity = 0.72 + (lip.isPlaying ? lip.jawOpen * 0.9 : Math.sin(t * 1.5) * 0.14);

        hero.leftArm.shoulderPivot.rotation.x = THREE.MathUtils.damp(hero.leftArm.shoulderPivot.rotation.x, lShoulderX, 8, delta);
        hero.leftArm.shoulderPivot.rotation.z = THREE.MathUtils.damp(hero.leftArm.shoulderPivot.rotation.z, lShoulderZ, 8, delta);
        hero.leftArm.elbowPivot.rotation.x = THREE.MathUtils.damp(hero.leftArm.elbowPivot.rotation.x, lElbowX, 8, delta);
        hero.leftArm.wristPivot.rotation.x = THREE.MathUtils.damp(hero.leftArm.wristPivot.rotation.x, lWristX, 8, delta);

        hero.rightArm.shoulderPivot.rotation.x = THREE.MathUtils.damp(hero.rightArm.shoulderPivot.rotation.x, rShoulderX, 9, delta);
        hero.rightArm.shoulderPivot.rotation.z = THREE.MathUtils.damp(hero.rightArm.shoulderPivot.rotation.z, rShoulderZ, 9, delta);
        hero.rightArm.elbowPivot.rotation.x = THREE.MathUtils.damp(hero.rightArm.elbowPivot.rotation.x, rElbowX, 9, delta);
        hero.rightArm.wristPivot.rotation.x = THREE.MathUtils.damp(hero.rightArm.wristPivot.rotation.x, rWristX, 9, delta);

        // Apply Companion Locomotion & Action Kinematics
        const compStrideSin = compStrideFreq > 0 ? Math.sin(t * compStrideFreq + 1.1) : 0;
        const compBob = compStrideFreq > 0 ? Math.abs(compStrideSin) * 0.025 : Math.sin(t * 1.9 + 1) * 0.008;
        companion.root.position.x = THREE.MathUtils.damp(companion.root.position.x, compX, 5, delta);
        companion.root.position.y = THREE.MathUtils.damp(companion.root.position.y, compY + compBob, 8, delta);
        companion.root.position.z = THREE.MathUtils.damp(companion.root.position.z, compZ, 5, delta);
        companion.root.rotation.y = THREE.MathUtils.damp(companion.root.rotation.y, compYaw, 5, delta);
        companion.leftLeg.hipPivot.rotation.x = THREE.MathUtils.damp(
          companion.leftLeg.hipPivot.rotation.x,
          compStrideSin * compStrideAmp,
          8,
          delta,
        );
        companion.rightLeg.hipPivot.rotation.x = THREE.MathUtils.damp(
          companion.rightLeg.hipPivot.rotation.x,
          -compStrideSin * compStrideAmp,
          8,
          delta,
        );
        companion.torsoPivot.rotation.x = THREE.MathUtils.damp(companion.torsoPivot.rotation.x, compTorsoPitch, 6, delta);
        companion.headPivot.rotation.x = Math.sin(t * 2.1 + 0.5) * 0.06;
        companion.rightArm.shoulderPivot.rotation.x = THREE.MathUtils.damp(
          companion.rightArm.shoulderPivot.rotation.x,
          compRShoulderX,
          6,
          delta,
        );
        companion.rightArm.elbowPivot.rotation.x = THREE.MathUtils.damp(
          companion.rightArm.elbowPivot.rotation.x,
          compRElbowX,
          6,
          delta,
        );
        companion.leftArm.shoulderPivot.rotation.x = THREE.MathUtils.damp(
          companion.leftArm.shoulderPivot.rotation.x,
          compLShoulderX,
          6,
          delta,
        );
        companion.leftArm.elbowPivot.rotation.x = THREE.MathUtils.damp(
          companion.leftArm.elbowPivot.rotation.x,
          compLElbowX,
          6,
          delta,
        );

        // Smooth camera tracking & preset damping
        if (st.transitionCamera || (!st.orbitUnlocked && st.cameraPreset === 'closeup_lipsync')) {
          const preset = CAMERA_PRESETS[st.cameraPreset];
          const trackWeight = st.cameraPreset === 'closeup_lipsync' ? 0.95 : st.cameraPreset === 'medium_shot' ? 0.45 : 0.15;
          const trackX = hero.root.position.x * trackWeight;
          const trackY = (hero.root.position.y - 0.16) * trackWeight;
          const trackZ = hero.root.position.z * trackWeight * 0.7;

          _camPos.set(preset.pos[0] + trackX, preset.pos[1] + trackY, preset.pos[2] + trackZ);
          _camTarget.set(preset.target[0] + trackX, preset.target[1] + trackY, preset.target[2] + trackZ);

          camera.position.x = THREE.MathUtils.damp(camera.position.x, _camPos.x, 5.5, delta);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _camPos.y, 5.5, delta);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _camPos.z, 5.5, delta);
          controls.target.x = THREE.MathUtils.damp(controls.target.x, _camTarget.x, 5.5, delta);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _camTarget.y, 5.5, delta);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _camTarget.z, 5.5, delta);
          if (st.cameraPreset !== 'closeup_lipsync' && camera.position.distanceTo(_camPos) < 0.02) {
            st.transitionCamera = false;
          }
        }
        controls.update();

        renderer.render(scene, camera);

        // Composite frame + burned-in on-screen text during video export
        const rec = recordStateRef.current;
        if (rec.active && rec.ctx && rec.canvas) {
          const cw = rec.canvas.width;
          const ch = rec.canvas.height;
          const src = renderer.domElement;
          const srcAspect = src.width / Math.max(1, src.height);
          const dstAspect = cw / ch;
          let sx = 0;
          let sy = 0;
          let sw = src.width;
          let sh = src.height;
          if (srcAspect > dstAspect) {
            sw = src.height * dstAspect;
            sx = (src.width - sw) / 2;
          } else {
            sh = src.width / dstAspect;
            sy = (src.height - sh) / 2;
          }
          rec.ctx.drawImage(src, sx, sy, sw, sh, 0, 0, cw, ch);

          const ov = overlayRef.current;
          if (ov.showOnScreenText && ov.onScreenText.trim()) {
            const text = ov.onScreenText.trim();
            rec.ctx.font = '700 32px "Plus Jakarta Sans", sans-serif';
            const metrics = rec.ctx.measureText(text);
            const boxW = Math.min(cw - 120, metrics.width + 56);
            const boxH = 58;
            const bx = (cw - boxW) / 2;
            const by = ch - 92;
            rec.ctx.fillStyle = 'rgba(11, 15, 25, 0.9)';
            rec.ctx.fillRect(bx, by, boxW, boxH);
            rec.ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
            rec.ctx.lineWidth = 2;
            rec.ctx.strokeRect(bx, by, boxW, boxH);
            rec.ctx.fillStyle = '#FCD34D';
            rec.ctx.textAlign = 'center';
            rec.ctx.textBaseline = 'middle';
            rec.ctx.fillText(text, cw / 2, by + boxH / 2, boxW - 24);
          }

          const [videoTrack] = rec.stream?.getVideoTracks() || [];
          if (
            videoTrack &&
            'requestFrame' in videoTrack &&
            typeof (videoTrack as { requestFrame?: () => void }).requestFrame === 'function'
          ) {
            (videoTrack as { requestFrame: () => void }).requestFrame();
          }
        }
      };

      stepAndRenderRef.current = stepAndRender;

      const tick = () => {
        if (disposed) return;
        stepAndRender();
        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = requestAnimationFrame(tick);
        }
      };

      frameId = requestAnimationFrame(tick);

      return () => {
        disposed = true;
        stepAndRenderRef.current = null;
        captureWorkerStopRef.current?.();
        captureWorkerStopRef.current = null;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        recordStateRef.current.stream?.getTracks().forEach((t) => t.stop());
        recordStateRef.current = { active: false, canvas: null, ctx: null, stream: null };
        resizeObs.disconnect();
        controls.removeEventListener('start', onOrbitStart);
        controls.dispose();
        renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
        renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
        disposables.forEach((d) => d.dispose());
        renderer.dispose();
      };
    }, [lipSyncRef]);

    return (
      <div className="relative h-full w-full overflow-hidden rounded-lg border border-white/10 bg-[#080c14]">
        <div ref={mountRef} className="h-full w-full" />

        {contextLost && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0B0F19] text-center p-6">
            <p className="font-display text-sm font-semibold text-amber-400">
              3D Stage Context Interrupted
            </p>
            <p className="mt-1 text-xs text-slate-400">
              Restoring WebGL director viewport automatically.
            </p>
          </div>
        )}

        {/* Fixed Top-Left Camera / Story Enactment Readout (Opaque surface, no backdrop-blur) */}
        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded border border-white/10 bg-[#0B0F19]/90 px-2.5 py-1 text-xs text-slate-300">
          <span className="font-mono-tabular uppercase tracking-wider text-amber-400">
            {cameraPreset.replace('_', ' ')}
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="capitalize text-emerald-300">{activeActivity.replace('_', ' ')}</span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="capitalize text-slate-400">{stageSet.replace('_', ' ')}</span>
        </div>

        {/* Optional On-Screen Text Preview */}
        {showOnScreenText && onScreenText && (
          <div className="pointer-events-none absolute inset-x-6 bottom-6 flex justify-center">
            <div className="rounded border border-amber-500/40 bg-[#0B0F19]/92 px-4 py-2 text-center shadow-lg">
              <p className="font-display text-base font-bold tracking-wide text-amber-300">
                {onScreenText}
              </p>
            </div>
          </div>
        )}
      </div>
    );
  },
);
