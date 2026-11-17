import * as THREE from 'three';

export interface EnvironmentRig {
  amphitheaterGroup: THREE.Group;
  pillarSet: THREE.Group;
  summitSet: THREE.Group;
  archiveSet: THREE.Group;
  crossroadsSet: THREE.Group;
  stageTableCluster: THREE.Group;
  forgeCluster: THREE.Group;
  stepsCluster: THREE.Group;
  duelCluster: THREE.Group;
  sentinelRoot: THREE.Group;
  sentTorso: THREE.Group;
  sentArmPivot: THREE.Group;
  hotIngot: THREE.Mesh;
  sparkBurst: THREE.Mesh;
  emberPosAttr: THREE.BufferAttribute;
  emberSeed: Float32Array;
  emberCount: number;
  emberPointsMat: THREE.PointsMaterial;
  mistSprites: { sprite: THREE.Sprite; baseX: number; baseZ: number; phase: number; speed: number }[];
  animateProps: (t: number, dt: number, speechEnergy: number, isPlaying: boolean) => void;
  disposables: { dispose: () => void }[];
}

export function buildStageEnvironments(
  scene: THREE.Scene,
  mats: {
    floorTex: THREE.CanvasTexture;
    stoneBumpTex: THREE.CanvasTexture;
    emberSpriteTex: THREE.CanvasTexture;
    mistSpriteTex: THREE.CanvasTexture;
    asphaltTex: THREE.CanvasTexture;
    sidewalkTex: THREE.CanvasTexture;
    windowTex: THREE.CanvasTexture;
    brassMat: THREE.MeshStandardMaterial;
    darkBronzeMat: THREE.MeshStandardMaterial;
    stoneMat: THREE.MeshStandardMaterial;
    obsidianMat: THREE.MeshStandardMaterial;
    emberMat: THREE.MeshStandardMaterial;
    runeMat: THREE.MeshStandardMaterial;
    parchmentMat: THREE.MeshStandardMaterial;
    accentColor: number;
  },
): EnvironmentRig {
  const disposables: { dispose: () => void }[] = [];

  // Amphitheater Stone Floor & Stepped Dais (hidden when on Crossroads Cafe street set)
  const amphitheaterGroup = new THREE.Group();
  scene.add(amphitheaterGroup);

  const floorGeo = new THREE.CircleGeometry(18, 64);
  const floorMat = new THREE.MeshStandardMaterial({
    map: mats.floorTex,
    bumpMap: mats.stoneBumpTex,
    bumpScale: 0.015,
    roughness: 0.8,
    metalness: 0.14,
  });
  const floorMesh = new THREE.Mesh(floorGeo, floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  amphitheaterGroup.add(floorMesh);
  disposables.push(floorGeo, floorMat);

  const lowerStepGeo = new THREE.CylinderGeometry(2.38, 2.58, 0.08, 48);
  const lowerStep = new THREE.Mesh(lowerStepGeo, mats.stoneMat);
  lowerStep.position.y = 0.04;
  lowerStep.receiveShadow = true;
  amphitheaterGroup.add(lowerStep);

  const daisGeo = new THREE.CylinderGeometry(1.94, 2.12, 0.12, 48);
  const daisMesh = new THREE.Mesh(daisGeo, mats.obsidianMat);
  daisMesh.position.y = 0.1;
  daisMesh.receiveShadow = true;
  daisMesh.castShadow = true;
  amphitheaterGroup.add(daisMesh);

  const daisRingGeo = new THREE.TorusGeometry(1.95, 0.024, 16, 72);
  const daisRing = new THREE.Mesh(daisRingGeo, mats.brassMat);
  daisRing.rotation.x = Math.PI / 2;
  daisRing.position.y = 0.163;
  amphitheaterGroup.add(daisRing);

  const daisInnerRuneGeo = new THREE.TorusGeometry(1.38, 0.012, 12, 64);
  const daisInnerRune = new THREE.Mesh(daisInnerRuneGeo, mats.runeMat);
  daisInnerRune.rotation.x = Math.PI / 2;
  daisInnerRune.position.y = 0.164;
  amphitheaterGroup.add(daisInnerRune);
  disposables.push(lowerStepGeo, daisGeo, daisRingGeo, daisInnerRuneGeo);

  // Chamber Floor Sconces & Background Colonnade
  const sconceBaseGeo = new THREE.CylinderGeometry(0.08, 0.12, 0.24, 10);
  const sconceFlameGeo = new THREE.OctahedronGeometry(0.05, 0);
  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const radius = 3.75;
    const sx = Math.cos(ang) * radius;
    const sz = Math.sin(ang) * radius;
    if (sz > 1.8 && Math.abs(sx) < 1.8) continue;
    const sconce = new THREE.Mesh(sconceBaseGeo, mats.darkBronzeMat);
    sconce.position.set(sx, 0.12, sz);
    sconce.castShadow = true;
    const ember = new THREE.Mesh(sconceFlameGeo, mats.emberMat);
    ember.position.set(sx, 0.3, sz);
    amphitheaterGroup.add(sconce, ember);
  }
  disposables.push(sconceBaseGeo, sconceFlameGeo);

  const bgColGeo = new THREE.CylinderGeometry(0.24, 0.28, 5.2, 14);
  const bgCapGeo = new THREE.BoxGeometry(0.76, 0.24, 0.76);
  for (let i = -3; i <= 3; i++) {
    if (i === 0) continue;
    const angle = (i / 4) * Math.PI * 0.55 - Math.PI / 2;
    const r = 7.6;
    const bx = Math.cos(angle) * r;
    const bz = Math.sin(angle) * r;
    const pillar = new THREE.Mesh(bgColGeo, mats.stoneMat);
    pillar.position.set(bx, 2.6, bz);
    const cap = new THREE.Mesh(bgCapGeo, mats.stoneMat);
    cap.position.set(bx, 5.25, bz);
    amphitheaterGroup.add(pillar, cap);
  }
  disposables.push(bgColGeo, bgCapGeo);

  // Drifting Low Floor Mist Sprites
  const mistMat = new THREE.SpriteMaterial({
    map: mats.mistSpriteTex,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
  });
  disposables.push(mistMat);
  const mistSprites: EnvironmentRig['mistSprites'] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2;
    const rad = 2.6 + (i % 3) * 1.1;
    const sp = new THREE.Sprite(mistMat);
    const bx = Math.cos(ang) * rad;
    const bz = Math.sin(ang) * rad - 0.5;
    sp.position.set(bx, 0.48 + (i % 2) * 0.18, bz);
    sp.scale.set(2.8 + (i % 3) * 0.7, 1.05, 1);
    scene.add(sp);
    mistSprites.push({ sprite: sp, baseX: bx, baseZ: bz, phase: i * 0.85, speed: 0.25 + (i % 3) * 0.08 });
  }

  // Rising Golden Embers Particle Field
  const emberCount = 85;
  const posArr = new Float32Array(emberCount * 3);
  const emberSeed = new Float32Array(emberCount * 3);
  for (let i = 0; i < emberCount; i++) {
    const ang = (i * 2.39996) % (Math.PI * 2);
    const rad = 0.5 + ((i * 0.618) % 1) * 3.4;
    posArr[i * 3] = Math.cos(ang) * rad;
    posArr[i * 3 + 1] = 0.22 + ((i * 0.37) % 1) * 3.8;
    posArr[i * 3 + 2] = Math.sin(ang) * rad;
    emberSeed[i * 3] = 0.2 + ((i * 0.19) % 0.34);
    emberSeed[i * 3 + 1] = i * 0.73;
    emberSeed[i * 3 + 2] = 0.18 + ((i * 0.29) % 0.36);
  }
  const emberGeo = new THREE.BufferGeometry();
  const emberPosAttr = new THREE.BufferAttribute(posArr, 3);
  emberGeo.setAttribute('position', emberPosAttr);
  const emberPointsMat = new THREE.PointsMaterial({
    size: 0.085,
    map: mats.emberSpriteTex,
    color: mats.accentColor,
    transparent: true,
    opacity: 0.82,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(emberGeo, emberPointsMat));
  disposables.push(emberGeo, emberPointsMat);

  // Activity Props: 1) Forge Hearth + Anvil + Spark Ring
  const forgeCluster = new THREE.Group();
  const anvilBaseGeo = new THREE.BoxGeometry(0.54, 0.55, 0.48);
  const anvilHornGeo = new THREE.BoxGeometry(0.72, 0.18, 0.28);
  const ingotGeo = new THREE.BoxGeometry(0.28, 0.08, 0.14);
  const sparkBurstGeo = new THREE.TorusGeometry(0.26, 0.015, 8, 24);
  const anvilBase = new THREE.Mesh(anvilBaseGeo, mats.stoneMat);
  anvilBase.position.set(0.25, 0.435, 0.15);
  anvilBase.castShadow = true;
  const anvilTop = new THREE.Mesh(anvilHornGeo, mats.obsidianMat);
  anvilTop.position.set(0.25, 0.8, 0.15);
  anvilTop.castShadow = true;
  const hotIngot = new THREE.Mesh(ingotGeo, mats.emberMat);
  hotIngot.position.set(0.25, 0.92, 0.15);
  const sparkBurst = new THREE.Mesh(sparkBurstGeo, mats.emberMat);
  sparkBurst.rotation.x = Math.PI / 2;
  sparkBurst.position.set(0.25, 0.94, 0.15);
  forgeCluster.add(anvilBase, anvilTop, hotIngot, sparkBurst);
  scene.add(forgeCluster);
  disposables.push(anvilBaseGeo, anvilHornGeo, ingotGeo, sparkBurstGeo);

  // Activity Props: 2) Ascending Illuminated Stone Steps
  const stepsCluster = new THREE.Group();
  const stepBlockGeo = new THREE.BoxGeometry(1.1, 0.22, 0.55);
  const stepTrimGeo = new THREE.BoxGeometry(1.12, 0.03, 0.05);
  for (let s = 0; s < 4; s++) {
    const stMesh = new THREE.Mesh(stepBlockGeo, mats.stoneMat);
    stMesh.position.set(-0.65 + s * 0.46, 0.27 + s * 0.22, 0.15 - s * 0.18);
    stMesh.castShadow = true;
    stMesh.receiveShadow = true;
    const stTrim = new THREE.Mesh(stepTrimGeo, mats.runeMat);
    stTrim.position.set(-0.65 + s * 0.46, 0.385 + s * 0.22, 0.42 - s * 0.18);
    stepsCluster.add(stMesh, stTrim);
  }
  scene.add(stepsCluster);
  disposables.push(stepBlockGeo, stepTrimGeo);

  // Activity Props: 3) Towering Shadow Sentinel Adversary
  const duelCluster = new THREE.Group();
  const sentinelRoot = new THREE.Group();
  sentinelRoot.position.set(0.95, 0.16, -0.05);
  sentinelRoot.rotation.y = -Math.PI * 0.42;

  const shadowTitanMat = new THREE.MeshStandardMaterial({ color: 0x090b12, roughness: 0.72, metalness: 0.35 });
  const crimsonGlowMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 1.8,
    roughness: 0.2,
  });
  const sentBodyGeo = new THREE.ConeGeometry(0.42, 1.45, 9);
  const sentChestGeo = new THREE.SphereGeometry(0.36, 16, 14);
  const sentHeadGeo = new THREE.OctahedronGeometry(0.2, 1);
  const sentHornGeo = new THREE.ConeGeometry(0.055, 0.34, 8);
  const sentEyeGeo = new THREE.BoxGeometry(0.075, 0.025, 0.04);
  const sentBladeGeo = new THREE.ConeGeometry(0.06, 0.96, 4);

  const sentBody = new THREE.Mesh(sentBodyGeo, shadowTitanMat);
  sentBody.position.y = 0.72;
  sentBody.castShadow = true;
  const sentTorso = new THREE.Group();
  sentTorso.position.y = 1.25;
  const sentChest = new THREE.Mesh(sentChestGeo, shadowTitanMat);
  sentChest.position.y = 0.24;
  sentChest.scale.set(1.1, 0.9, 0.75);
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
  eyeL.position.set(-0.068, 0.74, 0.16);
  const eyeR = new THREE.Mesh(sentEyeGeo, crimsonGlowMat);
  eyeR.position.set(0.068, 0.74, 0.16);

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
    shadowTitanMat, crimsonGlowMat, sentBodyGeo, sentChestGeo,
    sentHeadGeo, sentHornGeo, sentEyeGeo, sentBladeGeo,
  );

  // Set 1: Philosopher Pillar & Spinning Astrolabe Lantern
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
    colPlinthGeo, colShaftGeo, colCapitalGeo, lintelGeo,
    brazierPedestalGeo, brazierBowlGeo, astrolabeRing1Geo, astrolabeRing2Geo, flameCoreGeo,
  );

  [-1.75, 1.75].forEach((px) => {
    const plinth = new THREE.Mesh(colPlinthGeo, mats.stoneMat);
    plinth.position.set(px, 0.11, -1.65);
    plinth.castShadow = true;
    plinth.receiveShadow = true;
    const shaft = new THREE.Mesh(colShaftGeo, mats.stoneMat);
    shaft.position.set(px, 1.45, -1.65);
    shaft.castShadow = true;
    const cap = new THREE.Mesh(colCapitalGeo, mats.stoneMat);
    cap.position.set(px, 2.79, -1.65);
    const trimBand = new THREE.Mesh(colCapitalGeo, mats.brassMat);
    trimBand.scale.set(0.92, 0.25, 0.92);
    trimBand.position.set(px, 2.68, -1.65);
    pillarSet.add(plinth, shaft, cap, trimBand);
  });
  const archLintel = new THREE.Mesh(lintelGeo, mats.obsidianMat);
  archLintel.position.set(0, 3.04, -1.65);
  const archTrim = new THREE.Mesh(lintelGeo, mats.brassMat);
  archTrim.scale.set(1.01, 0.14, 1.03);
  archTrim.position.set(0, 2.89, -1.65);
  const brazierPedestal = new THREE.Mesh(brazierPedestalGeo, mats.stoneMat);
  brazierPedestal.position.set(-1.55, 0.54, -0.55);
  const brazierBowl = new THREE.Mesh(brazierBowlGeo, mats.darkBronzeMat);
  brazierBowl.position.set(-1.55, 1.18, -0.55);
  const astrolabeRing1 = new THREE.Mesh(astrolabeRing1Geo, mats.brassMat);
  astrolabeRing1.position.set(-1.55, 1.62, -0.55);
  const astrolabeRing2 = new THREE.Mesh(astrolabeRing2Geo, mats.brassMat);
  astrolabeRing2.position.set(-1.55, 1.62, -0.55);
  const lanternCore = new THREE.Mesh(flameCoreGeo, mats.emberMat);
  lanternCore.position.set(-1.55, 1.62, -0.55);
  pillarSet.add(
    archLintel, archTrim, brazierPedestal, brazierBowl, astrolabeRing1, astrolabeRing2, lanternCore,
  );
  scene.add(pillarSet);

  // Set 2: Summit Overlook
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
    rockGeo, spireGeo, rockMat, eclipseHaloGeo, eclipseDiscGeo,
    eclipseHaloMat, eclipseDiscMat, beaconGeo, poleGeo, bannerGeo, bannerMat,
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
  [[-2.4, -4.4, 1.3], [0.4, -5.2, 1.6], [2.5, -4.2, 1.2]].forEach(([sx, sz, scaleY]) => {
    const spire = new THREE.Mesh(spireGeo, rockMat);
    spire.position.set(sx, 1.3 * scaleY, sz);
    spire.scale.set(1.2, scaleY, 1.0);
    summitSet.add(spire);
  });
  const eclipseDisc = new THREE.Mesh(eclipseDiscGeo, eclipseDiscMat);
  eclipseDisc.position.set(0, 2.55, -4.6);
  const eclipseHalo = new THREE.Mesh(eclipseHaloGeo, eclipseHaloMat);
  eclipseHalo.position.set(0, 2.55, -4.58);
  const beaconMesh = new THREE.Mesh(beaconGeo, mats.stoneMat);
  beaconMesh.position.set(-1.6, 0.92, -0.55);
  const beaconOrb = new THREE.Mesh(flameCoreGeo, mats.emberMat);
  beaconOrb.position.set(-1.6, 2.02, -0.55);
  const bannerPole = new THREE.Mesh(poleGeo, mats.brassMat);
  bannerPole.position.set(1.65, 1.3, -0.85);
  const bannerCross = new THREE.Mesh(poleGeo, mats.brassMat);
  bannerCross.scale.set(0.7, 0.25, 0.7);
  bannerCross.rotation.z = Math.PI / 2;
  bannerCross.position.set(1.92, 2.45, -0.85);
  const bannerMesh = new THREE.Mesh(bannerGeo, bannerMat);
  bannerMesh.position.set(1.92, 1.88, -0.85);
  summitSet.add(eclipseDisc, eclipseHalo, beaconMesh, beaconOrb, bannerPole, bannerCross, bannerMesh);
  scene.add(summitSet);

  // Set 3: Ancient Archive
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
    woodMat, bookGeo, bookMat, lecternBaseGeo, lecternSlopeGeo,
    tomePageGeo, shelfFrameGeo, scrollGeo, scrollCapGeo, candleStemGeo,
  );

  const lecternBase = new THREE.Mesh(lecternBaseGeo, woodMat);
  lecternBase.position.set(-1.12, 0.525, 0.35);
  lecternBase.rotation.y = 0.55;
  const lecternTop = new THREE.Mesh(lecternSlopeGeo, woodMat);
  lecternTop.position.set(-1.12, 1.07, 0.35);
  lecternTop.rotation.y = 0.55;
  lecternTop.rotation.x = 0.32;
  const openTome = new THREE.Mesh(tomePageGeo, mats.parchmentMat);
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
    const body = new THREE.Mesh(scrollGeo, mats.parchmentMat);
    body.rotation.z = Math.PI / 2;
    const capL = new THREE.Mesh(scrollCapGeo, mats.brassMat);
    capL.rotation.z = Math.PI / 2;
    capL.position.x = -0.2;
    const capR = new THREE.Mesh(scrollCapGeo, mats.brassMat);
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

  const candleStand = new THREE.Mesh(candleStemGeo, mats.brassMat);
  candleStand.position.set(1.42, 0.28, 0.3);
  const candleFlame = new THREE.Mesh(flameCoreGeo, mats.emberMat);
  candleFlame.scale.set(0.65, 1.1, 0.65);
  candleFlame.position.set(1.42, 0.64, 0.3);
  archiveSet.add(candleStand, candleFlame);
  scene.add(archiveSet);

  // Set 4: Detailed Crossroads Street & Sidewalk Bistro Cafe
  const crossroadsSet = new THREE.Group();
  const roadMat = new THREE.MeshStandardMaterial({
    map: mats.asphaltTex,
    bumpMap: mats.stoneBumpTex,
    bumpScale: 0.008,
    roughness: 0.86,
    metalness: 0.08,
  });
  const sidewalkMat = new THREE.MeshStandardMaterial({
    map: mats.sidewalkTex,
    bumpMap: mats.stoneBumpTex,
    bumpScale: 0.01,
    roughness: 0.8,
    metalness: 0.08,
  });
  const roadLineMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.65 });
  const ironStreetMat = new THREE.MeshStandardMaterial({ color: 0x18202c, roughness: 0.35, metalness: 0.84 });
  const ceramicMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.22, metalness: 0.06 });
  const storefrontWinMat = new THREE.MeshStandardMaterial({
    map: mats.windowTex,
    emissive: 0xf59e0b,
    emissiveMap: mats.windowTex,
    emissiveIntensity: 0.82,
    roughness: 0.35,
  });
  const awningMat = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.72, side: THREE.DoubleSide });
  const planterMat = new THREE.MeshStandardMaterial({ color: 0x6b3a24, roughness: 0.85 });
  const foliageMat = new THREE.MeshStandardMaterial({ color: 0x1f4b32, roughness: 0.88 });
  const facadeMat = new THREE.MeshStandardMaterial({ color: 0x171d2b, roughness: 0.84, metalness: 0.1 });

  const roadPlaneGeo = new THREE.PlaneGeometry(34, 34);
  const roadMesh = new THREE.Mesh(roadPlaneGeo, roadMat);
  roadMesh.rotation.x = -Math.PI / 2;
  roadMesh.receiveShadow = true;
  crossroadsSet.add(roadMesh);

  const dashXGeo = new THREE.PlaneGeometry(0.95, 0.1);
  const dashZGeo = new THREE.PlaneGeometry(0.1, 0.95);
  for (let i = -12; i <= 12; i += 2) {
    if (Math.abs(i) < 2) continue;
    const dx = new THREE.Mesh(dashXGeo, roadLineMat);
    dx.rotation.x = -Math.PI / 2;
    dx.position.set(i, 0.004, 0);
    const dz = new THREE.Mesh(dashZGeo, roadLineMat);
    dz.rotation.x = -Math.PI / 2;
    dz.position.set(0, 0.004, i);
    crossroadsSet.add(dx, dz);
  }
  const zebraGeo = new THREE.PlaneGeometry(0.24, 0.68);
  for (let c = -1.15; c <= 1.16; c += 0.56) {
    [-1.92, 1.92].forEach((pos) => {
      const zx = new THREE.Mesh(zebraGeo, roadLineMat);
      zx.rotation.x = -Math.PI / 2;
      zx.position.set(c, 0.004, pos);
      const zz = new THREE.Mesh(zebraGeo, roadLineMat);
      zz.rotation.x = -Math.PI / 2;
      zz.rotation.z = Math.PI / 2;
      zz.position.set(pos, 0.004, c);
      crossroadsSet.add(zx, zz);
    });
  }

  // 4 Raised Sidewalk Corners (top surface exact y = 0.12)
  const swQuadGeo = new THREE.BoxGeometry(11, 0.12, 11);
  [
    [-1.6 - 5.5, -1.6 - 5.5],
    [1.6 + 5.5, -1.6 - 5.5],
    [-1.6 - 5.5, 1.6 + 5.5],
    [1.6 + 5.5, 1.6 + 5.5],
  ].forEach(([qx, qz]) => {
    const sw = new THREE.Mesh(swQuadGeo, sidewalkMat);
    sw.position.set(qx, 0.06, qz);
    sw.receiveShadow = true;
    crossroadsSet.add(sw);
  });

  // Roadside Bistro Table & Two Chairs on NE Sidewalk (Seat top at 0.12 + 0.39 = 0.51m)
  const TABLE_X = 3.6;
  const TABLE_Z = -2.55;
  const SW_Y = 0.12;
  const SEAT_H = 0.39;

  const bistroGroup = new THREE.Group();
  bistroGroup.position.set(TABLE_X, SW_Y, TABLE_Z);
  const bBaseGeo = new THREE.CylinderGeometry(0.18, 0.28, 0.06, 20);
  const bStemGeo = new THREE.CylinderGeometry(0.042, 0.055, 0.70, 16);
  const bTopGeo = new THREE.CylinderGeometry(0.46, 0.46, 0.045, 32);
  const bRimGeo = new THREE.TorusGeometry(0.46, 0.012, 10, 48);
  const cupGeo = new THREE.CylinderGeometry(0.036, 0.028, 0.075, 12);
  const saucerGeo = new THREE.CylinderGeometry(0.062, 0.048, 0.014, 14);

  const bBase = new THREE.Mesh(bBaseGeo, ironStreetMat);
  bBase.position.y = 0.03;
  const bStem = new THREE.Mesh(bStemGeo, ironStreetMat);
  bStem.position.y = 0.36;
  bStem.castShadow = true;
  const bTop = new THREE.Mesh(bTopGeo, woodMat);
  bTop.position.y = 0.725;
  bTop.castShadow = true;
  bTop.receiveShadow = true;
  const bRim = new THREE.Mesh(bRimGeo, mats.brassMat);
  bRim.rotation.x = Math.PI / 2;
  bRim.position.y = 0.725;
  const cup1 = new THREE.Mesh(cupGeo, ceramicMat);
  cup1.position.set(-0.22, 0.79, 0.12);
  const saucer1 = new THREE.Mesh(saucerGeo, ceramicMat);
  saucer1.position.set(-0.22, 0.753, 0.12);
  const cup2 = new THREE.Mesh(cupGeo, ceramicMat);
  cup2.position.set(0.22, 0.79, -0.10);
  const saucer2 = new THREE.Mesh(saucerGeo, ceramicMat);
  saucer2.position.set(0.22, 0.753, -0.10);
  bistroGroup.add(bBase, bStem, bTop, bRim, cup1, saucer1, cup2, saucer2);
  crossroadsSet.add(bistroGroup);

  const cLegGeo = new THREE.CylinderGeometry(0.018, 0.015, SEAT_H - 0.03, 10);
  const cSeatGeo = new THREE.BoxGeometry(0.4, 0.04, 0.4);
  const cPostGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.46, 8);
  const cBackGeo = new THREE.BoxGeometry(0.4, 0.16, 0.034);
  [
    { x: 2.96, yaw: Math.PI / 2 },
    { x: 4.24, yaw: -Math.PI / 2 },
  ].forEach(({ x, yaw }) => {
    const cg = new THREE.Group();
    cg.position.set(x, SW_Y, TABLE_Z);
    cg.rotation.y = yaw;
    [
      [-0.17, -0.17],
      [0.17, -0.17],
      [-0.17, 0.17],
      [0.17, 0.17],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(cLegGeo, ironStreetMat);
      leg.position.set(lx, (SEAT_H - 0.03) / 2, lz);
      leg.castShadow = true;
      cg.add(leg);
    });
    const seat = new THREE.Mesh(cSeatGeo, woodMat);
    seat.position.set(0, SEAT_H - 0.02, 0); // cushion top exactly at local y = SEAT_H (0.39)
    seat.castShadow = true;
    seat.receiveShadow = true;
    const pL = new THREE.Mesh(cPostGeo, ironStreetMat);
    pL.position.set(-0.17, SEAT_H + 0.22, -0.18);
    const pR = new THREE.Mesh(cPostGeo, ironStreetMat);
    pR.position.set(0.17, SEAT_H + 0.22, -0.18);
    const back = new THREE.Mesh(cBackGeo, woodMat);
    back.position.set(0, SEAT_H + 0.36, -0.18);
    back.castShadow = true;
    cg.add(seat, pL, pR, back);
    crossroadsSet.add(cg);
  });

  // Wrought-Iron Streetlamps + Corner Storefront Cafe + Planters + Park Bench
  const streetPoleGeo = new THREE.CylinderGeometry(0.042, 0.068, 3.1, 14);
  const globeGeo = new THREE.SphereGeometry(0.15, 16, 14);
  [
    [3.6, -3.55],
    [-2.5, -2.5],
  ].forEach(([lx, lz]) => {
    const pole = new THREE.Mesh(streetPoleGeo, ironStreetMat);
    pole.position.set(lx, SW_Y + 1.55, lz);
    pole.castShadow = true;
    const globe = new THREE.Mesh(globeGeo, mats.emberMat);
    globe.position.set(lx, SW_Y + 3.15, lz);
    crossroadsSet.add(pole, globe);
  });

  const buildingGeo = new THREE.BoxGeometry(5.6, 4.4, 2.2);
  const winPaneGeo = new THREE.PlaneGeometry(1.45, 1.55);
  const awningGeo = new THREE.BoxGeometry(4.8, 0.08, 1.05);
  const storefront = new THREE.Mesh(buildingGeo, facadeMat);
  storefront.position.set(4.6, SW_Y + 2.2, -5.3);
  storefront.receiveShadow = true;
  crossroadsSet.add(storefront);
  [3.4, 5.4].forEach((wx) => {
    const wPane = new THREE.Mesh(winPaneGeo, storefrontWinMat);
    wPane.position.set(wx, SW_Y + 1.55, -4.18);
    crossroadsSet.add(wPane);
  });
  const awning = new THREE.Mesh(awningGeo, awningMat);
  awning.position.set(4.4, SW_Y + 2.48, -3.85);
  awning.rotation.x = 0.25;
  awning.castShadow = true;
  crossroadsSet.add(awning);

  const planterBoxGeo = new THREE.BoxGeometry(0.46, 0.42, 0.46);
  const shrubGeo = new THREE.DodecahedronGeometry(0.32, 1);
  [
    [2.1, -3.9],
    [5.1, -3.9],
  ].forEach(([px, pz]) => {
    const box = new THREE.Mesh(planterBoxGeo, planterMat);
    box.position.set(px, SW_Y + 0.21, pz);
    box.castShadow = true;
    const shrub = new THREE.Mesh(shrubGeo, foliageMat);
    shrub.position.set(px, SW_Y + 0.56, pz);
    shrub.castShadow = true;
    crossroadsSet.add(box, shrub);
  });

  scene.add(crossroadsSet);

  // Reusable Dialogue Table & Chairs Cluster for non-street sets (center 0, 0.16, -0.35)
  const stageTableCluster = new THREE.Group();
  stageTableCluster.visible = false;
  const daisTableGroup = new THREE.Group();
  daisTableGroup.position.set(0, 0.16, -0.35);
  const dBase = new THREE.Mesh(bBaseGeo, ironStreetMat);
  dBase.position.y = 0.03;
  const dStem = new THREE.Mesh(bStemGeo, ironStreetMat);
  dStem.position.y = 0.36;
  dStem.castShadow = true;
  const dTop = new THREE.Mesh(bTopGeo, woodMat);
  dTop.position.y = 0.725;
  dTop.castShadow = true;
  dTop.receiveShadow = true;
  const dRim = new THREE.Mesh(bRimGeo, mats.brassMat);
  dRim.rotation.x = Math.PI / 2;
  dRim.position.y = 0.725;
  daisTableGroup.add(dBase, dStem, dTop, dRim);
  stageTableCluster.add(daisTableGroup);

  [
    { x: -0.64, yaw: Math.PI / 2 },
    { x: 0.64, yaw: -Math.PI / 2 },
  ].forEach(({ x, yaw }) => {
    const cg = new THREE.Group();
    cg.position.set(x, 0.16, -0.35);
    cg.rotation.y = yaw;
    [
      [-0.17, -0.17],
      [0.17, -0.17],
      [-0.17, 0.17],
      [0.17, 0.17],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(cLegGeo, ironStreetMat);
      leg.position.set(lx, (SEAT_H - 0.03) / 2, lz);
      leg.castShadow = true;
      cg.add(leg);
    });
    const seat = new THREE.Mesh(cSeatGeo, woodMat);
    seat.position.set(0, SEAT_H - 0.02, 0);
    seat.castShadow = true;
    seat.receiveShadow = true;
    const pL = new THREE.Mesh(cPostGeo, ironStreetMat);
    pL.position.set(-0.17, SEAT_H + 0.22, -0.18);
    const pR = new THREE.Mesh(cPostGeo, ironStreetMat);
    pR.position.set(0.17, SEAT_H + 0.22, -0.18);
    const back = new THREE.Mesh(cBackGeo, woodMat);
    back.position.set(0, SEAT_H + 0.36, -0.18);
    back.castShadow = true;
    cg.add(seat, pL, pR, back);
    stageTableCluster.add(cg);
  });
  scene.add(stageTableCluster);

  disposables.push(
    roadMat, sidewalkMat, roadLineMat, ironStreetMat, ceramicMat, storefrontWinMat,
    awningMat, planterMat, foliageMat, facadeMat, roadPlaneGeo, dashXGeo, dashZGeo,
    zebraGeo, swQuadGeo, bBaseGeo, bStemGeo, bTopGeo, bRimGeo, cupGeo, saucerGeo,
    cLegGeo, cSeatGeo, cPostGeo, cBackGeo, streetPoleGeo, globeGeo, buildingGeo,
    winPaneGeo, awningGeo, planterBoxGeo, shrubGeo,
  );

  const animateProps = (t: number, dt: number, speechEnergy: number, isPlaying: boolean) => {
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

    // Gentle floor mist drift
    for (const m of mistSprites) {
      m.sprite.position.x = m.baseX + Math.sin(t * m.speed + m.phase) * 0.45;
      m.sprite.position.z = m.baseZ + Math.cos(t * m.speed * 0.8 + m.phase) * 0.35;
    }

    // Rising embers / street dust motes
    for (let i = 0; i < emberCount; i++) {
      const idx = i * 3;
      const speed = emberSeed[idx];
      const phase = emberSeed[idx + 1];
      const drift = emberSeed[idx + 2];
      let py = posArr[idx + 1] + speed * dt * (isPlaying ? 1.5 + speechEnergy * 0.4 : 1.0);
      if (py > 4.1) py = 0.22;
      posArr[idx + 1] = py;
      posArr[idx] += Math.sin(t * 0.9 + phase) * drift * dt * 0.35;
      posArr[idx + 2] += Math.cos(t * 0.85 + phase) * drift * dt * 0.35;
    }
    emberPosAttr.needsUpdate = true;
  };

  return {
    amphitheaterGroup,
    pillarSet,
    summitSet,
    archiveSet,
    crossroadsSet,
    stageTableCluster,
    forgeCluster,
    stepsCluster,
    duelCluster,
    sentinelRoot,
    sentTorso,
    sentArmPivot,
    hotIngot,
    sparkBurst,
    emberPosAttr,
    emberSeed,
    emberCount,
    emberPointsMat,
    mistSprites,
    animateProps,
    disposables,
  };
}
