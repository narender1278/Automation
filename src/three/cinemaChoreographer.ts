import * as THREE from 'three';
import type { ArticulatedActor } from './actorBuilder';
import type { EnvironmentRig } from './stageEnvironments';
import type {
  ActorGesture,
  ActorPosture,
  CameraPreset,
  CharacterAction,
  DirectorBeat,
  StageSet,
  StoryActivity,
} from '../types/studio';

export const CAMERA_PRESETS: Record<
  CameraPreset,
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  wide_stage: { pos: [0, 2.25, 6.4], target: [0, 1.38, 0] },
  medium_shot: { pos: [0.32, 1.85, 3.65], target: [0, 1.52, 0] },
  closeup_lipsync: { pos: [0.08, 1.98, 1.65], target: [0, 1.88, 0.08] },
  low_hero: { pos: [-1.18, 1.02, 3.35], target: [0, 1.64, 0] },
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth01 = (t: number, a: number, b: number) => {
  const u = clamp01((t - a) / Math.max(0.0001, b - a));
  return u * u * (3 - 2 * u);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function angleDamp(curr: number, target: number, lambda: number, dt: number): number {
  let diff = ((target - curr + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return curr + diff * (1 - Math.exp(-lambda * dt));
}

function getCrossroadsGroundY(x: number, z: number): number {
  const edgeDist = Math.min(Math.abs(x), Math.abs(z));
  return smooth01(edgeDist, 1.54, 1.72) * 0.12;
}

function samplePath(
  t: number,
  keyframes: { t: number; x: number; z: number }[],
): { x: number; z: number; vx: number; vz: number; speed: number } {
  if (t <= keyframes[0].t) {
    return { x: keyframes[0].x, z: keyframes[0].z, vx: 0, vz: 0, speed: 0 };
  }
  const last = keyframes[keyframes.length - 1];
  if (t >= last.t) {
    return { x: last.x, z: last.z, vx: 0, vz: 0, speed: 0 };
  }
  for (let i = 0; i < keyframes.length - 1; i++) {
    const a = keyframes[i];
    const b = keyframes[i + 1];
    if (t >= a.t && t <= b.t) {
      const dur = Math.max(0.001, b.t - a.t);
      const u = clamp01((t - a.t) / dur);
      const easeStart =
        i === 0 ||
        (i > 0 && Math.hypot(a.x - keyframes[i - 1].x, a.z - keyframes[i - 1].z) < 0.01);
      const easeEnd =
        i + 2 >= keyframes.length ||
        Math.hypot(keyframes[i + 2].x - b.x, keyframes[i + 2].z - b.z) < 0.01;
      let s = u;
      let dsdt = 1 / dur;
      if (easeStart && easeEnd) {
        s = u * u * (3 - 2 * u);
        dsdt = (6 * u * (1 - u)) / dur;
      } else if (easeStart) {
        s = u * u * (2 - u);
        dsdt = (4 * u - 3 * u * u) / dur;
      } else if (easeEnd) {
        const k = 1 - u;
        s = 1 - k * k * (2 - k);
        dsdt = (4 * k - 3 * k * k) / dur;
      }
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const vx = dx * dsdt;
      const vz = dz * dsdt;
      return {
        x: a.x + dx * s,
        z: a.z + dz * s,
        vx,
        vz,
        speed: Math.hypot(vx, vz),
      };
    }
  }
  return { x: last.x, z: last.z, vx: 0, vz: 0, speed: 0 };
}

function animateCapeVertices(actor: ArticulatedActor, t: number, strideEnergy: number) {
  const attr = actor.capeMesh.geometry.attributes.position as THREE.BufferAttribute;
  const arr = attr.array as Float32Array;
  const base = actor.capeBasePositions;
  const amp = 0.02 + strideEnergy * 0.05;
  for (let i = 0; i < arr.length; i += 3) {
    const bx = base[i];
    const by = base[i + 1];
    const bz = base[i + 2];
    const hemWeight = Math.max(0, Math.min(1, (0.64 - by) / 1.28));
    const wave =
      Math.sin(t * 2.8 + bx * 4.5 - by * 2.2) * amp +
      Math.cos(t * 1.7 + bx * 2.1) * amp * 0.45;
    arr[i] = bx;
    arr[i + 1] = by;
    arr[i + 2] = bz - hemWeight * hemWeight * Math.max(-0.04, wave);
  }
  attr.needsUpdate = true;
}

const _wShoulder = new THREE.Vector3();
const _localTarget = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _torsoQuat = new THREE.Quaternion();
const _armQuat = new THREE.Quaternion();
const _armEuler = new THREE.Euler();
const _downAxis = new THREE.Vector3(0, -1, 0);

function aimRightArmToWorld(
  actor: ArticulatedActor,
  targetWorld: THREE.Vector3,
  blend: number,
) {
  if (blend <= 0.001) return;
  actor.torsoPivot.updateMatrixWorld(true);
  actor.rightArm.shoulderPivot.getWorldPosition(_wShoulder);
  _localTarget.copy(targetWorld).sub(_wShoulder);
  actor.torsoPivot.getWorldQuaternion(_torsoQuat);
  _localTarget.applyQuaternion(_torsoQuat.invert());

  const dist = _localTarget.length();
  if (dist < 0.001) return;
  _dir.copy(_localTarget).normalize();

  _armQuat.setFromUnitVectors(_downAxis, _dir);
  _armEuler.setFromQuaternion(_armQuat, 'XYZ');
  const bend = clamp01((0.59 - dist) * 2.4) * 0.5 + 0.16;

  actor.rightArm.shoulderPivot.rotation.x = lerp(
    actor.rightArm.shoulderPivot.rotation.x,
    _armEuler.x - bend * 0.35,
    blend,
  );
  actor.rightArm.shoulderPivot.rotation.y = lerp(
    actor.rightArm.shoulderPivot.rotation.y,
    _armEuler.y,
    blend,
  );
  actor.rightArm.shoulderPivot.rotation.z = lerp(
    actor.rightArm.shoulderPivot.rotation.z,
    _armEuler.z,
    blend,
  );
  actor.rightArm.elbowPivot.rotation.x = lerp(
    actor.rightArm.elbowPivot.rotation.x,
    -bend,
    blend,
  );
}

const PATH_CROSSROADS_A = [
  { t: 0.0, x: -5.2, z: -0.32 },
  { t: 4.0, x: -0.58, z: -0.06 },
  { t: 7.5, x: -0.58, z: -0.06 },
  { t: 9.8, x: 1.75, z: -1.45 },
  { t: 11.2, x: 2.96, z: -2.55 },
  { t: 16.8, x: 2.96, z: -2.55 },
  { t: 19.0, x: 2.96, z: -2.55 },
  { t: 20.3, x: 1.45, z: -1.35 },
  { t: 22.0, x: -5.2, z: -0.32 },
];

const PATH_CROSSROADS_B = [
  { t: 0.0, x: 5.2, z: 0.32 },
  { t: 4.0, x: 0.58, z: 0.06 },
  { t: 7.5, x: 0.58, z: 0.06 },
  { t: 9.6, x: 2.35, z: -1.05 },
  { t: 10.6, x: 4.55, z: -1.55 },
  { t: 11.3, x: 4.24, z: -2.55 },
  { t: 22.0, x: 4.24, z: -2.55 },
];

const TABLE_X = 3.6;
const TABLE_Z = -2.55;
const SIT_PELVIS_REL_Y = 0.455; // 0.39 chair seat height + 0.065 thigh radius -> boots touch y=0.12 sidewalk flush

export interface ChoreographyParams {
  t: number;
  delta: number;
  action: CharacterAction;
  storyActivity: StoryActivity;
  directorBlocks?: DirectorBeat[];
  sceneDurationSec?: number;
  stageSet: StageSet;
  actionIntensity: number;
  lip: { jawOpen: number; lipSpread: number; isPlaying: boolean };
  sceneProgress01: number | null;
  hero: ArticulatedActor;
  companion: ArticulatedActor;
  env: EnvironmentRig;
  emberMat: THREE.MeshStandardMaterial;
  runeMat: THREE.MeshStandardMaterial;
  blinkState: { nextBlinkAt: number; blinkAmount: number };
}

export interface ChoreographyOutput {
  cameraOverride?: {
    pos: [number, number, number];
    target: [number, number, number];
  };
  usesDialogueTable?: boolean;
  activeTools?: {
    hammer?: boolean;
    torch?: boolean;
    staff?: boolean;
    scroll?: boolean;
  };
}

function resolveStageCoords(
  stageSet: StageSet,
  rawX: number,
  rawZ: number,
  posture: ActorPosture,
): { x: number; z: number; sitSide: 'left' | 'right' | null } {
  if (posture === 'sit_left') {
    return stageSet === 'crossroads_cafe'
      ? { x: 2.96, z: -2.55, sitSide: 'left' }
      : { x: -0.64, z: -0.35, sitSide: 'left' };
  }
  if (posture === 'sit_right') {
    return stageSet === 'crossroads_cafe'
      ? { x: 4.24, z: -2.55, sitSide: 'right' }
      : { x: 0.64, z: -0.35, sitSide: 'right' };
  }
  return {
    x: Math.max(-5.2, Math.min(5.2, Number.isFinite(rawX) ? rawX : 0)),
    z: Math.max(-3.6, Math.min(2.8, Number.isFinite(rawZ) ? rawZ : 0)),
    sitSide: null,
  };
}

function getStageFloorY(stageSet: StageSet, x: number, z: number): number {
  if (stageSet === 'crossroads_cafe') {
    return getCrossroadsGroundY(x, z);
  }
  // Amphitheater dais top = 0.16 inside radius 2.0, gently stepping down across lower step to 0.0
  const r = Math.hypot(x, z);
  return (1 - smooth01(r, 1.9, 2.55)) * 0.16;
}

function stepCustomDirectorBlocks(
  p: ChoreographyParams,
  beats: DirectorBeat[],
): ChoreographyOutput {
  const { t, delta, stageSet, lip, hero, companion, sceneDurationSec, sceneProgress01 } = p;
  const dt = Math.max(0.001, Math.min(0.08, delta));
  const loopDur = Math.max(6, Math.min(26, sceneDurationSec || 14));
  const pct = (sceneProgress01 !== null ? clamp01(sceneProgress01) : (t % loopDur) / loopDur) * 100;
  const snap = sceneProgress01 !== null && pct < 0.8;

  // Locate active beat & prior beat
  let bIdx = 0;
  for (let i = 0; i < beats.length; i++) {
    if (pct >= beats[i].startPct) bIdx = i;
  }
  const beat = beats[bIdx];
  const prevBeat = bIdx > 0 ? beats[bIdx - 1] : beat;

  const span = Math.max(2, beat.endPct - beat.startPct);
  const localU = clamp01((pct - beat.startPct) / span);

  const prevHero = resolveStageCoords(stageSet, prevBeat.heroX, prevBeat.heroZ, prevBeat.heroPosture);
  const currHero = resolveStageCoords(stageSet, beat.heroX, beat.heroZ, beat.heroPosture);
  const prevComp = resolveStageCoords(stageSet, prevBeat.compX, prevBeat.compZ, prevBeat.compPosture);
  const currComp = resolveStageCoords(stageSet, beat.compX, beat.compZ, beat.compPosture);

  // Move timing: walking spreads smoothly over beat; stand/sit arrives cleanly in first 42%
  const heroArriveU =
    beat.heroPosture === 'walk'
      ? smooth01(localU, 0, 1)
      : smooth01(localU, 0, 0.42);
  const compArriveU =
    beat.compPosture === 'walk'
      ? smooth01(localU, 0, 1)
      : smooth01(localU, 0, 0.42);

  // Mid-beat detour if crossing table on street set to sit_right
  const hX = lerp(prevHero.x, currHero.x, heroArriveU);
  const hZ = lerp(prevHero.z, currHero.z, heroArriveU);

  let cX = lerp(prevComp.x, currComp.x, compArriveU);
  let cZ = lerp(prevComp.z, currComp.z, compArriveU);
  if (
    stageSet === 'crossroads_cafe' &&
    beat.compPosture === 'sit_right' &&
    prevComp.x < 3.6 &&
    compArriveU > 0.01 &&
    compArriveU < 0.99
  ) {
    // Route smoothly around the front edge of the table (z = -1.55) instead of clipping through tabletop
    const arcLift = Math.sin(compArriveU * Math.PI);
    cZ += arcLift * 1.15;
  }

  const hGroundY = getStageFloorY(stageSet, hX, hZ);
  const cGroundY = getStageFloorY(stageSet, cX, cZ);

  if (snap || pct < (dt / loopDur) * 140) {
    hero.stridePhase = 0;
    hero.prevX = hX;
    hero.prevZ = hZ;
    companion.stridePhase = 0;
    companion.prevX = cX;
    companion.prevZ = cZ;
  }

  const hDx = hX - hero.prevX;
  const hDz = hZ - hero.prevZ;
  const hDist = Math.hypot(hDx, hDz);
  const hSpeed = hDist / dt;
  hero.prevX = hX;
  hero.prevZ = hZ;

  const cDx = cX - companion.prevX;
  const cDz = cZ - companion.prevZ;
  const cDist = Math.hypot(cDx, cDz);
  const cSpeed = cDist / dt;
  companion.prevX = cX;
  companion.prevZ = cZ;

  // Sitting weights
  const prevHSit = prevHero.sitSide ? 1 : 0;
  const currHSit = currHero.sitSide ? smooth01(localU, 0.34, 0.65) : 0;
  const sitH = currHero.sitSide
    ? Math.max(prevHSit * (1 - smooth01(localU, 0, 0.35)), currHSit)
    : prevHSit * (1 - smooth01(localU, 0, 0.35));

  const prevCSit = prevComp.sitSide ? 1 : 0;
  const currCSit = currComp.sitSide ? smooth01(localU, 0.34, 0.65) : 0;
  const sitC = currComp.sitSide
    ? Math.max(prevCSit * (1 - smooth01(localU, 0, 0.35)), currCSit)
    : prevCSit * (1 - smooth01(localU, 0, 0.35));

  if (hSpeed > 0.08 && sitH < 0.25) hero.stridePhase += hDist * 4.3;
  if (cSpeed > 0.08 && sitC < 0.25) companion.stridePhase += cDist * 4.3;

  const isShaking =
    (beat.heroGesture === 'shake_hands' || beat.compGesture === 'shake_hands') && localU > 0.08;
  const shakeBlend = isShaking
    ? smooth01(localU, 0.08, 0.28) * (1 - smooth01(localU, 0.8, 0.98))
    : 0;

  const tblX = stageSet === 'crossroads_cafe' ? TABLE_X : 0.0;
  const tblZ = stageSet === 'crossroads_cafe' ? TABLE_Z : -0.35;
  const usesDialogueTable = beats.some(
    (b) =>
      b.heroPosture === 'sit_left' ||
      b.heroPosture === 'sit_right' ||
      b.compPosture === 'sit_left' ||
      b.compPosture === 'sit_right',
  );

  // Exact world handshake point between actors (above table if seated, chest height if standing)
  const midX = (hX + cX) * 0.5;
  const midZ = (hZ + cZ) * 0.5;
  const pumpY = Math.sin(localU * Math.PI * 4) * 0.04 * shakeBlend;
  const shakeTarget = new THREE.Vector3(
    sitH > 0.5 || sitC > 0.5 ? tblX : midX,
    (sitH > 0.5 || sitC > 0.5 ? 0.93 : Math.max(hGroundY, cGroundY) + 1.06) + pumpY,
    sitH > 0.5 || sitC > 0.5 ? tblZ : midZ,
  );

  const computeYaw = (
    px: number,
    pz: number,
    otherX: number,
    otherZ: number,
    vx: number,
    vz: number,
    speed: number,
    sitSide: 'left' | 'right' | null,
    currYaw: number,
  ) => {
    if (sitSide === 'left' && speed < 0.25) return Math.PI / 2;
    if (sitSide === 'right' && speed < 0.25) return -Math.PI / 2;
    if (speed > 0.14 && (beat.faceMode === 'path' || sitSide !== null)) {
      return Math.atan2(vx, vz);
    }
    if (beat.faceMode === 'camera') return 0;
    if (beat.faceMode === 'table') return Math.atan2(tblX - px, tblZ - pz);
    if (beat.faceMode === 'each_other' || speed <= 0.14) {
      return Math.atan2(otherX - px, otherZ - pz);
    }
    return speed > 0.1 ? Math.atan2(vx, vz) : currYaw;
  };

  const yawH = computeYaw(
    hX, hZ, cX, cZ, hDx / dt, hDz / dt, hSpeed,
    sitH > 0.2 ? currHero.sitSide : null,
    hero.root.rotation.y,
  );
  const yawC = computeYaw(
    cX, cZ, hX, hZ, cDx / dt, cDz / dt, cSpeed,
    sitC > 0.2 ? currComp.sitSide : null,
    companion.root.rotation.y,
  );

  const poseActor = (
    actor: ArticulatedActor,
    px: number,
    gy: number,
    pz: number,
    speed: number,
    yaw: number,
    sit01: number,
    gesture: ActorGesture,
    isHeroActor: boolean,
  ) => {
    actor.root.position.set(px, gy, pz);
    actor.root.rotation.y = snap ? yaw : angleDamp(actor.root.rotation.y, yaw, 8.5, dt);

    const walkW = clamp01(speed / 1.1) * (1 - sit01);
    const s = Math.sin(actor.stridePhase);
    const c = Math.cos(actor.stridePhase);

    actor.pelvisGroup.position.y = lerp(0.88 + Math.abs(s) * 0.025 * walkW, SIT_PELVIS_REL_Y, sit01);
    actor.pelvisGroup.rotation.z = -s * 0.05 * walkW;
    actor.pelvisGroup.rotation.y = s * 0.08 * walkW;

    actor.leftLeg.hipPivot.rotation.x = lerp(s * 0.42 * walkW, -Math.PI / 2, sit01);
    actor.rightLeg.hipPivot.rotation.x = lerp(-s * 0.42 * walkW, -Math.PI / 2, sit01);
    actor.leftLeg.kneePivot.rotation.x = lerp(Math.max(0.04, -c * 0.55) * walkW, Math.PI / 2, sit01);
    actor.rightLeg.kneePivot.rotation.x = lerp(Math.max(0.04, c * 0.55) * walkW, Math.PI / 2, sit01);
    actor.leftLeg.anklePivot.rotation.x = lerp(-s * 0.25 * walkW, 0, sit01);
    actor.rightLeg.anklePivot.rotation.x = lerp(s * 0.25 * walkW, 0, sit01);

    const isTalking = gesture === 'talk' || (isHeroActor && lip.isPlaying && gesture !== 'listen_nod');
    const nodW = gesture === 'listen_nod' ? Math.max(0, Math.sin(t * 7.2)) * 0.22 : 0;
    const talkOsc = isTalking ? Math.sin(t * 7.0) : 0;

    let tPitch = lerp(0.04 * walkW, 0.05, sit01);
    if (gesture === 'shake_hands') tPitch += shakeBlend * 0.26;
    if (gesture === 'hammer_strike') tPitch += Math.sin(t * 5) * 0.25;
    if (gesture === 'duel_guard') tPitch += 0.24;
    actor.torsoPivot.rotation.x = THREE.MathUtils.damp(actor.torsoPivot.rotation.x, tPitch, 8, dt);
    actor.torsoPivot.rotation.y = -s * 0.07 * walkW;
    actor.torsoPivot.rotation.z = s * 0.02 * walkW;

    actor.headPivot.rotation.x = nodW + (isTalking ? Math.sin(t * 6.5) * 0.06 : 0);
    actor.headPivot.rotation.y = isTalking ? Math.sin(t * 2.4) * 0.1 : 0;

    const audioJaw = isHeroActor && lip.isPlaying ? lip.jawOpen * 0.42 : 0;
    const synthJaw = isTalking ? Math.max(0, Math.sin(t * 14.5) * 0.55 + Math.sin(t * 8.2) * 0.45) * 0.36 : 0;
    actor.jawPivot.rotation.x = THREE.MathUtils.damp(
      actor.jawPivot.rotation.x,
      Math.max(audioJaw, synthJaw),
      22,
      dt,
    );
    const lipSc = 1 + (isTalking ? 0.12 : 0);
    actor.upperLip.scale.x = lipSc;
    actor.lowerLip.scale.x = lipSc;

    // Arm gestures mapped per beat
    let lArmX = lerp(0.08 + s * 0.36 * walkW, -0.44, sit01);
    let lArmZ = -0.12;
    let lElbX = lerp(-0.26, -0.84, sit01);
    let rArmX = lerp(0.08 - s * 0.36 * walkW, -0.46, sit01);
    let rArmZ = 0.12;
    let rElbX = lerp(-0.26, -0.82, sit01);

    if (gesture === 'talk') {
      lArmX -= 0.32 - talkOsc * 0.14;
      lElbX -= 0.26;
      rArmX -= 0.36 + talkOsc * 0.14;
      rElbX -= 0.26;
    } else if (gesture === 'wave_bye') {
      const wOsc = Math.sin(t * 10.5) * 0.34;
      rArmX = -2.35;
      rArmZ = 0.48 + wOsc;
      rElbX = -0.72 + wOsc * 0.4;
    } else if (gesture === 'hammer_strike') {
      const cyc = (t * 0.85) % 1;
      const wind = cyc < 0.55 ? Math.sin((cyc / 0.55) * Math.PI * 0.5) : 0;
      const hit = cyc >= 0.55 && cyc < 0.82 ? Math.sin(((cyc - 0.55) / 0.27) * Math.PI) : 0;
      rArmX = cyc < 0.55 ? -2.2 * wind : -0.35 + hit * 0.2;
      rElbX = cyc < 0.55 ? -0.95 : -0.25;
      lArmX = -0.55;
      lElbX = -0.85;
    } else if (gesture === 'raise_torch' || gesture === 'celebrate') {
      rArmX = -2.38 + Math.sin(t * 2.4) * 0.08;
      rArmZ = 0.24;
      rElbX = -0.22;
      if (gesture === 'celebrate') {
        lArmX = -2.2 + Math.cos(t * 2.4) * 0.1;
        lArmZ = -0.24;
        lElbX = -0.25;
      }
    } else if (gesture === 'read_scroll') {
      lArmX = -0.78;
      lElbX = -0.96;
      rArmX = -0.58 + Math.sin(t * 2) * 0.12;
      rElbX = -0.78;
    } else if (gesture === 'duel_guard') {
      rArmX = -1.18;
      rElbX = -0.35;
      lArmX = -0.52;
      lElbX = -0.92;
    }

    actor.leftArm.shoulderPivot.rotation.set(lArmX, 0, lArmZ);
    actor.leftArm.elbowPivot.rotation.x = lElbX;
    actor.rightArm.shoulderPivot.rotation.set(rArmX, 0, rArmZ);
    actor.rightArm.elbowPivot.rotation.x = rElbX;

    if (gesture === 'shake_hands' && shakeBlend > 0.01) {
      aimRightArmToWorld(actor, shakeTarget, shakeBlend);
    }

    actor.capePivot.rotation.x = 0.04 + walkW * 0.15;
    animateCapeVertices(actor, t, walkW * 0.6);
  };

  poseActor(hero, hX, hGroundY, hZ, hSpeed, yawH, sitH, beat.heroGesture, true);
  poseActor(companion, cX, cGroundY, cZ, cSpeed, yawC, sitC, beat.compGesture, false);

  // Eye blinks
  if (t >= p.blinkState.nextBlinkAt) {
    p.blinkState.blinkAmount = 1;
    p.blinkState.nextBlinkAt = t + 3.1 + (Math.sin(t * 17.3) + 1) * 0.9;
  }
  p.blinkState.blinkAmount = THREE.MathUtils.damp(p.blinkState.blinkAmount, 0, 18, dt);
  const lidRot = -0.8 + p.blinkState.blinkAmount * 0.8;
  hero.leftLid.rotation.x = lidRot;
  hero.rightLid.rotation.x = lidRot;
  companion.leftLid.rotation.x = lidRot;
  companion.rightLid.rotation.x = lidRot;

  p.emberMat.emissiveIntensity = 1.45 + (lip.isPlaying ? lip.jawOpen * 1.2 : Math.sin(t * 2) * 0.16);

  // Beat Camera Shot Framing
  let camPos: [number, number, number] = [midX, 2.25, midZ + 5.8];
  let camTarget: [number, number, number] = [midX, 1.25, midZ];
  switch (beat.cameraShot) {
    case 'wide_establishing':
      camPos = [midX, 2.35, Math.max(midZ + 6.4, 4.8)];
      camTarget = [midX, 1.22, midZ];
      break;
    case 'two_shot':
      camPos = [midX + 0.18, 1.85, midZ + 3.6];
      camTarget = [midX, 1.38, midZ];
      break;
    case 'table_dialogue':
      camPos = [tblX + 0.15, 1.85, tblZ + 3.45];
      camTarget = [tblX, 0.95, tblZ];
      break;
    case 'closeup_hero':
      camPos = [hX + 0.12, hGroundY + 1.66, hZ + 1.75];
      camTarget = [hX, hGroundY + 1.52, hZ];
      break;
    case 'low_hero':
      camPos = [hX - 1.15, hGroundY + 0.98, hZ + 3.25];
      camTarget = [hX, hGroundY + 1.48, hZ];
      break;
    case 'track_motion':
      camPos = [hX * 0.7 + 1.1, 2.15, hZ + 4.8];
      camTarget = [hX * 0.85, hGroundY + 1.15, hZ];
      break;
  }

  return {
    cameraOverride: { pos: camPos, target: camTarget },
    usesDialogueTable: stageSet !== 'crossroads_cafe' && usesDialogueTable,
    activeTools: {
      hammer: beat.heroGesture === 'hammer_strike',
      torch: beat.heroGesture === 'raise_torch',
      staff: beat.heroGesture === 'duel_guard',
      scroll: beat.heroGesture === 'read_scroll',
    },
  };
}

export function stepHumanChoreography(p: ChoreographyParams): ChoreographyOutput {
  const {
    t,
    delta,
    action,
    storyActivity: act,
    directorBlocks,
    stageSet,
    actionIntensity: intensity,
    lip,
    hero,
    companion,
    env,
    sceneProgress01,
  } = p;

  if (directorBlocks && directorBlocks.length > 0) {
    return stepCustomDirectorBlocks(p, directorBlocks);
  }

  const dt = Math.max(0.001, Math.min(0.08, delta));
  const isCrossroadsSet = stageSet === 'crossroads_cafe' || act === 'crossroads_meeting';
  const defaultFloorY = isCrossroadsSet ? 0.0 : 0.16;
  const speakBoost = lip.isPlaying ? 0.25 + lip.jawOpen * 0.85 : 0;

  // =========================================================================
  // FULL STORY CHOREOGRAPHY: "Crossroads Meeting, Table Talk, Handshake & Bye"
  // =========================================================================
  if (act === 'crossroads_meeting') {
    const DURATION = 22.0;
    const st = sceneProgress01 !== null ? clamp01(sceneProgress01) * DURATION : t % DURATION;
    const snap = sceneProgress01 !== null && st < 0.06;

    const pA = samplePath(st, PATH_CROSSROADS_A);
    const pB = samplePath(st, PATH_CROSSROADS_B);

    const gYA = getCrossroadsGroundY(pA.x, pA.z);
    const gYB = getCrossroadsGroundY(pB.x, pB.z);

    if (st < dt * 1.5 || snap) {
      hero.stridePhase = 0;
      hero.prevX = pA.x;
      hero.prevZ = pA.z;
      companion.stridePhase = 0;
      companion.prevX = pB.x;
      companion.prevZ = pB.z;
    }

    const sitA = smooth01(st, 11.2, 12.4) * (1 - smooth01(st, 16.8, 17.7));
    const sitB = smooth01(st, 11.3, 12.5);

    const distA = Math.hypot(pA.x - hero.prevX, pA.z - hero.prevZ);
    hero.prevX = pA.x;
    hero.prevZ = pA.z;
    if (pA.speed > 0.08 && sitA < 0.25) hero.stridePhase += distA * 4.3;

    const distB = Math.hypot(pB.x - companion.prevX, pB.z - companion.prevZ);
    companion.prevX = pB.x;
    companion.prevZ = pB.z;
    if (pB.speed > 0.08 && sitB < 0.25) companion.stridePhase += distB * 4.3;

    // Envelopes for meeting, speaking (2s+), nodding, shaking hands, waving bye
    const speakInterA = smooth01(st, 4.1, 4.4) * (1 - smooth01(st, 5.7, 6.0));
    const speakInterB = smooth01(st, 5.6, 5.9) * (1 - smooth01(st, 7.2, 7.5));
    const speakTableA = smooth01(st, 12.6, 12.8) * (1 - smooth01(st, 13.7, 13.9));
    const speakTableB = smooth01(st, 13.6, 13.8) * (1 - smooth01(st, 14.7, 14.9));
    const nodBoth = smooth01(st, 13.3, 13.6) * (1 - smooth01(st, 14.7, 15.0));

    const shakeBlend = smooth01(st, 14.8, 15.3) * (1 - smooth01(st, 16.3, 16.8));
    const pumpY = Math.sin((st - 15.2) * Math.PI * 3.0) * 0.042 * shakeBlend;
    const shakeTarget = new THREE.Vector3(TABLE_X, 0.93 + pumpY, TABLE_Z);

    const waveBye = smooth01(st, 17.6, 17.95) * (1 - smooth01(st, 18.75, 19.1));

    // Yaw orientations
    const yawA =
      st >= 3.9 && st < 7.5
        ? Math.atan2(pB.x - pA.x, pB.z - pA.z)
        : st >= 11.1 && st < 19.1
          ? Math.PI / 2
          : pA.speed > 0.08
            ? Math.atan2(pA.vx, pA.vz)
            : hero.root.rotation.y;

    const yawB =
      st >= 3.9 && st < 7.5
        ? Math.atan2(pA.x - pB.x, pA.z - pB.z)
        : st >= 11.2
          ? -Math.PI / 2
          : pB.speed > 0.08
            ? Math.atan2(pB.vx, pB.vz)
            : companion.root.rotation.y;

    // Position & Pose Helper for both friends
    const applyFriendRig = (
      actor: ArticulatedActor,
      px: number,
      gy: number,
      pz: number,
      speed: number,
      yaw: number,
      sit01: number,
      speak01: number,
      nod01: number,
      wave01: number,
      extraJawBoost: number,
    ) => {
      actor.root.position.set(px, gy, pz);
      actor.root.rotation.y = snap ? yaw : angleDamp(actor.root.rotation.y, yaw, 9, dt);

      const walkW = clamp01(speed / 1.1) * (1 - sit01);
      const s = Math.sin(actor.stridePhase);
      const c = Math.cos(actor.stridePhase);

      actor.pelvisGroup.position.y = lerp(0.88 + Math.abs(s) * 0.025 * walkW, SIT_PELVIS_REL_Y, sit01);
      actor.pelvisGroup.rotation.z = -s * 0.05 * walkW;
      actor.pelvisGroup.rotation.y = s * 0.08 * walkW;

      actor.leftLeg.hipPivot.rotation.x = lerp(s * 0.42 * walkW, -Math.PI / 2, sit01);
      actor.rightLeg.hipPivot.rotation.x = lerp(-s * 0.42 * walkW, -Math.PI / 2, sit01);
      actor.leftLeg.kneePivot.rotation.x = lerp(Math.max(0.04, -c * 0.55) * walkW, Math.PI / 2, sit01);
      actor.rightLeg.kneePivot.rotation.x = lerp(Math.max(0.04, c * 0.55) * walkW, Math.PI / 2, sit01);
      actor.leftLeg.anklePivot.rotation.x = lerp(-s * 0.25 * walkW, 0, sit01);
      actor.rightLeg.anklePivot.rotation.x = lerp(s * 0.25 * walkW, 0, sit01);

      const totalSpeak = Math.max(speak01, extraJawBoost);
      const gestureOsc = totalSpeak * Math.sin(t * 7.2);
      actor.torsoPivot.rotation.x = lerp(0.04 * walkW, 0.05 + shakeBlend * 0.28, sit01);
      actor.torsoPivot.rotation.y = -s * 0.07 * walkW;
      actor.torsoPivot.rotation.z = s * 0.02 * walkW;

      const nodPitch = nod01 * Math.max(0, Math.sin((st - 13.4) * Math.PI * 3.1)) * 0.24;
      actor.headPivot.rotation.x = nodPitch + totalSpeak * Math.sin(t * 6.5) * 0.06;
      actor.headPivot.rotation.y = totalSpeak * Math.sin(t * 2.3) * 0.09;

      const jawVal = Math.max(
        speak01 * Math.max(0, Math.sin(t * 14.5) * 0.55 + Math.sin(t * 8.2) * 0.45) * 0.4,
        extraJawBoost * 0.42,
      );
      actor.jawPivot.rotation.x = THREE.MathUtils.damp(actor.jawPivot.rotation.x, jawVal, 22, dt);
      actor.upperLip.scale.x = 1 + jawVal * 0.25;
      actor.lowerLip.scale.x = 1 + jawVal * 0.25;

      // Left arm natural swing / conversation / seated
      const lArmX = lerp(0.08 + s * 0.36 * walkW, -0.44, sit01) - totalSpeak * 0.3 + gestureOsc * 0.12;
      const lElbX = lerp(-0.26, -0.84, sit01) - totalSpeak * 0.22;
      actor.leftArm.shoulderPivot.rotation.set(lArmX, 0, -0.12);
      actor.leftArm.elbowPivot.rotation.x = lElbX;

      // Right arm: base + wave + exact handshake aim
      let rArmX = lerp(0.08 - s * 0.36 * walkW, -0.46, sit01) - totalSpeak * 0.34 - gestureOsc * 0.12;
      let rArmZ = 0.12;
      let rElbX = lerp(-0.26, -0.82, sit01) - totalSpeak * 0.22;

      if (wave01 > 0.01) {
        const wOsc = Math.sin(t * 10.5) * 0.32;
        rArmX = lerp(rArmX, -2.35, wave01);
        rArmZ = lerp(rArmZ, 0.48 + wOsc, wave01);
        rElbX = lerp(rElbX, -0.72 + wOsc * 0.4, wave01);
      }

      actor.rightArm.shoulderPivot.rotation.set(rArmX, 0, rArmZ);
      actor.rightArm.elbowPivot.rotation.x = rElbX;
      aimRightArmToWorld(actor, shakeTarget, shakeBlend);

      actor.capePivot.rotation.x = 0.04 + walkW * 0.16;
      animateCapeVertices(actor, t, walkW * 0.6);
    };

    const heroVoiceBoost = lip.isPlaying && (st < 13.8 || st > 14.8) ? lip.jawOpen : 0;
    const compVoiceBoost = lip.isPlaying && st >= 13.7 && st <= 14.9 ? lip.jawOpen : 0;

    applyFriendRig(
      hero,
      pA.x,
      gYA,
      pA.z,
      pA.speed,
      yawA,
      sitA,
      Math.max(speakInterA, speakTableA),
      nodBoth,
      waveBye,
      heroVoiceBoost,
    );
    applyFriendRig(
      companion,
      pB.x,
      gYB,
      pB.z,
      pB.speed,
      yawB,
      sitB,
      Math.max(speakInterB, speakTableB),
      nodBoth,
      waveBye * 0.85,
      compVoiceBoost,
    );

    // Blinking
    if (t >= p.blinkState.nextBlinkAt) {
      p.blinkState.blinkAmount = 1;
      p.blinkState.nextBlinkAt = t + 3.1 + (Math.sin(t * 17.3) + 1) * 0.9;
    }
    p.blinkState.blinkAmount = THREE.MathUtils.damp(p.blinkState.blinkAmount, 0, 18, dt);
    const lidRot = -0.8 + p.blinkState.blinkAmount * 0.8;
    hero.leftLid.rotation.x = lidRot;
    hero.rightLid.rotation.x = lidRot;
    companion.leftLid.rotation.x = lidRot;
    companion.rightLid.rotation.x = lidRot;

    p.emberMat.emissiveIntensity = 1.65 + (lip.isPlaying ? lip.jawOpen * 1.1 : Math.sin(t * 2.5) * 0.15);

    // Smooth Beat-By-Beat Camera Tracking
    if (st < 7.6) {
      const zoom = smooth01(st, 3.8, 5.2);
      return {
        cameraOverride: {
          pos: [0, 2.35 - zoom * 0.55, 6.8 - zoom * 2.7],
          target: [0, 1.25, 0],
        },
      };
    }
    if (st < 11.8) {
      const pCam = smooth01(st, 7.6, 11.2);
      return {
        cameraOverride: {
          pos: [2.4, 2.35, 3.2],
          target: [lerp(0.2, TABLE_X, pCam), 1.05, lerp(0, TABLE_Z, pCam)],
        },
      };
    }
    if (st < 19.2) {
      return {
        cameraOverride: {
          pos: [TABLE_X + 0.15, 1.85, TABLE_Z + 3.45],
          target: [TABLE_X, 0.95, TABLE_Z],
        },
      };
    }
    return {
      cameraOverride: {
        pos: [1.2, 2.1, 4.8],
        target: [pA.x * 0.65, 1.05, pA.z],
      },
    };
  }

  // =========================================================================
  // CLASSIC + NARRATIVE STAGE ACTIVITIES (Distance-Locked Feet, Zero Sliding)
  // =========================================================================
  let heroTargetX = 0;
  let heroTargetY = defaultFloorY;
  let heroTargetZ = 0;
  let heroYaw = 0;

  let strideScale = 0;
  let torsoPitch = Math.sin(t * 1.15) * 0.018;
  let torsoYaw = Math.sin(t * 0.58) * 0.04;
  let torsoRoll = 0;
  let headPitch = Math.sin(t * 0.92) * 0.028;
  let headYaw = Math.sin(t * 0.55) * 0.06;

  let lShoulderX = 0.06 + Math.sin(t * 1.15) * 0.025;
  let lShoulderZ = -0.13;
  let lElbowX = -0.34;
  let lWristX = 0.05;
  let rShoulderX = 0.06 - Math.sin(t * 1.15) * 0.025;
  let rShoulderZ = 0.13;
  let rElbowX = -0.34;
  let rWristX = 0.05;
  let browTilt = 0;

  let compX = -1.18;
  let compY = defaultFloorY;
  let compZ = -0.22;
  let compYaw = 0.48;
  let compStrideAmp = 0;
  let compTorsoPitch = 0.04 + Math.sin(t * 1.2 + 0.8) * 0.02;
  let compRShoulderX = -0.18;
  let compRElbowX = -0.55;
  let compLShoulderX = -0.16;
  let compLElbowX = -0.45;

  if (act === 'mentorship_dialogue') {
    const stroll = Math.sin(t * 0.48);
    heroTargetX = stroll * 0.95;
    heroTargetZ = 0.12;
    const velX = Math.cos(t * 0.48) * 0.95 * 0.48;
    heroYaw = velX >= 0 ? 1.25 : -1.25;
    strideScale = Math.abs(velX) > 0.12 ? 0.36 : 0;
    headYaw = -0.35 + Math.sin(t * 1.2) * 0.16;
    headPitch = Math.max(0, Math.sin(t * 2.2)) * 0.12;

    compX = heroTargetX - (velX >= 0 ? 0.65 : -0.65);
    compZ = -0.34;
    compYaw = velX >= 0 ? 1.75 : -1.75;
    compStrideAmp = strideScale;
    compTorsoPitch = 0.06;
    compRShoulderX = -0.52 + Math.sin(t * 2.3) * 0.18;
  } else if (act === 'orator_walk') {
    const walkCycle = t * 0.55;
    heroTargetX = Math.sin(walkCycle) * 0.64;
    heroTargetZ = Math.sin(walkCycle * 2) * 0.18;
    heroYaw = Math.cos(walkCycle) * 0.42;
    strideScale = 0.34;
    headYaw = Math.sin(walkCycle * 0.7) * 0.22;
    compX = -1.24;
    compZ = -0.34;
    compYaw = 0.68 + Math.sin(t * 0.6) * 0.08;
    compTorsoPitch = 0.06 + Math.sin(t * 1.5) * 0.035;
    compRShoulderX = -0.24 + speakBoost * 0.08;
  } else if (act === 'forge_labor') {
    heroTargetX = -0.34;
    heroTargetZ = 0.18;
    heroYaw = 1.15;
    const cycle = (t * 0.78) % 1;
    const windUp = cycle < 0.58 ? Math.sin((cycle / 0.58) * Math.PI * 0.5) : 1 - (cycle - 0.58) / 0.15;
    const strikePhase = cycle >= 0.58 && cycle < 0.82 ? Math.sin(((cycle - 0.58) / 0.24) * Math.PI) : 0;
    const hitShock = cycle >= 0.68 && cycle < 0.86;

    torsoPitch = cycle < 0.58 ? -0.18 * windUp : 0.38 * strikePhase;
    torsoYaw = cycle < 0.58 ? -0.22 * windUp : 0.18 * strikePhase;
    rShoulderX = cycle < 0.58 ? -2.25 * windUp : -0.4 + strikePhase * 0.2;
    rElbowX = cycle < 0.58 ? -0.98 : -0.22;
    rWristX = cycle < 0.58 ? -0.35 : 0.42;
    lShoulderX = -0.58;
    lElbowX = -0.88;
    browTilt = -0.11;
    headPitch = torsoPitch * 0.4;

    env.sparkBurst.scale.setScalar(hitShock ? 1 + (cycle - 0.68) * 7.5 : 0.05);
    env.sparkBurst.visible = hitShock;
    env.hotIngot.scale.y = 1 + Math.sin(t * 9) * 0.08;

    compX = 0.94;
    compZ = -0.2;
    compYaw = -1.08;
    compTorsoPitch = 0.14 + Math.sin(t * 2.4) * 0.12;
    compRShoulderX = -0.72 + Math.sin(t * 2.4) * 0.36;
    compLShoulderX = -0.72 - Math.sin(t * 2.4) * 0.36;
  } else if (act === 'climb_ascent') {
    const climbT = (Math.sin(t * 0.52 - Math.PI * 0.5) + 1) * 0.5;
    heroTargetX = -0.65 + climbT * 1.38;
    heroTargetY = defaultFloorY + 0.22 + climbT * 0.66;
    heroTargetZ = 0.15 - climbT * 0.54;
    heroYaw = 0.95;
    strideScale = 0.48;
    torsoPitch = 0.22;
    rShoulderX = -1.48 + Math.sin(t * 3.8) * 0.12;
    rElbowX = -0.36;
    lShoulderX = Math.cos(t * 3.8) * 0.4;
    lElbowX = -0.64;

    const compClimb = Math.max(0, climbT - 0.26);
    compX = -0.65 + compClimb * 1.38;
    compY = defaultFloorY + 0.22 + compClimb * 0.66;
    compZ = 0.15 - compClimb * 0.54;
    compYaw = 0.95;
    compStrideAmp = 0.45;
    compTorsoPitch = 0.24;
    compRShoulderX = -0.62 + Math.sin(t * 3.8) * 0.24;
  } else if (act === 'scholar_study') {
    heroTargetX = -0.26 + Math.sin(t * 0.42) * 0.14;
    heroTargetZ = 0.2;
    heroYaw = -0.32 + Math.sin(t * 0.52) * 0.42;
    strideScale = 0.12;
    torsoPitch = 0.15;
    lShoulderX = -0.78;
    lElbowX = -0.96;
    rShoulderX = -0.54 + Math.sin(t * 2.1) * 0.15 - speakBoost * 0.25;
    rElbowX = -0.76 + Math.cos(t * 2.4) * 0.18;
    headPitch = 0.18 + Math.sin(t * 1.5) * 0.08;

    compX = 0.85;
    compZ = 0.05;
    compYaw = -0.95;
    compTorsoPitch = 0.25 + Math.sin(t * 1.7) * 0.06;
    compRElbowX = -0.95;
    compLElbowX = -0.95;
  } else if (act === 'duel_overcome') {
    const lunge = (Math.sin(t * 2.2) + 1) * 0.5;
    heroTargetX = -0.55 + lunge * 0.34;
    heroTargetZ = 0.08;
    heroYaw = 1.35;
    strideScale = 0.38;
    torsoPitch = 0.24 + lunge * 0.14;
    torsoYaw = -0.25 + lunge * 0.45;
    rShoulderX = -1.16 - lunge * 0.35;
    rElbowX = -0.34 + lunge * 0.24;
    lShoulderX = -0.45;
    lElbowX = -0.9;
    browTilt = -0.14;

    env.sentinelRoot.position.x = 0.95 + lunge * 0.28;
    env.sentTorso.rotation.z = -lunge * 0.24;
    env.sentTorso.rotation.x = 0.12 - lunge * 0.26;
    env.sentArmPivot.rotation.x = -0.65 + Math.sin(t * 2.2) * 0.55;
    env.sentArmPivot.rotation.z = -0.25 + lunge * 0.35;

    compX = -1.45;
    compZ = -0.55;
    compYaw = 1.05;
    compRShoulderX = -1.2 + Math.sin(t * 3.1) * 0.18;
  } else if (act === 'triumph_raise') {
    heroTargetX = Math.sin(t * 0.48) * 0.18;
    heroTargetZ = 0.26;
    heroYaw = Math.sin(t * 0.48) * 0.14;
    torsoPitch = -0.12;
    rShoulderX = -2.42 + Math.sin(t * 2.1) * 0.08;
    rShoulderZ = 0.24;
    rElbowX = -0.18;
    lShoulderX = -0.4;
    lShoulderZ = -0.36;
    lElbowX = -0.65;
    headPitch = -0.14;

    compX = -1.05;
    compZ = -0.25;
    compYaw = 0.45;
    compRShoulderX = -1.95 + Math.sin(t * 3.0) * 0.14;
    compLShoulderX = -0.3;
  }

  if (act === 'orator_walk' || act === 'scholar_study' || act === 'mentorship_dialogue') {
    const speakMod = lip.isPlaying ? 0.55 + lip.jawOpen * 0.85 : 0.35;
    switch (action) {
      case 'storyteller_gesture':
        lShoulderX = -0.44 * intensity * speakMod + Math.sin(t * 2.1) * 0.14;
        lShoulderZ = -0.24;
        lElbowX = -0.92 + Math.cos(t * 2.3) * 0.18;
        lWristX = -0.15 + Math.sin(t * 3.1) * 0.12;
        rShoulderX = -0.4 * intensity * speakMod + Math.cos(t * 1.9) * 0.16;
        rShoulderZ = 0.24;
        rElbowX = -0.84 + Math.sin(t * 2.3) * 0.18;
        rWristX = -0.15 + Math.cos(t * 2.9) * 0.12;
        break;
      case 'emphasize_point':
        rShoulderX = -1.04 * intensity - speakBoost * 0.28;
        rElbowX = -0.44 + Math.sin(t * 3.8) * 0.12;
        rWristX = -0.2;
        browTilt = -0.09;
        break;
      case 'heroic_stance':
        torsoPitch -= 0.08 * intensity;
        lShoulderZ = -0.32 * intensity;
        rShoulderZ = 0.32 * intensity;
        break;
      case 'dramatic_lean':
        torsoPitch += 0.14 * intensity;
        browTilt = -0.11;
        break;
      default:
        lShoulderX = -0.22 * speakMod + Math.sin(t * 1.6) * 0.08;
        lElbowX = -0.62;
        rShoulderX = -0.24 * speakMod + Math.cos(t * 1.5) * 0.08;
        rElbowX = -0.65;
        break;
    }
  }

  // Distance-Locked Stride Integration (Prevents Sliding!)
  hero.root.position.x = THREE.MathUtils.damp(hero.root.position.x, heroTargetX, 5.2, dt);
  hero.root.position.z = THREE.MathUtils.damp(hero.root.position.z, heroTargetZ, 5.2, dt);
  const stepDist = Math.hypot(hero.root.position.x - hero.prevX, hero.root.position.z - hero.prevZ);
  hero.prevX = hero.root.position.x;
  hero.prevZ = hero.root.position.z;
  if (strideScale > 0) {
    hero.stridePhase += Math.max(stepDist * 4.4, dt * 1.8 * strideScale);
  }

  const heroStride = strideScale > 0 ? Math.sin(hero.stridePhase) : 0;
  const heroCos = strideScale > 0 ? Math.cos(hero.stridePhase) : 0;
  const heroHipBob = strideScale > 0 ? Math.abs(heroStride) * 0.03 : Math.sin(t * 1.15) * 0.008;
  torsoRoll = strideScale > 0 ? heroStride * 0.035 : Math.sin(t * 0.9) * 0.012;

  hero.root.position.y = THREE.MathUtils.damp(hero.root.position.y, heroTargetY + heroHipBob, 8, dt);
  hero.root.rotation.y = angleDamp(hero.root.rotation.y, heroYaw, 5.5, dt);

  hero.pelvisGroup.position.y = THREE.MathUtils.damp(hero.pelvisGroup.position.y, 0.88, 10, dt);
  hero.pelvisGroup.rotation.z = THREE.MathUtils.damp(hero.pelvisGroup.rotation.z, -heroStride * 0.055, 8, dt);
  hero.pelvisGroup.rotation.y = THREE.MathUtils.damp(hero.pelvisGroup.rotation.y, heroStride * 0.09, 8, dt);

  const lHip = heroStride * strideScale;
  const rHip = -heroStride * strideScale;
  const lKnee = strideScale > 0 ? Math.max(0.06, -heroCos * strideScale * 1.25) : 0.05;
  const rKnee = strideScale > 0 ? Math.max(0.06, heroCos * strideScale * 1.25) : 0.05;
  const lAnkle = strideScale > 0 ? -heroStride * strideScale * 0.45 : -0.02;
  const rAnkle = strideScale > 0 ? heroStride * strideScale * 0.45 : -0.02;

  hero.leftLeg.hipPivot.rotation.x = THREE.MathUtils.damp(hero.leftLeg.hipPivot.rotation.x, lHip, 9, dt);
  hero.rightLeg.hipPivot.rotation.x = THREE.MathUtils.damp(hero.rightLeg.hipPivot.rotation.x, rHip, 9, dt);
  hero.leftLeg.kneePivot.rotation.x = THREE.MathUtils.damp(hero.leftLeg.kneePivot.rotation.x, lKnee, 9, dt);
  hero.rightLeg.kneePivot.rotation.x = THREE.MathUtils.damp(hero.rightLeg.kneePivot.rotation.x, rKnee, 9, dt);
  hero.leftLeg.anklePivot.rotation.x = THREE.MathUtils.damp(hero.leftLeg.anklePivot.rotation.x, lAnkle, 9, dt);
  hero.rightLeg.anklePivot.rotation.x = THREE.MathUtils.damp(hero.rightLeg.anklePivot.rotation.x, rAnkle, 9, dt);

  if (t >= p.blinkState.nextBlinkAt) {
    p.blinkState.blinkAmount = 1;
    p.blinkState.nextBlinkAt = t + 3.1 + (Math.sin(t * 17.3) + 1) * 0.9;
  }
  p.blinkState.blinkAmount = THREE.MathUtils.damp(p.blinkState.blinkAmount, 0, 18, dt);
  const lidRot = -0.8 + p.blinkState.blinkAmount * 0.8;
  hero.leftLid.rotation.x = lidRot;
  hero.rightLid.rotation.x = lidRot;
  const gazeX = Math.sin(t * 0.78) * 0.0028;
  hero.leftIris.position.x = gazeX;
  hero.rightIris.position.x = gazeX;

  const jawAngle = lip.isPlaying ? Math.min(0.46, lip.jawOpen * 0.42) : 0.008;
  const speakingNod = lip.isPlaying ? lip.jawOpen * 0.08 : 0;

  hero.torsoPivot.rotation.x = THREE.MathUtils.damp(hero.torsoPivot.rotation.x, torsoPitch, 8, dt);
  hero.torsoPivot.rotation.y = THREE.MathUtils.damp(
    hero.torsoPivot.rotation.y,
    torsoYaw - heroStride * 0.08,
    7,
    dt,
  );
  hero.torsoPivot.rotation.z = THREE.MathUtils.damp(hero.torsoPivot.rotation.z, torsoRoll, 7, dt);
  hero.capePivot.rotation.z = THREE.MathUtils.damp(hero.capePivot.rotation.z, -torsoYaw * 0.45, 5, dt);
  hero.capePivot.rotation.x = THREE.MathUtils.damp(
    hero.capePivot.rotation.x,
    0.05 + (strideScale > 0 ? Math.abs(heroStride) * 0.14 : 0) + Math.max(0, -torsoPitch * 0.38),
    5,
    dt,
  );
  animateCapeVertices(hero, t, strideScale + speakBoost * 0.2);

  hero.headPivot.rotation.x = THREE.MathUtils.damp(hero.headPivot.rotation.x, headPitch + speakingNod, 10, dt);
  hero.headPivot.rotation.y = THREE.MathUtils.damp(hero.headPivot.rotation.y, headYaw, 7, dt);

  hero.jawPivot.rotation.x = THREE.MathUtils.damp(hero.jawPivot.rotation.x, jawAngle, 22, dt);
  const spreadScale = 1 + (lip.isPlaying ? lip.lipSpread * 0.16 : 0);
  hero.upperLip.scale.x = THREE.MathUtils.damp(hero.upperLip.scale.x, spreadScale, 18, dt);
  hero.lowerLip.scale.x = THREE.MathUtils.damp(hero.lowerLip.scale.x, spreadScale, 18, dt);

  const browLift = lip.isPlaying ? 0.232 + lip.jawOpen * 0.015 : 0.232;
  hero.leftBrow.position.y = THREE.MathUtils.damp(hero.leftBrow.position.y, browLift, 14, dt);
  hero.rightBrow.position.y = THREE.MathUtils.damp(hero.rightBrow.position.y, browLift, 14, dt);
  hero.leftBrow.rotation.z = THREE.MathUtils.damp(hero.leftBrow.rotation.z, Math.PI / 2 + browTilt, 10, dt);
  hero.rightBrow.rotation.z = THREE.MathUtils.damp(hero.rightBrow.rotation.z, Math.PI / 2 - browTilt, 10, dt);

  if (hero.medallionGroup && hero.medallionMesh) {
    hero.medallionGroup.rotation.z += dt * (0.45 + (lip.isPlaying ? lip.jawOpen * 2.8 : 0));
    hero.medallionMesh.rotation.y += dt * 1.2;
  }
  p.emberMat.emissiveIntensity = 1.25 + (lip.isPlaying ? lip.jawOpen * 1.6 : Math.sin(t * 2) * 0.18);
  p.runeMat.emissiveIntensity = 0.72 + (lip.isPlaying ? lip.jawOpen * 0.9 : Math.sin(t * 1.5) * 0.14);

  hero.leftArm.shoulderPivot.rotation.x = THREE.MathUtils.damp(hero.leftArm.shoulderPivot.rotation.x, lShoulderX, 8, dt);
  hero.leftArm.shoulderPivot.rotation.y = THREE.MathUtils.damp(hero.leftArm.shoulderPivot.rotation.y, 0, 8, dt);
  hero.leftArm.shoulderPivot.rotation.z = THREE.MathUtils.damp(hero.leftArm.shoulderPivot.rotation.z, lShoulderZ, 8, dt);
  hero.leftArm.elbowPivot.rotation.x = THREE.MathUtils.damp(hero.leftArm.elbowPivot.rotation.x, lElbowX, 8, dt);
  hero.leftArm.wristPivot.rotation.x = THREE.MathUtils.damp(hero.leftArm.wristPivot.rotation.x, lWristX, 8, dt);

  hero.rightArm.shoulderPivot.rotation.x = THREE.MathUtils.damp(hero.rightArm.shoulderPivot.rotation.x, rShoulderX, 9, dt);
  hero.rightArm.shoulderPivot.rotation.y = THREE.MathUtils.damp(hero.rightArm.shoulderPivot.rotation.y, 0, 9, dt);
  hero.rightArm.shoulderPivot.rotation.z = THREE.MathUtils.damp(hero.rightArm.shoulderPivot.rotation.z, rShoulderZ, 9, dt);
  hero.rightArm.elbowPivot.rotation.x = THREE.MathUtils.damp(hero.rightArm.elbowPivot.rotation.x, rElbowX, 9, dt);
  hero.rightArm.wristPivot.rotation.x = THREE.MathUtils.damp(hero.rightArm.wristPivot.rotation.x, rWristX, 9, dt);

  // Companion Biomechanics + Zero-Slide Stride
  companion.root.position.x = THREE.MathUtils.damp(companion.root.position.x, compX, 5, dt);
  companion.root.position.z = THREE.MathUtils.damp(companion.root.position.z, compZ, 5, dt);
  const compStepDist = Math.hypot(companion.root.position.x - companion.prevX, companion.root.position.z - companion.prevZ);
  companion.prevX = companion.root.position.x;
  companion.prevZ = companion.root.position.z;
  if (compStrideAmp > 0) {
    companion.stridePhase += Math.max(compStepDist * 4.4, dt * 1.8 * compStrideAmp);
  }
  const compStrideSin = compStrideAmp > 0 ? Math.sin(companion.stridePhase) : 0;
  const compBob = compStrideAmp > 0 ? Math.abs(compStrideSin) * 0.024 : Math.sin(t * 1.4 + 1) * 0.008;

  companion.pelvisGroup.position.y = THREE.MathUtils.damp(companion.pelvisGroup.position.y, 0.88, 10, dt);
  companion.root.position.y = THREE.MathUtils.damp(companion.root.position.y, compY + compBob, 8, dt);
  companion.root.rotation.y = angleDamp(companion.root.rotation.y, compYaw, 5, dt);
  companion.leftLeg.hipPivot.rotation.x = THREE.MathUtils.damp(companion.leftLeg.hipPivot.rotation.x, compStrideSin * compStrideAmp, 8, dt);
  companion.rightLeg.hipPivot.rotation.x = THREE.MathUtils.damp(companion.rightLeg.hipPivot.rotation.x, -compStrideSin * compStrideAmp, 8, dt);
  companion.leftLeg.kneePivot.rotation.x = THREE.MathUtils.damp(companion.leftLeg.kneePivot.rotation.x, compStrideAmp > 0 ? Math.max(0.05, -Math.cos(companion.stridePhase) * compStrideAmp) : 0.04, 8, dt);
  companion.rightLeg.kneePivot.rotation.x = THREE.MathUtils.damp(companion.rightLeg.kneePivot.rotation.x, compStrideAmp > 0 ? Math.max(0.05, Math.cos(companion.stridePhase) * compStrideAmp) : 0.04, 8, dt);
  companion.torsoPivot.rotation.x = THREE.MathUtils.damp(companion.torsoPivot.rotation.x, compTorsoPitch, 6, dt);
  companion.headPivot.rotation.x = Math.sin(t * 1.9 + 0.5) * 0.055;
  companion.rightArm.shoulderPivot.rotation.x = THREE.MathUtils.damp(companion.rightArm.shoulderPivot.rotation.x, compRShoulderX, 6, dt);
  companion.rightArm.shoulderPivot.rotation.y = THREE.MathUtils.damp(companion.rightArm.shoulderPivot.rotation.y, 0, 6, dt);
  companion.rightArm.shoulderPivot.rotation.z = THREE.MathUtils.damp(companion.rightArm.shoulderPivot.rotation.z, 0.13, 6, dt);
  companion.rightArm.elbowPivot.rotation.x = THREE.MathUtils.damp(companion.rightArm.elbowPivot.rotation.x, compRElbowX, 6, dt);
  companion.leftArm.shoulderPivot.rotation.x = THREE.MathUtils.damp(companion.leftArm.shoulderPivot.rotation.x, compLShoulderX, 6, dt);
  companion.leftArm.shoulderPivot.rotation.y = THREE.MathUtils.damp(companion.leftArm.shoulderPivot.rotation.y, 0, 6, dt);
  companion.leftArm.shoulderPivot.rotation.z = THREE.MathUtils.damp(companion.leftArm.shoulderPivot.rotation.z, -0.13, 6, dt);
  companion.leftArm.elbowPivot.rotation.x = THREE.MathUtils.damp(companion.leftArm.elbowPivot.rotation.x, compLElbowX, 6, dt);
  animateCapeVertices(companion, t + 1.3, compStrideAmp);

  return {};
}
