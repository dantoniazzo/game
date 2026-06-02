import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import RAPIER from "@dimforge/rapier3d-compat";
import Experience from "../Experience.js";

// ─── grid constants ───────────────────────────────────────────────────────────

const ROAD_HALF = 7; // half road width  (total 14 units per road)
const SW_WIDTH = 2.5; // sidewalk strip width
const CURB_H = 0.12; // kerb height
const BUILD_START = ROAD_HALF + SW_WIDTH; // 9.5 — inner edge of sidewalk

// 5 road centre-lines in each axis → 4 × 4 = 16 city blocks
const ROAD_GRID = [-120, -60, 0, 60, 120];
const BLOCK_SPACE = 60; // centre-to-centre road spacing
const WORLD_EXT = 160; // planes extend ±this from origin
const INNER = BLOCK_SPACE - 2 * BUILD_START; // ~41 — usable width per block
const Y_MARK = 0.012; // road-marking height above ground

// ─── colour palette ───────────────────────────────────────────────────────────

const C = {
  asphalt: 0x1c1c1e,
  sidewalk: 0x8a8478,
  lineWhite: 0xddddd0,
  lineYellow: 0xf0c040,
  facades: [
    0x8a9ba8, 0xb8a898, 0x7e8c80, 0xa09080, 0xaaaaaa, 0x6e7d8c, 0xc4b49a,
    0x9a8878,
  ],
  window: 0x1a3a5c,
  winGlow: 0x3a6080,
  lampPost: 0x333333,
  lampHead: 0xfff5cc,
};

// ─── building block templates  (building positions within INNER × INNER area) ─

const TEMPLATES = [
  [
    // A — two towers + medium fills
    { ox: 2, oz: 2, w: 18, d: 16, h: 20 },
    { ox: 22, oz: 2, w: 16, d: 14, h: 14 },
    { ox: 2, oz: 20, w: 14, d: 18, h: 16 },
    { ox: 18, oz: 18, w: 20, d: 20, h: 10 },
    { ox: 32, oz: 4, w: 7, d: 22, h: 26 },
  ],
  [
    // B — single tall centrepiece
    { ox: 2, oz: 2, w: 22, d: 20, h: 30 },
    { ox: 26, oz: 2, w: 12, d: 10, h: 10 },
    { ox: 2, oz: 24, w: 16, d: 14, h: 14 },
    { ox: 20, oz: 24, w: 18, d: 14, h: 18 },
    { ox: 26, oz: 14, w: 12, d: 8, h: 12 },
  ],
  [
    // C — six smaller commercial buildings
    { ox: 2, oz: 2, w: 12, d: 12, h: 14 },
    { ox: 16, oz: 2, w: 12, d: 12, h: 10 },
    { ox: 30, oz: 2, w: 8, d: 12, h: 18 },
    { ox: 2, oz: 16, w: 16, d: 22, h: 12 },
    { ox: 20, oz: 16, w: 18, d: 10, h: 16 },
    { ox: 20, oz: 28, w: 18, d: 10, h: 8 },
  ],
  [
    // D — large office slab + annex buildings
    { ox: 2, oz: 2, w: 26, d: 24, h: 24 },
    { ox: 30, oz: 2, w: 9, d: 10, h: 12 },
    { ox: 30, oz: 14, w: 9, d: 10, h: 16 },
    { ox: 2, oz: 28, w: 26, d: 10, h: 8 },
    { ox: 30, oz: 26, w: 9, d: 12, h: 10 },
  ],
];

// ─── shared materials (one instance each, reused everywhere) ──────────────────

const M = {
  asphalt: new THREE.MeshLambertMaterial({ color: C.asphalt }),
  sidewalk: new THREE.MeshLambertMaterial({ color: C.sidewalk }),
  roof: new THREE.MeshLambertMaterial({ color: 0x333333 }),
  post: new THREE.MeshLambertMaterial({ color: C.lampPost }),
  head: new THREE.MeshLambertMaterial({
    color: C.lampHead,
    emissive: C.lampHead,
    emissiveIntensity: 0.9,
  }),
  lineWhite: (() => {
    const m = new THREE.MeshLambertMaterial({ color: C.lineWhite });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  })(),
  lineYellow: (() => {
    const m = new THREE.MeshLambertMaterial({ color: C.lineYellow });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  })(),
  window: (() => {
    const m = new THREE.MeshLambertMaterial({
      color: C.window,
      emissive: C.winGlow,
      emissiveIntensity: 0.25,
    });
    m.polygonOffset = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits = -2;
    return m;
  })(),
};

// Facade materials cached by colour so the same colour shares one GL state
const _facadeCache = new Map();
function facadeMat(color) {
  if (!_facadeCache.has(color))
    _facadeCache.set(color, new THREE.MeshLambertMaterial({ color }));
  return _facadeCache.get(color);
}

// ─── geometry helpers ─────────────────────────────────────────────────────────

/** Flat XZ plane pre-translated to (x, y, z) — ready for merging. */
function markPlane(w, d, x, z, y = Y_MARK) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  geo.translate(x, y, z);
  return geo;
}

/** All windows for one building face as a single BufferGeometry. */
function buildWindowGeo(faceW, faceH, cols, rows) {
  const colGap = faceW / (cols + 1);
  const rowGap = faceH / (rows + 1);
  const ww = Math.min(colGap * 0.55, 1.4);
  const wh = Math.min(rowGap * 0.6, 1.6);
  const positions = [],
    normals = [],
    indices = [];
  let vi = 0;
  for (let r = 0; r < rows; r++) {
    const y = rowGap * (r + 1);
    for (let c = 0; c < cols; c++) {
      const x = colGap * (c + 1) - faceW / 2;
      positions.push(
        x - ww / 2,
        y - wh / 2,
        0,
        x + ww / 2,
        y - wh / 2,
        0,
        x + ww / 2,
        y + wh / 2,
        0,
        x - ww / 2,
        y + wh / 2,
        0,
      );
      normals.push(0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1);
      indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      vi += 4;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setIndex(indices);
  return geo;
}

// ─── CityBlock ────────────────────────────────────────────────────────────────

export default class CityBlock {
  constructor({ rapierWorld, parkRegions } = {}) {
    this.experience = new Experience();
    this.scene = this.experience.scene;
    this.octree = this.experience.world.octree;
    this.rapierWorld = rapierWorld || null;

    // Rectangles (world XZ) reserved for parks — street furniture and
    // buildings that fall inside are skipped so the Park system can fill them.
    this.parkRegions = parkRegions || [];

    // Invisible meshes registered with the Three.js Octree (player collision)
    this._collidables = new THREE.Group();
    this._colorIdx = 0;

    // Geometry accumulation batches — flushed into merged meshes at the end
    this._whiteGeos = [];
    this._yellowGeos = [];
    this._windowGeos = [];
    this._roofGeos = [];
    this._buildingGeosByColor = new Map(); // color → BufferGeometry[]

    this._build();
    this._flush();

    this.scene.add(this._collidables);
    this._collidables.updateMatrixWorld(true);
    this.octree.fromGraphNode(this._collidables);
  }

  // ── park reservation test ─────────────────────────────────────────────────

  _inPark(x, z) {
    for (const r of this.parkRegions) {
      if (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ) return true;
    }
    return false;
  }

  // ── flush all batched geometry into single merged draw calls ──────────────

  _flush() {
    const add = (geos, mat) => {
      if (!geos.length) return;
      this.scene.add(new THREE.Mesh(mergeGeometries(geos), mat));
      geos.forEach((g) => g.dispose());
    };

    add(this._whiteGeos, M.lineWhite);
    add(this._yellowGeos, M.lineYellow);
    add(this._windowGeos, M.window);
    add(this._roofGeos, M.roof);

    for (const [color, geos] of this._buildingGeosByColor) {
      add(geos, facadeMat(color));
    }

    this._whiteGeos =
      this._yellowGeos =
      this._windowGeos =
      this._roofGeos =
        null;
    this._buildingGeosByColor = null;
  }

  _build() {
    this._makeGround();
    this._makeRoads();
    this._makeSidewalks();
    this._makeRoadMarkings();
    this._makeBuildings();
    this._makeLamps();
  }

  // ── ground ────────────────────────────────────────────────────────────────

  _makeGround() {
    const L = WORLD_EXT * 2;
    const geo = new THREE.PlaneGeometry(L, L);
    geo.rotateX(-Math.PI / 2);
    this.scene.add(new THREE.Mesh(geo, M.asphalt));
  }

  // ── roads (all 10 road planes merged into 1 draw call) ────────────────────

  _makeRoads() {
    const L = WORLD_EXT * 2;
    const W = ROAD_HALF * 2;
    const geos = [];

    for (const r of ROAD_GRID) {
      const ns = new THREE.PlaneGeometry(W, L);
      ns.rotateX(-Math.PI / 2);
      ns.translate(r, 0.01, 0);
      geos.push(ns);

      const ew = new THREE.PlaneGeometry(L, W);
      ew.rotateX(-Math.PI / 2);
      ew.translate(0, 0.01, r);
      geos.push(ew);
    }

    this.scene.add(new THREE.Mesh(mergeGeometries(geos), M.asphalt));
    geos.forEach((g) => g.dispose());
  }

  // ── sidewalks (segments between intersections, all merged into 1 mesh) ────

  _makeSidewalks() {
    const y = CURB_H / 2;
    const geos = [];

    const seg = (w, d, x, z) => {
      if (this._inPark(x, z)) return; // park edges meet the road directly
      const g = new THREE.BoxGeometry(w, CURB_H, d);
      g.translate(x, y, z);
      geos.push(g);
    };

    for (const rx of ROAD_GRID) {
      for (const side of [-1, 1]) {
        const cx = rx + side * (ROAD_HALF + SW_WIDTH / 2);
        for (let i = 0; i < ROAD_GRID.length - 1; i++) {
          const z0 = ROAD_GRID[i] + ROAD_HALF;
          const z1 = ROAD_GRID[i + 1] - ROAD_HALF;
          seg(SW_WIDTH, z1 - z0, cx, (z0 + z1) / 2);
        }
      }
    }

    for (const rz of ROAD_GRID) {
      for (const side of [-1, 1]) {
        const cz = rz + side * (ROAD_HALF + SW_WIDTH / 2);
        for (let i = 0; i < ROAD_GRID.length - 1; i++) {
          const x0 = ROAD_GRID[i] + ROAD_HALF;
          const x1 = ROAD_GRID[i + 1] - ROAD_HALF;
          seg(x1 - x0, SW_WIDTH, (x0 + x1) / 2, cz);
        }
      }
    }

    this.scene.add(new THREE.Mesh(mergeGeometries(geos), M.sidewalk));
    geos.forEach((g) => g.dispose());
  }

  // ── road markings (accumulated then merged in _flush) ─────────────────────

  _makeRoadMarkings() {
    const dashLen = 3,
      dashGap = 3,
      laneOff = 3.5;

    // Centre lines + lane dashes for every road segment between intersections
    for (const r of ROAD_GRID) {
      for (let i = 0; i < ROAD_GRID.length - 1; i++) {
        const s0 = ROAD_GRID[i] + ROAD_HALF + 0.5;
        const s1 = ROAD_GRID[i + 1] - ROAD_HALF - 0.5;
        const len = s1 - s0;
        const mid = (s0 + s1) / 2;
        if (len <= 0) continue;

        // Yellow centre line — N-S road
        if (!this._inPark(r, mid))
          this._yellowGeos.push(markPlane(0.18, len, r, mid));
        // Yellow centre line — E-W road
        if (!this._inPark(mid, r))
          this._yellowGeos.push(markPlane(len, 0.18, mid, r));

        // White dashes — N-S road
        for (let p = s0 + dashLen / 2; p < s1; p += dashLen + dashGap) {
          for (const xo of [-laneOff, laneOff])
            if (!this._inPark(r + xo, p))
              this._whiteGeos.push(markPlane(0.12, dashLen, r + xo, p));
        }
        // White dashes — E-W road
        for (let p = s0 + dashLen / 2; p < s1; p += dashLen + dashGap) {
          for (const zo of [-laneOff, laneOff])
            if (!this._inPark(p, r + zo))
              this._whiteGeos.push(markPlane(dashLen, 0.12, p, r + zo));
        }
      }
    }

    // Crosswalk stripes at every intersection.
    // Each crosswalk is a row of N thin bars spread evenly from one sidewalk
    // to the other (cwLen = 19 units).  The bars are oriented parallel to the
    // road being crossed so the pedestrian steps on them while walking across.
    // Y = 0.07 — well above both overlapping road planes so no z-fighting.
    const Y_CW = 0.07;
    const cwLen = ROAD_HALF * 2 + SW_WIDTH * 2; // 19 — sidewalk to sidewalk
    const cwThk = 0.85; // width of each bar (in crossing direction)
    const cwDepth = SW_WIDTH + 0.4; // depth of bar (zone width adjacent to road)
    const N_BARS = 11;

    // Bar centres spread only across the road surface (±ROAD_HALF),
    // so no bar overlaps the raised sidewalk and causes z-fighting.
    const edgeCenter = ROAD_HALF - cwThk / 2; // 6.575 — outermost bar edge = road edge
    const barSpacing = N_BARS > 1 ? (2 * edgeCenter) / (N_BARS - 1) : 0;

    for (const rx of ROAD_GRID) {
      for (const rz of ROAD_GRID) {
        for (let i = 0; i < N_BARS; i++) {
          const pos = -edgeCenter + i * barSpacing; // −9.075 … +9.075

          // North/South crosswalks: bars run N-S (cwDepth in Z), spread in X
          // Positioned in the sidewalk zone just outside the E-W road edge
          const nsZ1 = rz + ROAD_HALF + cwDepth / 2;
          const nsZ2 = rz - ROAD_HALF - cwDepth / 2;
          if (!this._inPark(rx + pos, nsZ1))
            this._whiteGeos.push(markPlane(cwThk, cwDepth, rx + pos, nsZ1, Y_CW));
          if (!this._inPark(rx + pos, nsZ2))
            this._whiteGeos.push(markPlane(cwThk, cwDepth, rx + pos, nsZ2, Y_CW));

          // East/West crosswalks: bars run E-W (cwDepth in X), spread in Z
          // Positioned in the sidewalk zone just outside the N-S road edge
          const ewX1 = rx + ROAD_HALF + cwDepth / 2;
          const ewX2 = rx - ROAD_HALF - cwDepth / 2;
          if (!this._inPark(ewX1, rz + pos))
            this._whiteGeos.push(markPlane(cwDepth, cwThk, ewX1, rz + pos, Y_CW));
          if (!this._inPark(ewX2, rz + pos))
            this._whiteGeos.push(markPlane(cwDepth, cwThk, ewX2, rz + pos, Y_CW));
        }
      }
    }
  }

  // ── buildings ─────────────────────────────────────────────────────────────

  _makeBuildings() {
    const N = ROAD_GRID.length - 1; // 4

    for (let xi = 0; xi < N; xi++) {
      for (let zi = 0; zi < N; zi++) {
        // World-space origin of this block's building area
        const bx = ROAD_GRID[xi] + BUILD_START;
        const bz = ROAD_GRID[zi] + BUILD_START;

        // Height scale: taller near city centre, shorter toward edges
        const dx = xi - (N - 1) / 2;
        const dz = zi - (N - 1) / 2;
        const hf = Math.max(0.65, 1.35 - Math.sqrt(dx * dx + dz * dz) * 0.2);

        const tpl = TEMPLATES[(xi + zi * 3) % TEMPLATES.length];
        for (const b of tpl) {
          const cx = bx + b.ox + b.w / 2;
          const cz = bz + b.oz + b.d / 2;
          if (this._inPark(cx, cz)) continue; // leave this block open for a park
          this._addBuilding(
            cx,
            cz,
            b.w,
            b.d,
            Math.max(4, Math.round(b.h * hf)),
          );
        }
      }
    }
  }

  _addBuilding(cx, cz, w, d, h) {
    const color = C.facades[this._colorIdx++ % C.facades.length];

    // ── body (pre-translated, merged by colour → 8 draw calls total) ─────
    const bodyGeo = new THREE.BoxGeometry(w, h, d);
    bodyGeo.translate(cx, h / 2, cz);
    if (!this._buildingGeosByColor.has(color))
      this._buildingGeosByColor.set(color, []);
    this._buildingGeosByColor.get(color).push(bodyGeo);

    // ── roof (all roofs merged → 1 draw call) ─────────────────────────────
    const roofGeo = new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3);
    roofGeo.translate(cx, h + 0.2, cz);
    this._roofGeos.push(roofGeo);

    // ── Octree collider (player) ───────────────────────────────────────────
    const colMesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    colMesh.position.set(cx, h / 2, cz);
    this._collidables.add(colMesh);

    // ── Rapier collider (car) ──────────────────────────────────────────────
    if (this.rapierWorld) {
      const rb = this.rapierWorld.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(cx, h / 2, cz),
      );
      this.rapierWorld.createCollider(
        RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2),
        rb,
      );
    }

    // ── windows (all buildings → 1 merged mesh) ───────────────────────────
    const rows = Math.max(1, Math.floor(h / 3.0) - 1);
    const _m4 = new THREE.Matrix4();
    const _q = new THREE.Quaternion();
    const _s = new THREE.Vector3(1, 1, 1);

    const faces = [
      { fw: w, fh: h, ry: 0, ox: 0, oz: d / 2 + 0.05 },
      { fw: w, fh: h, ry: Math.PI, ox: 0, oz: -d / 2 - 0.05 },
      { fw: d, fh: h, ry: Math.PI / 2, ox: w / 2 + 0.05, oz: 0 },
      { fw: d, fh: h, ry: -Math.PI / 2, ox: -w / 2 - 0.05, oz: 0 },
    ];
    for (const f of faces) {
      const cols = Math.max(1, Math.floor(f.fw / 2.5));
      const wg = buildWindowGeo(f.fw, f.fh, cols, rows);
      _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), f.ry);
      _m4.compose(new THREE.Vector3(cx + f.ox, 0, cz + f.oz), _q, _s);
      wg.applyMatrix4(_m4);
      this._windowGeos.push(wg);
    }
  }

  // ── lamp posts — InstancedMesh (3 draw calls for all lamps) ───────────────

  _makeLamps() {
    const positions = [];

    // 4 corner lamps at every intersection
    for (const rx of ROAD_GRID) {
      for (const rz of ROAD_GRID) {
        const corners = [
          { sx: 1, sz: 1, rotY: 0 },
          { sx: -1, sz: 1, rotY: -Math.PI / 2 },
          { sx: 1, sz: -1, rotY: Math.PI / 2 },
          { sx: -1, sz: -1, rotY: Math.PI },
        ];
        for (const { sx, sz, rotY } of corners) {
          const x = rx + sx * (ROAD_HALF + 0.6);
          const z = rz + sz * (ROAD_HALF + 0.6);
          if (this._inPark(x, z)) continue; // park supplies its own scenery
          positions.push({ x, z, rotY });
        }
      }
    }

    const count = positions.length;
    const postInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.07, 0.1, 5, 6),
      M.post,
      count,
    );
    const armInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5),
      M.post,
      count,
    );
    const headInst = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.22, 6, 6),
      M.head,
      count,
    );

    const UP = new THREE.Vector3(0, 1, 0);
    const S = new THREE.Vector3(1, 1, 1);
    const m = new THREE.Matrix4();

    positions.forEach(({ x, z, rotY }, i) => {
      const yQ = new THREE.Quaternion().setFromAxisAngle(UP, rotY);

      // Post
      m.compose(new THREE.Vector3(x, 2.5, z), yQ, S);
      postInst.setMatrixAt(i, m);

      // Arm
      const armPos = new THREE.Vector3(0.7, 5.1, 0)
        .applyQuaternion(yQ)
        .add(new THREE.Vector3(x, 0, z));
      const armQ = new THREE.Quaternion()
        .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
        .premultiply(yQ);
      m.compose(armPos, armQ, S);
      armInst.setMatrixAt(i, m);

      // Head
      const headPos = new THREE.Vector3(1.4, 5.0, 0)
        .applyQuaternion(yQ)
        .add(new THREE.Vector3(x, 0, z));
      m.compose(headPos, new THREE.Quaternion(), S);
      headInst.setMatrixAt(i, m);

      // Octree collider (player)
      const oct = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 5, 0.3),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      oct.position.set(x, 2.5, z);
      this._collidables.add(oct);

      // Rapier collider (car)
      if (this.rapierWorld) {
        const rb = this.rapierWorld.createRigidBody(
          RAPIER.RigidBodyDesc.fixed().setTranslation(x, 2.5, z),
        );
        this.rapierWorld.createCollider(
          RAPIER.ColliderDesc.cylinder(2.5, 0.15),
          rb,
        );
      }
    });

    postInst.instanceMatrix.needsUpdate = true;
    armInst.instanceMatrix.needsUpdate = true;
    headInst.instanceMatrix.needsUpdate = true;
    this.scene.add(postInst, armInst, headInst);
  }
}
