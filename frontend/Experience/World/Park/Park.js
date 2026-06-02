import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import Experience from "../../Experience.js";
import { GrassGeometry } from "../Grass.js";
import { GrassMaterial } from "./GrassMaterial.js";

// ─── tuning constants ─────────────────────────────────────────────────────────

const GROUND_Y = 0.06; // park ground sits just above road planes / markings
const PATH_Y = GROUND_Y + 0.015; // path planes draw on top of the ground
const PATH_HALF = 2.2; // half-width of the cross path (4.4 units wide)
const PLAZA_R = 7.0; // radius of the central circular plaza

const BLADE_WIDTH = 0.035;
const BLADE_HEIGHT = 0.2;
const BLADE_JOINTS = 4;
const GRASS_BLADES = 450000; // single instanced draw call

// ─── shared materials ─────────────────────────────────────────────────────────

const PATH_MAT = new THREE.MeshStandardMaterial({ color: "#cdbb92", roughness: 1 });
const PLAZA_MAT = new THREE.MeshStandardMaterial({ color: "#d8c9a6", roughness: 1 });
const TRUNK_MAT = new THREE.MeshStandardMaterial({ color: "#6b4a2b", roughness: 1, flatShading: true });
const LEAF_MATS = [
  new THREE.MeshStandardMaterial({ color: "#3f7d2c", roughness: 1, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: "#4f9136", roughness: 1, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: "#356b25", roughness: 1, flatShading: true }),
];
const BENCH_WOOD = new THREE.MeshStandardMaterial({ color: "#8a5a32", roughness: 0.9 });
const BENCH_METAL = new THREE.MeshStandardMaterial({ color: "#3a3a3a", roughness: 0.7, metalness: 0.3 });

// reused canopy geometry (low-poly, stylised)
const CANOPY_GEO = new THREE.IcosahedronGeometry(1, 0);
const TRUNK_GEO = new THREE.CylinderGeometry(0.16, 0.26, 2.2, 7);

export default class Park {
  constructor({ rapierWorld, region } = {}) {
    this.experience = new Experience();
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;
    this.octree = this.experience.world.octree;
    this.time = this.experience.time;
    this.rapierWorld = rapierWorld || null;

    this.region = region; // { minX, maxX, minZ, maxZ }
    this.cx = (region.minX + region.maxX) / 2;
    this.cz = (region.minZ + region.maxZ) / 2;

    this.elapsedTime = 0;

    // invisible meshes registered with the player-collision Octree
    this._collidables = new THREE.Group();

    // bind so it can be passed straight to GrassGeometry
    this._pathMask = this._pathMask.bind(this);

    this._buildGround();
    this._buildPaths();
    this._buildGrass();
    this._buildTrees();
    this._buildBenches();

    this.scene.add(this._collidables);
    this._collidables.updateMatrixWorld(true);
    this.octree.fromGraphNode(this._collidables);
  }

  // true  → keep grass here   |   false → bare path / plaza
  _pathMask(x, z) {
    const onArmX = Math.abs(z - this.cz) < PATH_HALF; // strip running along X
    const onArmZ = Math.abs(x - this.cx) < PATH_HALF; // strip running along Z
    const dx = x - this.cx;
    const dz = z - this.cz;
    const inPlaza = dx * dx + dz * dz < (PLAZA_R + 0.4) * (PLAZA_R + 0.4);
    return !(onArmX || onArmZ || inPlaza);
  }

  // ── grass ground (textured) ────────────────────────────────────────────────

  _buildGround() {
    const w = this.region.maxX - this.region.minX;
    const d = this.region.maxZ - this.region.minZ;

    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.cx, GROUND_Y, this.cz);

    const tex = this.resources.items.parkGround;
    let mat;
    if (tex) {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set(w / 10, d / 10);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      tex.needsUpdate = true;
      mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 1 });
    } else {
      mat = new THREE.MeshStandardMaterial({ color: "#2f5d23", roughness: 1 });
    }

    this.groundMesh = new THREE.Mesh(geo, mat);
    this.groundMesh.receiveShadow = false;
    this.scene.add(this.groundMesh);
  }

  // ── cross path + central plaza ─────────────────────────────────────────────

  _buildPaths() {
    const w = this.region.maxX - this.region.minX;
    const d = this.region.maxZ - this.region.minZ;

    // arm running along X
    const armX = new THREE.PlaneGeometry(w, PATH_HALF * 2);
    armX.rotateX(-Math.PI / 2);
    armX.translate(this.cx, PATH_Y, this.cz);
    this.scene.add(new THREE.Mesh(armX, PATH_MAT));

    // arm running along Z
    const armZ = new THREE.PlaneGeometry(PATH_HALF * 2, d);
    armZ.rotateX(-Math.PI / 2);
    armZ.translate(this.cx, PATH_Y, this.cz);
    this.scene.add(new THREE.Mesh(armZ, PATH_MAT));

    // central plaza (drawn slightly higher so it sits over the arms)
    const plaza = new THREE.CircleGeometry(PLAZA_R, 40);
    plaza.rotateX(-Math.PI / 2);
    plaza.translate(this.cx, PATH_Y + 0.01, this.cz);
    this.scene.add(new THREE.Mesh(plaza, PLAZA_MAT));
  }

  // ── animated grass field (cloud-shadow shader) ─────────────────────────────

  _buildGrass() {
    this.grassMaterial = new GrassMaterial();

    const cloud = this.resources.items.cloudTexture;
    if (cloud) {
      cloud.wrapS = cloud.wrapT = THREE.RepeatWrapping;
      this.grassMaterial.uniforms.uCloud.value = cloud;
    }
    this.grassMaterial.uniforms.alphaMap.value = this.resources.items.grassBladeAlpha;
    this.grassMaterial.uniforms.uBladeHeight.value = BLADE_HEIGHT;

    const geometry = new GrassGeometry({
      bladeWidth: BLADE_WIDTH,
      bladeHeight: BLADE_HEIGHT,
      bladeJoints: BLADE_JOINTS,
      instances: GRASS_BLADES,
      getGroundHeight: () => GROUND_Y,
      mask: this._pathMask,
      // inset a touch so blades don't spill onto the bordering roads
      area: {
        minX: this.region.minX + 1.5,
        maxX: this.region.maxX - 1.5,
        minZ: this.region.minZ + 1.5,
        maxZ: this.region.maxZ - 1.5,
      },
    });

    this.grassMesh = new THREE.Mesh(geometry, this.grassMaterial);
    this.grassMesh.frustumCulled = true;
    this.scene.add(this.grassMesh);
  }

  // ── procedural trees ───────────────────────────────────────────────────────

  _makeTree(x, z) {
    const group = new THREE.Group();
    const scale = 0.85 + Math.random() * 0.5;

    const trunk = new THREE.Mesh(TRUNK_GEO, TRUNK_MAT);
    trunk.position.y = 1.1;
    group.add(trunk);

    // three stacked canopy lumps
    const lumps = [
      { r: 1.7, y: 2.6, j: 0.4 },
      { r: 1.35, y: 3.5, j: 0.4 },
      { r: 1.0, y: 4.2, j: 0.3 },
    ];
    for (const l of lumps) {
      const mat = LEAF_MATS[Math.floor(Math.random() * LEAF_MATS.length)];
      const leaf = new THREE.Mesh(CANOPY_GEO, mat);
      leaf.scale.setScalar(l.r);
      leaf.position.set(
        (Math.random() - 0.5) * l.j,
        l.y,
        (Math.random() - 0.5) * l.j,
      );
      leaf.rotation.y = Math.random() * Math.PI;
      group.add(leaf);
    }

    group.scale.setScalar(scale);
    group.position.set(x, GROUND_Y, z);
    group.rotation.y = Math.random() * Math.PI * 2;
    this.scene.add(group);

    // ── player collider (Octree) — slim box around the trunk ────────────
    const oct = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 2.4 * scale, 0.7),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    oct.position.set(x, GROUND_Y + 1.2 * scale, z);
    this._collidables.add(oct);

    // ── vehicle collider (Rapier) ───────────────────────────────────────
    if (this.rapierWorld) {
      const rb = this.rapierWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(x, GROUND_Y + 1.2 * scale, z),
      );
      this.rapierWorld.createCollider(
        RAPIER.ColliderDesc.cylinder(1.2 * scale, 0.3),
        rb,
      );
    }
  }

  _buildTrees() {
    const { minX, maxX, minZ, maxZ } = this.region;
    const placed = [];

    const tryPlace = (x, z) => {
      // keep trees off the path/plaza and inside the lawn margin
      if (this._pathMask(x, z) === false) return;
      if (
        x < minX + 3 || x > maxX - 3 ||
        z < minZ + 3 || z > maxZ - 3
      )
        return;
      // avoid clustering
      for (const p of placed) {
        if (Math.abs(p.x - x) < 4 && Math.abs(p.z - z) < 4) return;
      }
      placed.push({ x, z });
      this._makeTree(x, z);
    };

    // formal allée: tree rows lining both sides of each path arm
    const rowOff = PATH_HALF + 1.6;
    for (let x = minX + 6; x <= maxX - 6; x += 9) {
      tryPlace(x, this.cz - rowOff);
      tryPlace(x, this.cz + rowOff);
    }
    for (let z = minZ + 6; z <= maxZ - 6; z += 9) {
      tryPlace(this.cx - rowOff, z);
      tryPlace(this.cx + rowOff, z);
    }

    // scattered clusters in each quadrant
    const quadCenters = [
      [this.cx - 24, this.cz - 24],
      [this.cx + 24, this.cz - 24],
      [this.cx - 24, this.cz + 24],
      [this.cx + 24, this.cz + 24],
    ];
    for (const [qx, qz] of quadCenters) {
      for (let i = 0; i < 5; i++) {
        tryPlace(
          qx + (Math.random() - 0.5) * 26,
          qz + (Math.random() - 0.5) * 26,
        );
      }
    }
  }

  // ── benches lining the paths ───────────────────────────────────────────────

  _makeBench(x, z, faceAxis) {
    // faceAxis: "x" → bench length runs along X, seat faces ±Z
    const group = new THREE.Group();

    const lenX = faceAxis === "x" ? 1.7 : 0.5;
    const lenZ = faceAxis === "x" ? 0.5 : 1.7;

    const seat = new THREE.Mesh(
      new THREE.BoxGeometry(lenX, 0.1, lenZ),
      BENCH_WOOD,
    );
    seat.position.y = 0.5;
    group.add(seat);

    const back = new THREE.Mesh(
      new THREE.BoxGeometry(
        faceAxis === "x" ? lenX : 0.1,
        0.5,
        faceAxis === "x" ? 0.1 : lenZ,
      ),
      BENCH_WOOD,
    );
    // backrest sits on the side away from the path (the path is toward centre)
    back.position.y = 0.8;
    if (faceAxis === "x") {
      back.position.z = z < this.cz ? -0.2 : 0.2;
    } else {
      back.position.x = x < this.cx ? -0.2 : 0.2;
    }
    group.add(back);

    // legs
    const legGeo = new THREE.BoxGeometry(0.1, 0.5, 0.1);
    const legSpan = 0.65;
    const legCoords =
      faceAxis === "x"
        ? [[-legSpan, 0], [legSpan, 0]]
        : [[0, -legSpan], [0, legSpan]];
    for (const [lx, lz] of legCoords) {
      const leg = new THREE.Mesh(legGeo, BENCH_METAL);
      leg.position.set(lx, 0.25, lz);
      group.add(leg);
    }

    group.position.set(x, GROUND_Y, z);
    this.scene.add(group);

    // player collider
    const oct = new THREE.Mesh(
      new THREE.BoxGeometry(lenX + 0.1, 0.9, lenZ + 0.1),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    oct.position.set(x, GROUND_Y + 0.45, z);
    this._collidables.add(oct);
  }

  _buildBenches() {
    const { minX, maxX, minZ, maxZ } = this.region;
    const off = PATH_HALF + 0.9;

    // benches along the X arm (offset from the tree rows)
    for (let x = minX + 11; x <= maxX - 11; x += 18) {
      this._makeBench(x, this.cz - off, "x");
      this._makeBench(x, this.cz + off, "x");
    }
    // benches along the Z arm
    for (let z = minZ + 11; z <= maxZ - 11; z += 18) {
      this._makeBench(this.cx - off, z, "z");
      this._makeBench(this.cx + off, z, "z");
    }
  }

  // ── per-frame ──────────────────────────────────────────────────────────────

  update() {
    this.elapsedTime += this.time.delta;
    if (this.grassMaterial) {
      this.grassMaterial.uniforms.uTime.value = this.elapsedTime;
    }
  }
}
