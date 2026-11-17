import React, { useEffect, useImperativeHandle, useRef, useState, forwardRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  createAsphaltRoadTexture,
  createEmberSpriteTexture,
  createFloorStoneTexture,
  createMistSpriteTexture,
  createOrganicSkinTexture,
  createRadialShadowTexture,
  createSidewalkTileTexture,
  createStoneBumpTexture,
  createStorefrontWindowTexture,
  createVolumetricBeamTexture,
  createWovenFabricTexture,
} from '../three/proceduralTextures';
import { createActorAssetFactory } from '../three/actorBuilder';
import { buildStageEnvironments } from '../three/stageEnvironments';
import { CAMERA_PRESETS, stepHumanChoreography } from '../three/cinemaChoreographer';
import type {
  CameraPreset,
  CharacterAction,
  DirectorBeat,
  LightingMood,
  StageSet,
  StoryActivity,
} from '../types/studio';

export interface Stage3DViewportProps {
  action: CharacterAction;
  storyActivity?: StoryActivity;
  directorBlocks?: DirectorBeat[];
  sceneDurationSec?: number;
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

export interface DeterministicFrameParams {
  simTimeSec: number;
  deltaSec: number;
  jawOpen: number;
  lipSpread: number;
  isPlaying: boolean;
  sceneProgress01: number;
  onScreenText: string;
  showOnScreenText: boolean;
  narrationCaption?: string;
  action: CharacterAction;
  storyActivity?: StoryActivity;
  directorBlocks?: DirectorBeat[];
  sceneDurationSec?: number;
  scriptCue?: string;
  cameraPreset: CameraPreset;
  lightingMood: LightingMood;
  stageSet: StageSet;
  actionIntensity: number;
  snapCamera?: boolean;
}

export interface Stage3DViewportHandle {
  captureFramePng: () => string | null;
  setManualRenderMode: (enabled: boolean) => void;
  renderFrameAt: (params: DeterministicFrameParams) => Promise<Blob | null>;
}

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
    bg: 0x0b101d,
    fog: 0x0b101d,
    keyColor: 0xffce85,
    keyIntensity: 2.55,
    hemiSky: 0x7aa4db,
    hemiGround: 0x2b1d14,
    hemiIntensity: 0.85,
    rimColor: 0xf59e0b,
    rimIntensity: 3.1,
    accentColor: 0xffb347,
    beamOpacity: 0.08,
  },
  torchlit_mythic: {
    bg: 0x0a0811,
    fog: 0x0a0811,
    keyColor: 0xff8b42,
    keyIntensity: 2.3,
    hemiSky: 0x4b5c84,
    hemiGround: 0x33160d,
    hemiIntensity: 0.68,
    rimColor: 0xf97316,
    rimIntensity: 3.45,
    accentColor: 0xff6b2b,
    beamOpacity: 0.09,
  },
  obsidian_studio: {
    bg: 0x070a12,
    fog: 0x070a12,
    keyColor: 0xe6efff,
    keyIntensity: 2.35,
    hemiSky: 0x89a8db,
    hemiGround: 0x161c28,
    hemiIntensity: 0.78,
    rimColor: 0xfbbf24,
    rimIntensity: 2.8,
    accentColor: 0xf59e0b,
    beamOpacity: 0.07,
  },
};

export function resolveStoryActivity(
  explicit: StoryActivity | undefined,
  scriptCue: string | undefined,
  action: CharacterAction,
): StoryActivity {
  if (explicit) return explicit;
  const text = (scriptCue || '').toLowerCase();
  if (/\b(crossroad|interjunction|intersection|friend|table|cafe|coffee|shake hand|handshake|wave|bye|sidewalk|street|sit)\b/.test(text)) {
    return 'crossroads_meeting';
  }
  if (/\b(mentor|dialogue|together|counsel|conversation|advice|discuss)\b/.test(text)) {
    return 'mentorship_dialogue';
  }
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

const _camPos = new THREE.Vector3();
const _camTarget = new THREE.Vector3();
const _targetBgColor = new THREE.Color();
const _targetKeyColor = new THREE.Color();
const _targetHemiSky = new THREE.Color();
const _targetRimColor = new THREE.Color();
const _targetAccentColor = new THREE.Color();

export const Stage3DViewport = forwardRef<Stage3DViewportHandle, Stage3DViewportProps>(
  function Stage3DViewport(
    {
      action,
      storyActivity,
      directorBlocks,
      sceneDurationSec,
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
      directorBlocks,
      sceneDurationSec,
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
    const controlsRef = useRef<OrbitControls | null>(null);
    const manualModeRef = useRef(false);
    const exportCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const renderAtFnRef = useRef<((p: DeterministicFrameParams) => void) | null>(null);
    const resumeLoopRef = useRef<(() => void) | null>(null);

    useEffect(() => {
      const prevPreset = stateRef.current.cameraPreset;
      stateRef.current.action = action;
      stateRef.current.storyActivity = activeActivity;
      stateRef.current.directorBlocks = directorBlocks;
      stateRef.current.sceneDurationSec = sceneDurationSec;
      stateRef.current.cameraPreset = cameraPreset;
      stateRef.current.lightingMood = lightingMood;
      stateRef.current.stageSet = stageSet;
      stateRef.current.actionIntensity = actionIntensity;
      stateRef.current.orbitUnlocked = orbitUnlocked;
      if (prevPreset !== cameraPreset) {
        stateRef.current.transitionCamera = true;
      }
    }, [
      action,
      activeActivity,
      directorBlocks,
      sceneDurationSec,
      cameraPreset,
      lightingMood,
      stageSet,
      actionIntensity,
      orbitUnlocked,
    ]);

    useImperativeHandle(ref, () => ({
      captureFramePng: () => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        if (!renderer || !scene || !camera) return null;
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
      },
      setManualRenderMode: (enabled: boolean) => {
        manualModeRef.current = enabled;
        const renderer = rendererRef.current;
        const camera = cameraRef.current;
        const container = mountRef.current;
        if (!renderer || !camera) return;
        if (enabled) {
          renderer.setPixelRatio(1);
          renderer.setSize(1280, 720, false);
          camera.aspect = 1280 / 720;
          camera.updateProjectionMatrix();
          if (!exportCanvasRef.current) {
            const c = document.createElement('canvas');
            c.width = 1280;
            c.height = 720;
            exportCanvasRef.current = c;
          }
        } else {
          if (container && container.clientWidth >= 10 && container.clientHeight >= 10) {
            const w = container.clientWidth;
            const h = container.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h, false);
          }
          resumeLoopRef.current?.();
        }
      },
      renderFrameAt: async (params: DeterministicFrameParams) => {
        const renderer = rendererRef.current;
        const renderAt = renderAtFnRef.current;
        if (!renderer || !renderAt) return null;

        if (!exportCanvasRef.current) {
          const c = document.createElement('canvas');
          c.width = 1280;
          c.height = 720;
          exportCanvasRef.current = c;
        }
        const compCanvas = exportCanvasRef.current;
        const ctx = compCanvas.getContext('2d');
        if (!ctx) return null;

        renderAt(params);

        const src = renderer.domElement;
        ctx.drawImage(src, 0, 0, compCanvas.width, compCanvas.height);

        // Burned-in subtle cinematic film vignette
        const vig = ctx.createRadialGradient(640, 360, 260, 640, 360, 760);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(5,8,16,0.52)');
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, 1280, 720);

        // Clean on-screen impact title / key takeaway pill
        const headline = params.showOnScreenText ? params.onScreenText.trim() : '';
        if (headline) {
          ctx.font = '800 28px "Plus Jakarta Sans", sans-serif';
          const tw = Math.min(1120, ctx.measureText(headline).width + 48);
          const bx = (1280 - tw) / 2;
          const by = 44;
          ctx.fillStyle = 'rgba(11, 15, 25, 0.84)';
          ctx.fillRect(bx, by, tw, 50);
          ctx.strokeStyle = 'rgba(245, 158, 11, 0.65)';
          ctx.lineWidth = 2;
          ctx.strokeRect(bx, by, tw, 50);
          ctx.fillStyle = '#FCD34D';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(headline, 640, by + 25, tw - 24);
        }

        // Bottom synced narration subtitle bar
        const caption = (params.narrationCaption || '').trim();
        if (caption) {
          ctx.font = '600 24px "Plus Jakarta Sans", sans-serif';
          const cw = Math.min(1140, Math.max(420, ctx.measureText(caption).width + 52));
          const sx = (1280 - cw) / 2;
          const sy = 626;
          ctx.fillStyle = 'rgba(8, 12, 20, 0.88)';
          ctx.fillRect(sx, sy, cw, 54);
          ctx.fillStyle = '#F8FAFC';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(caption, 640, sy + 27, cw - 28);
        }

        return new Promise<Blob | null>((resolve) => {
          compCanvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.9);
        });
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

      const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 65);
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
      renderer.toneMappingExposure = 1.12;
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
      controls.minDistance = 1.25;
      controls.maxDistance = 9.8;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.minPolarAngle = Math.PI * 0.14;
      controls.enabled = stateRef.current.orbitUnlocked;
      controlsRef.current = controls;

      const onOrbitStart = () => {
        stateRef.current.transitionCamera = false;
      };
      controls.addEventListener('start', onOrbitStart);

      // 3-Point Chiaroscuro + Rim + Warm Prop Lighting Rig
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

      // Shared Procedural PBR Materials & Textures
      const maxAniso = renderer.capabilities.getMaxAnisotropy();
      const floorTex = createFloorStoneTexture();
      floorTex.anisotropy = maxAniso;
      const stoneBumpTex = createStoneBumpTexture();
      stoneBumpTex.anisotropy = maxAniso;
      const asphaltTex = createAsphaltRoadTexture();
      asphaltTex.anisotropy = maxAniso;
      const sidewalkTex = createSidewalkTileTexture();
      sidewalkTex.anisotropy = maxAniso;
      const windowTex = createStorefrontWindowTexture();
      const robeTex = createWovenFabricTexture('#1b273c', 'rgba(255,255,255,0.032)');
      robeTex.anisotropy = maxAniso;
      const compRobeTex = createWovenFabricTexture('#46291e', 'rgba(251,191,36,0.045)');
      compRobeTex.anisotropy = maxAniso;
      const cloakTex = createWovenFabricTexture('#0e1420', 'rgba(245,158,11,0.028)', 'rgba(245,158,11,0.28)');
      cloakTex.anisotropy = maxAniso;
      const heroSkinTex = createOrganicSkinTexture('#dba584', '#e3b293');
      const compSkinTex = createOrganicSkinTexture('#c38d6b', '#cd9877');
      const emberSpriteTex = createEmberSpriteTexture();
      const mistSpriteTex = createMistSpriteTexture();
      const beamTex = createVolumetricBeamTexture();
      const shadowTex = createRadialShadowTexture();

      const brassMat = new THREE.MeshStandardMaterial({ color: 0xdca032, roughness: 0.22, metalness: 0.92 });
      const darkBronzeMat = new THREE.MeshStandardMaterial({ color: 0x5c472c, roughness: 0.42, metalness: 0.78 });
      const stoneMat = new THREE.MeshStandardMaterial({
        color: 0x263044,
        bumpMap: stoneBumpTex,
        bumpScale: 0.012,
        roughness: 0.86,
        metalness: 0.1,
      });
      const obsidianMat = new THREE.MeshStandardMaterial({ color: 0x141b28, roughness: 0.44, metalness: 0.36 });
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

      const skinMat = new THREE.MeshStandardMaterial({ map: heroSkinTex, roughness: 0.56, metalness: 0.03 });
      const compSkinMat = new THREE.MeshStandardMaterial({ map: compSkinTex, roughness: 0.58, metalness: 0.03 });
      const heroRobeMat = new THREE.MeshStandardMaterial({ map: robeTex, roughness: 0.74, metalness: 0.08 });
      const compRobeMat = new THREE.MeshStandardMaterial({ map: compRobeTex, roughness: 0.76, metalness: 0.08 });
      const cloakMat = new THREE.MeshStandardMaterial({ map: cloakTex, roughness: 0.84, metalness: 0.06 });

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

      // Build Modular Sculpted Actors & Hand Props
      const actorFactory = createActorAssetFactory(scene, {
        brassMat,
        darkBronzeMat,
        emberMat,
        shadowTex,
      });

      const hero = actorFactory.buildActor({
        robeMat: heroRobeMat,
        skinMat,
        cloakMat,
        withBeard: true,
        withMedallion: true,
        irisColor: 0x26354d,
      });
      const companion = actorFactory.buildActor({
        robeMat: compRobeMat,
        skinMat: compSkinMat,
        cloakMat,
        withBeard: false,
        withMedallion: false,
        irisColor: 0x3b2a1e,
      });
      companion.root.scale.setScalar(0.92);
      companion.root.position.set(-1.15, 0.16, -0.2);

      const heroProps = actorFactory.attachHeroProps(hero);

      // Build Rich Atmospheric Stage Environments & Story Clusters
      const env = buildStageEnvironments(scene, {
        floorTex,
        stoneBumpTex,
        emberSpriteTex,
        mistSpriteTex,
        asphaltTex,
        sidewalkTex,
        windowTex,
        brassMat,
        darkBronzeMat,
        stoneMat,
        obsidianMat,
        emberMat,
        runeMat,
        parchmentMat: heroProps.parchmentMat,
        accentColor: initialLight.accentColor,
      });

      const disposables: { dispose: () => void }[] = [
        envTexture,
        floorTex,
        stoneBumpTex,
        asphaltTex,
        sidewalkTex,
        windowTex,
        robeTex,
        compRobeTex,
        cloakTex,
        heroSkinTex,
        compSkinTex,
        emberSpriteTex,
        mistSpriteTex,
        beamTex,
        shadowTex,
        brassMat,
        darkBronzeMat,
        stoneMat,
        obsidianMat,
        emberMat,
        runeMat,
        skinMat,
        compSkinMat,
        heroRobeMat,
        compRobeMat,
        cloakMat,
        keyBeamGeo,
        keyBeamMat,
        rimBeamGeo,
        rimBeamMat,
        ...actorFactory.disposables,
        ...env.disposables,
      ];

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
        if (!container || manualModeRef.current) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
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
      const blinkState = { nextBlinkAt: 2.5, blinkAmount: 0 };

      const renderSceneFrame = (opts: {
        t: number;
        delta: number;
        action: CharacterAction;
        storyActivity: StoryActivity;
        directorBlocks?: DirectorBeat[];
        sceneDurationSec?: number;
        cameraPreset: CameraPreset;
        lightingMood: LightingMood;
        stageSet: StageSet;
        actionIntensity: number;
        lip: { jawOpen: number; lipSpread: number; isPlaying: boolean };
        sceneProgress01: number | null;
        snapCamera: boolean;
      }) => {
        const {
          t,
          delta,
          action: actPose,
          storyActivity: act,
          directorBlocks: blocks,
          sceneDurationSec: durSec,
          cameraPreset: camPreset,
          lightingMood: lightMood,
          stageSet: stSet,
          actionIntensity: actInt,
          lip,
          sceneProgress01,
          snapCamera,
        } = opts;

        controls.enabled = !manualModeRef.current && stateRef.current.orbitUnlocked;

        const hasBlocks = Boolean(blocks && blocks.length > 0);
        const isStreetMode = stSet === 'crossroads_cafe' || (!hasBlocks && act === 'crossroads_meeting');
        env.amphitheaterGroup.visible = !isStreetMode;
        env.crossroadsSet.visible = isStreetMode;
        env.pillarSet.visible = !isStreetMode && stSet === 'philosopher_pillar';
        env.summitSet.visible = !isStreetMode && stSet === 'summit_overlook';
        env.archiveSet.visible = !isStreetMode && stSet === 'ancient_archive';

        if (!hasBlocks) {
          env.stageTableCluster.visible = false;
          env.forgeCluster.visible = act === 'forge_labor';
          env.stepsCluster.visible = act === 'climb_ascent';
          env.duelCluster.visible = act === 'duel_overcome';

          heroProps.hammerGroup.visible = act === 'forge_labor';
          heroProps.torchGroup.visible = act === 'climb_ascent' || act === 'triumph_raise';
          heroProps.staffGroup.visible = act === 'duel_overcome';
          heroProps.scrollPropGroup.visible = act === 'scholar_study';
        }
        heroProps.torchFlame.scale.setScalar(1 + Math.sin(t * 12) * 0.16);

        env.animateProps(t, delta, lip.jawOpen, lip.isPlaying);

        // Lighting mood transitions
        const mood = LIGHTING_PRESETS[lightMood];
        const dampRate = snapCamera ? 1 : 1 - Math.exp(-4 * delta);
        _targetBgColor.setHex(mood.bg);
        if (scene.background instanceof THREE.Color) scene.background.lerp(_targetBgColor, dampRate);
        if (scene.fog instanceof THREE.FogExp2) scene.fog.color.lerp(_targetBgColor, dampRate);
        _targetKeyColor.setHex(mood.keyColor);
        keyLight.color.lerp(_targetKeyColor, dampRate);
        keyLight.intensity = THREE.MathUtils.damp(keyLight.intensity, mood.keyIntensity, 4, delta);
        keyBeam.visible = !isStreetMode;
        rimBeam.visible = !isStreetMode;
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
        if (isStreetMode) {
          propPointLight.position.set(3.6, 3.25, -3.55);
          propPointLight.distance = 12;
          propPointLight.intensity = 4.0 + Math.sin(t * 4) * 0.2;
        } else {
          propPointLight.position.set(-1.35, 1.65, 0.35);
          propPointLight.distance = 8.5;
          propPointLight.intensity =
            2.3 + Math.sin(t * 5.2) * 0.28 + (lip.isPlaying ? lip.jawOpen * 0.65 : 0);
        }
        env.emberPointsMat.color.lerp(_targetAccentColor, dampRate);

        const choreoOut = stepHumanChoreography({
          t,
          delta,
          action: actPose,
          storyActivity: act,
          directorBlocks: blocks,
          sceneDurationSec: durSec,
          stageSet: stSet,
          actionIntensity: actInt,
          lip,
          sceneProgress01,
          hero,
          companion,
          env,
          emberMat,
          runeMat,
          blinkState,
        });

        if (hasBlocks) {
          env.stageTableCluster.visible = Boolean(choreoOut.usesDialogueTable);
          const tools = choreoOut.activeTools;
          heroProps.hammerGroup.visible = Boolean(tools?.hammer);
          heroProps.torchGroup.visible = Boolean(tools?.torch);
          heroProps.staffGroup.visible = Boolean(tools?.staff);
          heroProps.scrollPropGroup.visible = Boolean(tools?.scroll);
          env.forgeCluster.visible = Boolean(tools?.hammer);
          env.duelCluster.visible = Boolean(tools?.staff);
          env.stepsCluster.visible = false;
        }

        // Cinematic Camera Framing + Story Tracking (honors Orbit Free toggle in live mode)
        const shouldTrack =
          manualModeRef.current ||
          ((hasBlocks || act === 'crossroads_meeting') && !stateRef.current.orbitUnlocked) ||
          stateRef.current.transitionCamera ||
          (!stateRef.current.orbitUnlocked && camPreset === 'closeup_lipsync');

        if (shouldTrack) {
          if (choreoOut.cameraOverride) {
            _camPos.set(...choreoOut.cameraOverride.pos);
            _camTarget.set(...choreoOut.cameraOverride.target);
          } else {
            const preset = CAMERA_PRESETS[camPreset];
            const trackWeight =
              camPreset === 'closeup_lipsync' ? 0.96 : camPreset === 'medium_shot' ? 0.48 : 0.18;
            const trackX = hero.root.position.x * trackWeight;
            const trackY = (hero.root.position.y - (isStreetMode ? 0.0 : 0.16)) * trackWeight;
            const trackZ = hero.root.position.z * trackWeight * 0.7;

            const prog = sceneProgress01 ?? 0;
            const dollyPull = prog * (camPreset === 'closeup_lipsync' ? 0.18 : 0.42);
            const orbitArc = Math.sin(t * 0.35) * 0.14;

            _camPos.set(
              preset.pos[0] + trackX + orbitArc,
              preset.pos[1] + trackY + Math.sin(t * 0.7) * 0.015,
              preset.pos[2] + trackZ - dollyPull,
            );
            _camTarget.set(
              preset.target[0] + trackX,
              preset.target[1] + trackY,
              preset.target[2] + trackZ,
            );
          }

          if (snapCamera) {
            camera.position.copy(_camPos);
            controls.target.copy(_camTarget);
          } else {
            const camDamp = choreoOut.cameraOverride ? 3.5 : 5.5;
            camera.position.x = THREE.MathUtils.damp(camera.position.x, _camPos.x, camDamp, delta);
            camera.position.y = THREE.MathUtils.damp(camera.position.y, _camPos.y, camDamp, delta);
            camera.position.z = THREE.MathUtils.damp(camera.position.z, _camPos.z, camDamp, delta);
            controls.target.x = THREE.MathUtils.damp(controls.target.x, _camTarget.x, camDamp, delta);
            controls.target.y = THREE.MathUtils.damp(controls.target.y, _camTarget.y, camDamp, delta);
            controls.target.z = THREE.MathUtils.damp(controls.target.z, _camTarget.z, camDamp, delta);
            if (
              !choreoOut.cameraOverride &&
              camPreset !== 'closeup_lipsync' &&
              camera.position.distanceTo(_camPos) < 0.02
            ) {
              stateRef.current.transitionCamera = false;
            }
          }
        }

        if (!manualModeRef.current) {
          controls.update();
        } else {
          camera.lookAt(controls.target);
        }

        renderer.render(scene, camera);
      };

      renderAtFnRef.current = (p: DeterministicFrameParams) => {
        if (disposed) return;
        renderSceneFrame({
          t: p.simTimeSec,
          delta: p.deltaSec,
          action: p.action,
          storyActivity: resolveStoryActivity(p.storyActivity, p.scriptCue, p.action),
          directorBlocks: p.directorBlocks,
          sceneDurationSec: p.sceneDurationSec,
          cameraPreset: p.cameraPreset,
          lightingMood: p.lightingMood,
          stageSet: p.stageSet,
          actionIntensity: p.actionIntensity,
          lip: { jawOpen: p.jawOpen, lipSpread: p.lipSpread, isPlaying: p.isPlaying },
          sceneProgress01: p.sceneProgress01,
          snapCamera: Boolean(p.snapCamera),
        });
      };

      function afterDraw(cb: () => void) {
        const gl = renderer.getContext() as WebGL2RenderingContext;
        const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
        gl.flush();
        if (!sync) {
          frameId = window.setTimeout(cb, 80);
          return;
        }
        const poll = () => {
          if (disposed || manualModeRef.current) {
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

      const tick = () => {
        if (disposed || manualModeRef.current) return;
        const delta = Math.min(clock.getDelta(), 0.08);
        const t = clock.getElapsedTime();
        const st = stateRef.current;

        renderSceneFrame({
          t,
          delta,
          action: st.action,
          storyActivity: st.storyActivity,
          directorBlocks: st.directorBlocks,
          sceneDurationSec: st.sceneDurationSec,
          cameraPreset: st.cameraPreset,
          lightingMood: st.lightingMood,
          stageSet: st.stageSet,
          actionIntensity: st.actionIntensity,
          lip: lipSyncRef.current,
          sceneProgress01: null,
          snapCamera: false,
        });

        if (isSoftwareGl) {
          afterDraw(tick);
        } else {
          frameId = requestAnimationFrame(tick);
        }
      };

      resumeLoopRef.current = () => {
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
        if (!disposed && !manualModeRef.current) {
          clock.getDelta();
          frameId = requestAnimationFrame(tick);
        }
      };

      frameId = requestAnimationFrame(tick);

      return () => {
        disposed = true;
        renderAtFnRef.current = null;
        resumeLoopRef.current = null;
        cancelAnimationFrame(frameId);
        clearTimeout(frameId);
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

        <div className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded border border-white/10 bg-[#0B0F19]/90 px-2.5 py-1 text-xs text-slate-300">
          <span className="font-mono-tabular uppercase tracking-wider text-amber-400">
            {cameraPreset.replace('_', ' ')}
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="capitalize text-emerald-300">
            {directorBlocks && directorBlocks.length > 0
              ? `${directorBlocks.length}-beat script`
              : activeActivity.replace('_', ' ')}
          </span>
          <span aria-hidden="true" className="text-slate-600">
            ·
          </span>
          <span className="capitalize text-slate-400">{stageSet.replace('_', ' ')}</span>
        </div>

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
