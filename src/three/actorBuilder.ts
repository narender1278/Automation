import * as THREE from 'three';

export interface ArticulatedLeg {
  hipPivot: THREE.Group;
  kneePivot: THREE.Group;
  anklePivot: THREE.Group;
}

export interface ArticulatedArm {
  shoulderPivot: THREE.Group;
  elbowPivot: THREE.Group;
  wristPivot: THREE.Group;
  propMount: THREE.Group;
}

export interface ArticulatedActor {
  root: THREE.Group;
  pelvisGroup: THREE.Group;
  torsoPivot: THREE.Group;
  headPivot: THREE.Group;
  jawPivot: THREE.Group;
  upperLip: THREE.Mesh;
  lowerLip: THREE.Mesh;
  leftLid: THREE.Mesh;
  rightLid: THREE.Mesh;
  leftIris: THREE.Mesh;
  rightIris: THREE.Mesh;
  leftBrow: THREE.Mesh;
  rightBrow: THREE.Mesh;
  capePivot: THREE.Group;
  capeMesh: THREE.Mesh;
  capeBasePositions: Float32Array;
  leftLeg: ArticulatedLeg;
  rightLeg: ArticulatedLeg;
  leftArm: ArticulatedArm;
  rightArm: ArticulatedArm;
  rightHandTip: THREE.Object3D;
  medallionGroup: THREE.Group | null;
  medallionMesh: THREE.Mesh | null;
  stridePhase: number;
  prevX: number;
  prevZ: number;
}

export interface ActorSharedAssets {
  disposables: { dispose: () => void }[];
  buildActor: (opts: {
    robeMat: THREE.MeshStandardMaterial;
    skinMat: THREE.MeshStandardMaterial;
    cloakMat: THREE.MeshStandardMaterial;
    withBeard: boolean;
    withMedallion: boolean;
    irisColor?: number;
  }) => ArticulatedActor;
  attachHeroProps: (hero: ArticulatedActor) => {
    hammerGroup: THREE.Group;
    torchGroup: THREE.Group;
    torchFlame: THREE.Mesh;
    staffGroup: THREE.Group;
    scrollPropGroup: THREE.Group;
    parchmentMat: THREE.MeshStandardMaterial;
  };
}

function createSculptedTorsoGeometry(): THREE.LatheGeometry {
  // Anatomical male/orator torso silhouette from waist -> ribcage -> broad chest -> collar base
  const pts = [
    new THREE.Vector2(0.01, 0.0),
    new THREE.Vector2(0.185, 0.02),
    new THREE.Vector2(0.195, 0.14),
    new THREE.Vector2(0.235, 0.30),
    new THREE.Vector2(0.268, 0.45),
    new THREE.Vector2(0.252, 0.54),
    new THREE.Vector2(0.125, 0.60),
    new THREE.Vector2(0.088, 0.63),
  ];
  return new THREE.LatheGeometry(pts, 28);
}

function createSculptedLimbGeometry(
  topR: number,
  midR: number,
  botR: number,
  length: number,
): THREE.LatheGeometry {
  // Smooth anatomical muscle taper from upper joint downward
  const pts = [
    new THREE.Vector2(botR * 0.92, -length),
    new THREE.Vector2(botR, -length * 0.85),
    new THREE.Vector2(midR, -length * 0.42),
    new THREE.Vector2(topR, -length * 0.12),
    new THREE.Vector2(topR * 0.9, 0),
  ];
  return new THREE.LatheGeometry(pts, 18);
}

function createLipCurveGeometry(width: number, thickness: number, arch: number): THREE.TubeGeometry {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-width, -0.002, -0.01),
    new THREE.Vector3(-width * 0.4, arch, 0.006),
    new THREE.Vector3(0, arch * 0.65, 0.01),
    new THREE.Vector3(width * 0.4, arch, 0.006),
    new THREE.Vector3(width, -0.002, -0.01),
  ]);
  return new THREE.TubeGeometry(curve, 14, thickness, 8, false);
}

export function createActorAssetFactory(
  scene: THREE.Scene,
  mats: {
    brassMat: THREE.MeshStandardMaterial;
    darkBronzeMat: THREE.MeshStandardMaterial;
    emberMat: THREE.MeshStandardMaterial;
    shadowTex: THREE.CanvasTexture;
    robeHighlightMat?: THREE.MeshStandardMaterial;
  },
): ActorSharedAssets {
  const disposables: { dispose: () => void }[] = [];

  const lipMat = new THREE.MeshStandardMaterial({ color: 0xa25a4e, roughness: 0.46, metalness: 0.04 });
  const innerMouthMat = new THREE.MeshStandardMaterial({ color: 0x1a090a, roughness: 0.95 });
  const eyeWhiteMat = new THREE.MeshStandardMaterial({ color: 0xf4f6f9, roughness: 0.16 });
  const catchlightMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const hairMat = new THREE.MeshStandardMaterial({ color: 0x1d1714, roughness: 0.72, metalness: 0.08 });
  const socketShadowMat = new THREE.MeshStandardMaterial({ color: 0x8e634c, roughness: 0.82 });
  const parchmentMat = new THREE.MeshStandardMaterial({ color: 0xe6d6b8, roughness: 0.66, metalness: 0.04 });
  disposables.push(lipMat, innerMouthMat, eyeWhiteMat, catchlightMat, hairMat, socketShadowMat, parchmentMat);

  // Sculpted Anatomical Geometries
  const pelvisGeo = new THREE.SphereGeometry(0.215, 22, 16);
  const splitTunicGeo = new THREE.CylinderGeometry(0.21, 0.31, 0.56, 20, 4, true, Math.PI * 0.4, Math.PI * 1.2);
  const waistSashGeo = new THREE.TorusGeometry(0.205, 0.038, 12, 28);
  const buckleGeo = new THREE.TorusGeometry(0.052, 0.011, 10, 22);
  const torsoGeo = createSculptedTorsoGeometry();
  const mantleGeo = new THREE.TorusGeometry(0.25, 0.056, 14, 32, Math.PI * 1.44);
  const collarGeo = new THREE.CylinderGeometry(0.145, 0.175, 0.11, 22, 1, true, Math.PI * 0.66, Math.PI * 1.68);
  // Multi-row cape cylinder arc so we can ripple cloth waves smoothly every frame
  const capeGeo = new THREE.CylinderGeometry(0.20, 0.46, 1.28, 18, 12, true, Math.PI * 0.72, Math.PI * 0.56);
  const thighGeo = createSculptedLimbGeometry(0.088, 0.078, 0.062, 0.42);
  const kneeJointGeo = new THREE.SphereGeometry(0.06, 14, 12);
  const shinGeo = createSculptedLimbGeometry(0.064, 0.066, 0.045, 0.41);
  const bootUpperGeo = new THREE.CapsuleGeometry(0.056, 0.11, 8, 14);
  const bootSoleGeo = new THREE.BoxGeometry(0.105, 0.028, 0.22);

  const shoulderJointGeo = new THREE.SphereGeometry(0.078, 16, 14);
  const pauldronTrimGeo = new THREE.TorusGeometry(0.076, 0.01, 10, 20);
  const upperArmGeo = createSculptedLimbGeometry(0.058, 0.054, 0.044, 0.29);
  const elbowJointGeo = new THREE.SphereGeometry(0.044, 12, 12);
  const forearmGeo = createSculptedLimbGeometry(0.046, 0.044, 0.032, 0.26);
  const cuffGeo = new THREE.CylinderGeometry(0.039, 0.036, 0.038, 16);
  const palmGeo = new THREE.CapsuleGeometry(0.028, 0.045, 8, 12);
  const fingerClusterGeo = new THREE.CapsuleGeometry(0.024, 0.042, 6, 10);
  const thumbGeo = new THREE.CapsuleGeometry(0.011, 0.028, 6, 8);

  const neckGeo = createSculptedLimbGeometry(0.072, 0.076, 0.088, 0.14);
  const craniumGeo = new THREE.SphereGeometry(0.186, 26, 22);
  const cheekContourGeo = new THREE.SphereGeometry(0.145, 20, 16);
  const earGeo = new THREE.SphereGeometry(0.032, 12, 10);
  const hairCrownGeo = new THREE.SphereGeometry(0.194, 24, 20, 0, Math.PI * 2, 0, Math.PI * 0.56);
  const hairBackGeo = new THREE.CylinderGeometry(0.165, 0.185, 0.16, 18, 1, true, Math.PI * 0.65, Math.PI * 0.7);
  const noseBridgeGeo = new THREE.CapsuleGeometry(0.017, 0.052, 6, 10);
  const noseTipGeo = new THREE.SphereGeometry(0.021, 12, 10);
  const socketGeo = new THREE.SphereGeometry(0.032, 12, 10);
  const eyeGeo = new THREE.SphereGeometry(0.022, 16, 14);
  const irisGeo = new THREE.SphereGeometry(0.0125, 12, 12);
  const catchlightGeo = new THREE.SphereGeometry(0.004, 8, 8);
  const lidGeo = new THREE.SphereGeometry(0.0245, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.54);
  const browGeo = new THREE.CapsuleGeometry(0.007, 0.042, 6, 8);
  const cavityGeo = new THREE.SphereGeometry(0.034, 12, 10);
  const upperLipGeo = createLipCurveGeometry(0.034, 0.0075, 0.005);
  const lowerLipGeo = createLipCurveGeometry(0.031, 0.008, -0.003);
  const jawGeo = new THREE.SphereGeometry(0.132, 20, 16, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55);
  const chinGeo = new THREE.SphereGeometry(0.052, 14, 12);
  const beardGeo = new THREE.CylinderGeometry(0.118, 0.072, 0.11, 18, 1, false, -Math.PI * 0.48, Math.PI * 0.96);

  const medallionRingGeo = new THREE.TorusGeometry(0.054, 0.009, 10, 26);
  const medallionGeo = new THREE.OctahedronGeometry(0.038, 0);
  const contactGeo = new THREE.PlaneGeometry(1.42, 1.42);

  disposables.push(
    pelvisGeo, splitTunicGeo, waistSashGeo, buckleGeo, torsoGeo, mantleGeo, collarGeo, capeGeo,
    thighGeo, kneeJointGeo, shinGeo, bootUpperGeo, bootSoleGeo,
    shoulderJointGeo, pauldronTrimGeo, upperArmGeo, elbowJointGeo, forearmGeo, cuffGeo,
    palmGeo, fingerClusterGeo, thumbGeo,
    neckGeo, craniumGeo, cheekContourGeo, earGeo, hairCrownGeo, hairBackGeo,
    noseBridgeGeo, noseTipGeo, socketGeo, eyeGeo, irisGeo, catchlightGeo, lidGeo, browGeo,
    cavityGeo, upperLipGeo, lowerLipGeo, jawGeo, chinGeo, beardGeo,
    medallionRingGeo, medallionGeo, contactGeo,
  );

  function buildActor(opts: {
    robeMat: THREE.MeshStandardMaterial;
    skinMat: THREE.MeshStandardMaterial;
    cloakMat: THREE.MeshStandardMaterial;
    withBeard: boolean;
    withMedallion: boolean;
    irisColor?: number;
  }): ArticulatedActor {
    const root = new THREE.Group();
    root.position.set(0, 0.16, 0);
    scene.add(root);

    const doubleCloak = opts.cloakMat.clone();
    doubleCloak.side = THREE.DoubleSide;
    const doubleRobe = opts.robeMat.clone();
    doubleRobe.side = THREE.DoubleSide;
    const irisMat = new THREE.MeshStandardMaterial({
      color: opts.irisColor ?? 0x26354d,
      roughness: 0.12,
      metalness: 0.16,
    });
    const contactMat = new THREE.MeshBasicMaterial({
      map: mats.shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.58,
    });
    disposables.push(doubleCloak, doubleRobe, irisMat, contactMat);

    const shadow = new THREE.Mesh(contactGeo, contactMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.008;
    root.add(shadow);

    // Pelvis at human hip height (0.88m above sole plane)
    const pelvisGroup = new THREE.Group();
    pelvisGroup.position.y = 0.88;
    root.add(pelvisGroup);

    const pelvisMesh = new THREE.Mesh(pelvisGeo, opts.cloakMat);
    pelvisMesh.scale.set(0.98, 0.58, 0.78);
    pelvisMesh.castShadow = true;
    pelvisGroup.add(pelvisMesh);

    const tunicWrap = new THREE.Mesh(splitTunicGeo, doubleRobe);
    tunicWrap.position.y = -0.26;
    tunicWrap.castShadow = true;
    pelvisGroup.add(tunicWrap);

    function buildLeg(side: -1 | 1): ArticulatedLeg {
      const hipPivot = new THREE.Group();
      hipPivot.position.set(side * 0.118, -0.02, 0);
      pelvisGroup.add(hipPivot);

      const thigh = new THREE.Mesh(thighGeo, opts.cloakMat);
      thigh.castShadow = true;
      hipPivot.add(thigh);

      const kneePivot = new THREE.Group();
      kneePivot.position.y = -0.42;
      hipPivot.add(kneePivot);

      const kneeCap = new THREE.Mesh(kneeJointGeo, opts.cloakMat);
      kneeCap.castShadow = true;
      kneePivot.add(kneeCap);

      const shin = new THREE.Mesh(shinGeo, opts.cloakMat);
      shin.castShadow = true;
      kneePivot.add(shin);

      const anklePivot = new THREE.Group();
      anklePivot.position.y = -0.405;
      kneePivot.add(anklePivot);

      const bootUpper = new THREE.Mesh(bootUpperGeo, mats.darkBronzeMat);
      bootUpper.position.set(0, 0.015, 0.045);
      bootUpper.rotation.x = Math.PI / 2;
      bootUpper.castShadow = true;

      const bootSole = new THREE.Mesh(bootSoleGeo, opts.cloakMat);
      bootSole.position.set(0, -0.036, 0.055);
      bootSole.castShadow = true;

      anklePivot.add(bootUpper, bootSole);

      return { hipPivot, kneePivot, anklePivot };
    }

    const leftLeg = buildLeg(-1);
    const rightLeg = buildLeg(1);

    // Sculpted Upper Torso Pivot
    const torsoPivot = new THREE.Group();
    torsoPivot.position.y = 0.04;
    pelvisGroup.add(torsoPivot);

    const sashMesh = new THREE.Mesh(waistSashGeo, opts.cloakMat);
    sashMesh.rotation.x = Math.PI / 2;
    sashMesh.scale.set(1, 0.82, 1.1);
    sashMesh.position.y = 0.02;
    const buckleMesh = new THREE.Mesh(buckleGeo, mats.brassMat);
    buckleMesh.position.set(0, 0.02, 0.215);
    torsoPivot.add(sashMesh, buckleMesh);

    const chestMesh = new THREE.Mesh(torsoGeo, opts.robeMat);
    chestMesh.scale.set(1.04, 1.0, 0.78);
    chestMesh.castShadow = true;
    torsoPivot.add(chestMesh);

    const lapelGeo = new THREE.BoxGeometry(0.055, 0.34, 0.032);
    disposables.push(lapelGeo);
    [-1, 1].forEach((side) => {
      const lapel = new THREE.Mesh(lapelGeo, opts.cloakMat);
      lapel.position.set(side * 0.068, 0.42, 0.185);
      lapel.rotation.z = side * -0.22;
      lapel.rotation.x = -0.18;
      torsoPivot.add(lapel);
    });

    const mantleMesh = new THREE.Mesh(mantleGeo, opts.cloakMat);
    mantleMesh.rotation.x = Math.PI / 2;
    mantleMesh.rotation.z = -Math.PI * 0.22;
    mantleMesh.position.set(0, 0.56, -0.02);
    mantleMesh.castShadow = true;

    const collarMesh = new THREE.Mesh(collarGeo, doubleCloak);
    collarMesh.position.set(0, 0.61, -0.02);
    torsoPivot.add(mantleMesh, collarMesh);

    // Dynamic Vertex-Wave Cloak (owns its own cloned geometry so each actor waves independently)
    const capePivot = new THREE.Group();
    capePivot.position.set(0, 0.55, -0.19);
    torsoPivot.add(capePivot);

    const actorCapeGeo = capeGeo.clone();
    disposables.push(actorCapeGeo);
    const capeBasePositions = new Float32Array(
      (actorCapeGeo.attributes.position as THREE.BufferAttribute).array as Float32Array,
    );
    const capeMesh = new THREE.Mesh(actorCapeGeo, doubleCloak);
    capeMesh.position.set(0, -0.62, 0.02);
    capeMesh.castShadow = true;
    capePivot.add(capeMesh);

    let medallionGroup: THREE.Group | null = null;
    let medallionMesh: THREE.Mesh | null = null;
    if (opts.withMedallion) {
      medallionGroup = new THREE.Group();
      medallionGroup.position.set(0, 0.41, 0.218);
      const mRing = new THREE.Mesh(medallionRingGeo, mats.brassMat);
      medallionMesh = new THREE.Mesh(medallionGeo, mats.emberMat);
      medallionGroup.add(mRing, medallionMesh);
      torsoPivot.add(medallionGroup);
    }

    // Neck & Sculpted Head
    const neckMesh = new THREE.Mesh(neckGeo, opts.skinMat);
    neckMesh.position.y = 0.74;
    torsoPivot.add(neckMesh);

    const headPivot = new THREE.Group();
    headPivot.position.set(0, 0.72, 0.01);
    torsoPivot.add(headPivot);

    const craniumMesh = new THREE.Mesh(craniumGeo, opts.skinMat);
    craniumMesh.position.y = 0.165;
    craniumMesh.scale.set(0.86, 1.08, 0.94);
    craniumMesh.castShadow = true;

    const cheekboneMesh = new THREE.Mesh(cheekContourGeo, opts.skinMat);
    cheekboneMesh.position.set(0, 0.135, 0.048);
    cheekboneMesh.scale.set(0.98, 0.78, 0.92);
    headPivot.add(craniumMesh, cheekboneMesh);

    const leftEar = new THREE.Mesh(earGeo, opts.skinMat);
    leftEar.position.set(-0.158, 0.155, -0.012);
    leftEar.scale.set(0.42, 0.95, 0.68);
    const rightEar = new THREE.Mesh(earGeo, opts.skinMat);
    rightEar.position.set(0.158, 0.155, -0.012);
    rightEar.scale.set(0.42, 0.95, 0.68);
    headPivot.add(leftEar, rightEar);

    const hairCrown = new THREE.Mesh(hairCrownGeo, hairMat);
    hairCrown.position.set(0, 0.188, -0.012);
    hairCrown.rotation.x = -0.26;
    hairCrown.scale.set(0.90, 1.05, 0.98);
    const hairBack = new THREE.Mesh(hairBackGeo, hairMat);
    hairBack.position.set(0, 0.105, -0.028);
    hairBack.rotation.y = Math.PI;
    headPivot.add(hairCrown, hairBack);

    const noseBridge = new THREE.Mesh(noseBridgeGeo, opts.skinMat);
    noseBridge.position.set(0, 0.155, 0.172);
    noseBridge.rotation.x = -0.22;
    const noseTip = new THREE.Mesh(noseTipGeo, opts.skinMat);
    noseTip.position.set(0, 0.132, 0.188);
    noseTip.scale.set(0.92, 0.85, 1.0);
    headPivot.add(noseBridge, noseTip);

    // Subtle sunken orbital sockets + expressive eyes + catchlights
    function buildEye(side: -1 | 1) {
      const x = side * 0.058;
      const socket = new THREE.Mesh(socketGeo, socketShadowMat);
      socket.position.set(x, 0.194, 0.145);
      socket.scale.set(1.1, 0.72, 0.55);

      const eye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
      eye.position.set(x, 0.194, 0.158);

      const iris = new THREE.Mesh(irisGeo, irisMat);
      iris.position.set(0, 0, 0.0155);

      const catchlight = new THREE.Mesh(catchlightGeo, catchlightMat);
      catchlight.position.set(0.004, 0.005, 0.01);
      iris.add(catchlight);
      eye.add(iris);

      const lid = new THREE.Mesh(lidGeo, opts.skinMat);
      lid.position.set(x, 0.194, 0.158);
      lid.rotation.x = -0.8;

      const brow = new THREE.Mesh(browGeo, hairMat);
      brow.position.set(x, 0.232, 0.168);
      brow.rotation.z = Math.PI / 2;
      brow.rotation.y = side * -0.12;

      headPivot.add(socket, eye, lid, brow);
      return { iris, lid, brow };
    }

    const leftEyeRig = buildEye(-1);
    const rightEyeRig = buildEye(1);

    const mouthCavity = new THREE.Mesh(cavityGeo, innerMouthMat);
    mouthCavity.position.set(0, 0.072, 0.156);
    mouthCavity.scale.set(1.0, 0.55, 0.65);

    const upperLip = new THREE.Mesh(upperLipGeo, lipMat);
    upperLip.position.set(0, 0.082, 0.172);
    headPivot.add(mouthCavity, upperLip);

    // Articulated Jaw + Sculpted Chin + Groomed Jaw Beard
    const jawPivot = new THREE.Group();
    jawPivot.position.set(0, 0.082, 0.042);
    headPivot.add(jawPivot);

    const lowerJawMesh = new THREE.Mesh(jawGeo, opts.skinMat);
    lowerJawMesh.position.set(0, 0.012, 0.022);
    lowerJawMesh.scale.set(0.84, 0.88, 0.94);

    const chinMesh = new THREE.Mesh(chinGeo, opts.skinMat);
    chinMesh.position.set(0, -0.056, 0.095);
    chinMesh.scale.set(0.9, 0.85, 0.9);
    jawPivot.add(lowerJawMesh, chinMesh);

    const lowerLip = new THREE.Mesh(lowerLipGeo, lipMat);
    lowerLip.position.set(0, -0.01, 0.128);
    jawPivot.add(lowerLip);

    if (opts.withBeard) {
      const beardMesh = new THREE.Mesh(beardGeo, hairMat);
      beardMesh.position.set(0, -0.048, 0.036);
      beardMesh.scale.set(1.02, 0.95, 0.98);
      jawPivot.add(beardMesh);
    }

    function buildArm(side: -1 | 1): ArticulatedArm {
      const shoulderPivot = new THREE.Group();
      shoulderPivot.position.set(side * 0.295, 0.515, 0);

      const shoulderCap = new THREE.Mesh(shoulderJointGeo, opts.cloakMat);
      shoulderCap.scale.set(1.04, 0.92, 1.04);
      shoulderCap.castShadow = true;
      shoulderPivot.add(shoulderCap);

      const pauldronTrim = new THREE.Mesh(pauldronTrimGeo, mats.brassMat);
      pauldronTrim.rotation.y = Math.PI / 2;
      shoulderPivot.add(pauldronTrim);

      const upperArm = new THREE.Mesh(upperArmGeo, opts.robeMat);
      upperArm.castShadow = true;
      shoulderPivot.add(upperArm);

      const elbowPivot = new THREE.Group();
      elbowPivot.position.y = -0.29;
      shoulderPivot.add(elbowPivot);

      const elbowCap = new THREE.Mesh(elbowJointGeo, opts.robeMat);
      elbowPivot.add(elbowCap);

      const forearm = new THREE.Mesh(forearmGeo, opts.robeMat);
      forearm.castShadow = true;
      elbowPivot.add(forearm);

      const cuff = new THREE.Mesh(cuffGeo, mats.brassMat);
      cuff.position.y = -0.245;
      elbowPivot.add(cuff);

      const wristPivot = new THREE.Group();
      wristPivot.position.y = -0.275;
      elbowPivot.add(wristPivot);

      const palm = new THREE.Mesh(palmGeo, opts.skinMat);
      palm.position.y = -0.035;
      palm.scale.set(0.75, 1, 1.15);
      wristPivot.add(palm);

      const fingers = new THREE.Mesh(fingerClusterGeo, opts.skinMat);
      fingers.position.set(0, -0.088, 0.012);
      fingers.rotation.x = 0.28;
      fingers.scale.set(0.7, 1, 1.12);
      wristPivot.add(fingers);

      const thumb = new THREE.Mesh(thumbGeo, opts.skinMat);
      thumb.position.set(-side * 0.022, -0.032, 0.032);
      thumb.rotation.x = 0.52;
      thumb.rotation.z = side * 0.46;
      wristPivot.add(thumb);

      const propMount = new THREE.Group();
      propMount.position.set(0, -0.068, 0.036);
      wristPivot.add(propMount);

      torsoPivot.add(shoulderPivot);
      return { shoulderPivot, elbowPivot, wristPivot, propMount };
    }

    const leftArm = buildArm(-1);
    const rightArm = buildArm(1);
    const rightHandTip = new THREE.Object3D();
    rightHandTip.position.set(0, -0.075, 0.015);
    rightArm.wristPivot.add(rightHandTip);

    return {
      root,
      pelvisGroup,
      torsoPivot,
      headPivot,
      jawPivot,
      upperLip,
      lowerLip,
      leftLid: leftEyeRig.lid,
      rightLid: rightEyeRig.lid,
      leftIris: leftEyeRig.iris,
      rightIris: rightEyeRig.iris,
      leftBrow: leftEyeRig.brow,
      rightBrow: rightEyeRig.brow,
      capePivot,
      capeMesh,
      capeBasePositions,
      leftLeg,
      rightLeg,
      leftArm,
      rightArm,
      rightHandTip,
      medallionGroup,
      medallionMesh,
      stridePhase: 0,
      prevX: root.position.x,
      prevZ: root.position.z,
    };
  }

  function attachHeroProps(hero: ArticulatedActor) {
    const hammerGroup = new THREE.Group();
    const handleGeo = new THREE.CylinderGeometry(0.018, 0.02, 0.58, 12);
    const hammerHeadGeo = new THREE.BoxGeometry(0.22, 0.12, 0.12);
    const hammerHandle = new THREE.Mesh(handleGeo, mats.darkBronzeMat);
    hammerHandle.rotation.x = Math.PI / 2;
    hammerHandle.position.z = 0.18;
    const hammerHead = new THREE.Mesh(hammerHeadGeo, mats.brassMat);
    hammerHead.position.z = 0.44;
    hammerHead.castShadow = true;
    hammerGroup.add(hammerHandle, hammerHead);
    hero.rightArm.propMount.add(hammerGroup);

    const torchGroup = new THREE.Group();
    const torchShaft = new THREE.Mesh(handleGeo, mats.darkBronzeMat);
    torchShaft.rotation.x = Math.PI / 2;
    torchShaft.position.z = 0.14;
    const torchBowlGeo = new THREE.CylinderGeometry(0.068, 0.035, 0.11, 14);
    const torchBowl = new THREE.Mesh(torchBowlGeo, mats.brassMat);
    torchBowl.rotation.x = Math.PI / 2;
    torchBowl.position.z = 0.42;
    const torchFlameGeo = new THREE.OctahedronGeometry(0.072, 1);
    const torchFlame = new THREE.Mesh(torchFlameGeo, mats.emberMat);
    torchFlame.position.z = 0.52;
    torchGroup.add(torchShaft, torchBowl, torchFlame);
    hero.rightArm.propMount.add(torchGroup);

    const staffGroup = new THREE.Group();
    const staffPoleGeo = new THREE.CylinderGeometry(0.02, 0.022, 1.85, 14);
    const staffPole = new THREE.Mesh(staffPoleGeo, mats.darkBronzeMat);
    staffPole.rotation.x = Math.PI / 2;
    staffPole.position.z = 0.25;
    const spearTipGeo = new THREE.OctahedronGeometry(0.078, 0);
    const spearTip = new THREE.Mesh(spearTipGeo, mats.emberMat);
    spearTip.scale.set(0.7, 0.7, 1.85);
    spearTip.position.z = 1.22;
    staffGroup.add(staffPole, spearTip);
    hero.rightArm.propMount.add(staffGroup);

    const scrollPropGroup = new THREE.Group();
    const handScrollGeo = new THREE.CylinderGeometry(0.032, 0.032, 0.28, 14);
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
    );

    return {
      hammerGroup,
      torchGroup,
      torchFlame,
      staffGroup,
      scrollPropGroup,
      parchmentMat,
    };
  }

  return { disposables, buildActor, attachHeroProps };
}
