import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import Experience from '../Experience.js';

// ─── palette ─────────────────────────────────────────────────────────────────

const C = {
    asphalt:    0x1c1c1e,
    sidewalk:   0x8a8478,
    lineWhite:  0xddddd0,
    lineYellow: 0xf0c040,
    facades: [
        0x8a9ba8, 0xb8a898, 0x7e8c80, 0xa09080,
        0xaaaaaa, 0x6e7d8c, 0xc4b49a, 0x9a8878,
    ],
    window:   0x1a3a5c,
    winGlow:  0x3a6080,
    lampPost: 0x333333,
    lampHead: 0xfff5cc,
};

const ROAD_HALF   = 7;
const SW_WIDTH    = 2.5;
const CURB_H      = 0.12;
const BUILD_START = ROAD_HALF + SW_WIDTH;
const Y_MARK      = 0.012; // road marking height

// ─── shared materials (created once, reused everywhere) ──────────────────────

// MeshLambertMaterial: no PBR — ~3x faster than MeshStandard for a scene
// with mostly ambient + one directional light.
const M = {
    asphalt:  new THREE.MeshLambertMaterial({ color: C.asphalt }),
    sidewalk: new THREE.MeshLambertMaterial({ color: C.sidewalk }),
    roof:     new THREE.MeshLambertMaterial({ color: 0x333333 }),
    detail:   new THREE.MeshLambertMaterial({ color: 0x444444 }),
    tank:     new THREE.MeshLambertMaterial({ color: 0x6a4030 }),
    post:     new THREE.MeshLambertMaterial({ color: C.lampPost }),
    head:     new THREE.MeshLambertMaterial({ color: C.lampHead, emissive: C.lampHead, emissiveIntensity: 0.9 }),

    // Road markings — polygonOffset prevents z-fighting vs road surface
    lineWhite: (() => {
        const m = new THREE.MeshLambertMaterial({ color: C.lineWhite });
        m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
        return m;
    })(),
    lineYellow: (() => {
        const m = new THREE.MeshLambertMaterial({ color: C.lineYellow });
        m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
        return m;
    })(),
    // Windows — shared across ALL buildings (112 meshes → 1)
    window: (() => {
        const m = new THREE.MeshLambertMaterial({ color: C.window, emissive: C.winGlow, emissiveIntensity: 0.25 });
        m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2;
        return m;
    })(),
};

// Per-facade colour — cached so the same colour reuses the same material
const _facadeCache = new Map();
function facadeMat(color) {
    if (!_facadeCache.has(color)) {
        _facadeCache.set(color, new THREE.MeshLambertMaterial({ color }));
    }
    return _facadeCache.get(color);
}

// ─── geometry helpers ────────────────────────────────────────────────────────

/** Return a PlaneGeometry (XZ), positioned and ready to be merged. */
function markPlane(w, d, x, z) {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    geo.translate(x, Y_MARK, z);
    return geo;
}

/** All windows for one building face as a single BufferGeometry (local space). */
function buildWindowGeo(faceW, faceH, cols, rows) {
    const colGap = faceW / (cols + 1);
    const rowGap = faceH / (rows + 1);
    const ww = Math.min(colGap * 0.55, 1.4);
    const wh = Math.min(rowGap * 0.60, 1.6);

    const positions = [], normals = [], indices = [];
    let vi = 0;
    for (let r = 0; r < rows; r++) {
        const y = rowGap * (r + 1);
        for (let c = 0; c < cols; c++) {
            const x = colGap * (c + 1) - faceW / 2;
            positions.push(
                x - ww/2, y - wh/2, 0,  x + ww/2, y - wh/2, 0,
                x + ww/2, y + wh/2, 0,  x - ww/2, y + wh/2, 0,
            );
            normals.push(0,0,1, 0,0,1, 0,0,1, 0,0,1);
            indices.push(vi, vi+1, vi+2,  vi, vi+2, vi+3);
            vi += 4;
        }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal',   new THREE.Float32BufferAttribute(normals,   3));
    geo.setIndex(indices);
    return geo;
}

// ─── CityBlock ────────────────────────────────────────────────────────────────

export default class CityBlock {
    constructor({ rapierWorld } = {}) {
        this.experience  = new Experience();
        this.scene       = this.experience.scene;
        this.octree      = this.experience.world.octree;
        this.rapierWorld = rapierWorld || null;

        this._collidables = new THREE.Group();
        this._colorIdx    = 0;

        // Accumulate geometries for deferred-merge batches
        this._whiteGeos   = [];  // road dashes + crosswalk
        this._yellowGeos  = [];  // centre lines
        this._windowGeos  = [];  // all building windows

        this._build();
        this._flushBatches();

        this.scene.add(this._collidables);
        this._collidables.updateMatrixWorld(true);
        this.octree.fromGraphNode(this._collidables);
    }

    // ── Merge all accumulated geometry batches into single draw calls ─────────

    _flushBatches() {
        if (this._whiteGeos.length) {
            this.scene.add(new THREE.Mesh(mergeGeometries(this._whiteGeos),  M.lineWhite));
            this._whiteGeos.forEach(g => g.dispose());
        }
        if (this._yellowGeos.length) {
            this.scene.add(new THREE.Mesh(mergeGeometries(this._yellowGeos), M.lineYellow));
            this._yellowGeos.forEach(g => g.dispose());
        }
        if (this._windowGeos.length) {
            this.scene.add(new THREE.Mesh(mergeGeometries(this._windowGeos), M.window));
            this._windowGeos.forEach(g => g.dispose());
        }
        this._whiteGeos = this._yellowGeos = this._windowGeos = null;
    }

    _build() {
        this._makeGround();
        this._makeRoads();
        this._makeSidewalks();
        this._makeRoadMarkings();
        this._makeAllBuildings();
        this._makeStreetLamps();
    }

    // ─── ground ──────────────────────────────────────────────────────────────

    _makeGround() {
        const geo = new THREE.PlaneGeometry(100, 100);
        geo.rotateX(-Math.PI / 2);
        this.scene.add(new THREE.Mesh(geo, M.asphalt));
    }

    // ─── roads ───────────────────────────────────────────────────────────────

    _makeRoads() {
        // N-S and E-W roads share the same material — merge into one draw call
        const ns = new THREE.PlaneGeometry(ROAD_HALF * 2, 100);
        ns.rotateX(-Math.PI / 2); ns.translate(0, 0.01, 0);

        const ew = new THREE.PlaneGeometry(100, ROAD_HALF * 2);
        ew.rotateX(-Math.PI / 2); ew.translate(0, 0.01, 0);

        this.scene.add(new THREE.Mesh(mergeGeometries([ns, ew]), M.asphalt));
        ns.dispose(); ew.dispose();
    }

    // ─── sidewalks ───────────────────────────────────────────────────────────

    _makeSidewalks() {
        const L = 100, y = CURB_H / 2;
        const geos = [];

        for (const sx of [-1, 1]) {
            const g = new THREE.BoxGeometry(SW_WIDTH, CURB_H, L);
            g.translate(sx * (ROAD_HALF + SW_WIDTH / 2), y, 0);
            geos.push(g);
        }
        for (const sz of [-1, 1]) {
            const g = new THREE.BoxGeometry(L, CURB_H, SW_WIDTH);
            g.translate(0, y, sz * (ROAD_HALF + SW_WIDTH / 2));
            geos.push(g);
        }

        this.scene.add(new THREE.Mesh(mergeGeometries(geos), M.sidewalk));
        geos.forEach(g => g.dispose());
    }

    // ─── road markings (accumulated, merged in _flushBatches) ────────────────

    _makeRoadMarkings() {
        // Yellow centre lines — split at junction to avoid overlap z-fighting
        const halfLen = 50 - ROAD_HALF;
        const armOff  = ROAD_HALF + halfLen / 2;
        for (const sign of [-1, 1]) {
            this._yellowGeos.push(markPlane(0.18, halfLen, 0,           sign * armOff));
            this._yellowGeos.push(markPlane(halfLen, 0.18, sign * armOff, 0));
        }

        // White dashes — N-S road
        const dashLen = 3, dashGap = 3, laneOff = 3.5;
        for (let z = -48; z < 48; z += dashLen + dashGap) {
            if (Math.abs(z + dashLen / 2) < ROAD_HALF + 1) continue;
            for (const xo of [-laneOff, laneOff]) {
                this._whiteGeos.push(markPlane(0.12, dashLen, xo, z + dashLen / 2));
            }
        }
        // White dashes — E-W road
        for (let x = -48; x < 48; x += dashLen + dashGap) {
            if (Math.abs(x + dashLen / 2) < ROAD_HALF + 1) continue;
            for (const zo of [-laneOff, laneOff]) {
                this._whiteGeos.push(markPlane(dashLen, 0.12, x + dashLen / 2, zo));
            }
        }

        // Crosswalk stripes — 4 sides of the intersection
        const stripeW = 0.8, stripeD = ROAD_HALF * 2;
        const cOff = ROAD_HALF + SW_WIDTH / 2;
        for (const offset of [-2.4, -1.2, 0, 1.2, 2.4]) {
            this._whiteGeos.push(markPlane(stripeW, stripeD, offset,  cOff));
            this._whiteGeos.push(markPlane(stripeW, stripeD, offset, -cOff));
            this._whiteGeos.push(markPlane(stripeD, stripeW,  cOff, offset));
            this._whiteGeos.push(markPlane(stripeD, stripeW, -cOff, offset));
        }
    }

    // ─── buildings ───────────────────────────────────────────────────────────

    _makeAllBuildings() {
        const ne = [
            { ox:  2, oz:  2, w: 16, d: 14, h: 22 }, { ox: 20, oz:  2, w: 12, d: 12, h: 14 },
            { ox:  2, oz: 18, w: 10, d: 14, h: 18 }, { ox: 20, oz: 18, w: 16, d: 14, h:  9 },
            { ox: 34, oz:  4, w:  9, d: 18, h: 28 }, { ox:  4, oz: 34, w: 14, d:  9, h: 16 },
            { ox: 22, oz: 34, w: 12, d:  9, h: 12 },
        ];
        const nw = [
            { ox:  2, oz:  2, w: 18, d: 12, h: 16 }, { ox: 22, oz:  2, w: 11, d: 12, h: 24 },
            { ox:  2, oz: 16, w: 14, d: 16, h: 12 }, { ox: 18, oz: 16, w: 14, d: 16, h: 20 },
            { ox: 34, oz:  6, w:  8, d: 14, h: 14 }, { ox: 10, oz: 34, w: 20, d:  8, h:  8 },
            { ox: 34, oz: 24, w:  8, d: 14, h: 18 },
        ];
        const se = [
            { ox:  2, oz:  2, w: 14, d: 16, h: 18 }, { ox: 18, oz:  2, w: 14, d: 12, h: 26 },
            { ox:  4, oz: 20, w: 16, d: 12, h: 14 }, { ox: 24, oz: 18, w: 12, d: 14, h: 10 },
            { ox:  2, oz: 34, w: 12, d:  8, h: 20 }, { ox: 34, oz: 34, w:  9, d:  9, h:  8 },
            { ox: 36, oz:  6, w:  7, d: 12, h: 16 },
        ];
        const sw = [
            { ox:  2, oz:  2, w: 14, d: 14, h: 12 }, { ox: 18, oz:  2, w: 14, d: 12, h: 20 },
            { ox:  2, oz: 18, w: 10, d: 16, h: 24 }, { ox: 20, oz: 18, w: 16, d: 14, h: 16 },
            { ox: 34, oz:  8, w:  9, d: 16, h: 22 }, { ox: 10, oz: 34, w: 16, d:  8, h: 14 },
            { ox: 28, oz: 34, w: 10, d:  8, h: 10 },
        ];

        this._placeBlock( 1,  1, ne);
        this._placeBlock(-1,  1, nw);
        this._placeBlock( 1, -1, se);
        this._placeBlock(-1, -1, sw);
    }

    _placeBlock(signX, signZ, specs) {
        for (const b of specs) {
            this._addBuilding(
                signX * (BUILD_START + b.ox + b.w / 2),
                signZ * (BUILD_START + b.oz + b.d / 2),
                b.w, b.d, b.h,
            );
        }
    }

    _addBuilding(cx, cz, w, d, h) {
        const color = C.facades[this._colorIdx++ % C.facades.length];

        // Body
        const bodyGeo = new THREE.BoxGeometry(w, h, d);
        const bodyMesh = new THREE.Mesh(bodyGeo, facadeMat(color));
        bodyMesh.position.set(cx, h / 2, cz);
        this.scene.add(bodyMesh);

        // Roof (merged with detail material later would help, but only 28 roofs)
        const roofGeo = new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3);
        const roofMesh = new THREE.Mesh(roofGeo, M.roof);
        roofMesh.position.set(cx, h + 0.2, cz);
        this.scene.add(roofMesh);

        // Octree collider
        const colGeo = new THREE.BoxGeometry(w, h, d);
        const colMesh = new THREE.Mesh(colGeo, new THREE.MeshBasicMaterial({ visible: false }));
        colMesh.position.set(cx, h / 2, cz);
        this._collidables.add(colMesh);

        // Rapier collider
        if (this.rapierWorld) {
            const rb = this.rapierWorld.createRigidBody(
                RAPIER.RigidBodyDesc.fixed().setTranslation(cx, h / 2, cz),
            );
            this.rapierWorld.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), rb);
        }

        // Windows — transform into world space and push into shared batch
        const floorH = 3.0;
        const rows   = Math.max(1, Math.floor(h / floorH) - 1);
        const _mat4  = new THREE.Matrix4();
        const _quat  = new THREE.Quaternion();

        const faces = [
            { faceW: w, faceH: h, rotY:           0, ox:  0,        oz:  d / 2 + 0.05 },
            { faceW: w, faceH: h, rotY:     Math.PI, ox:  0,        oz: -d / 2 - 0.05 },
            { faceW: d, faceH: h, rotY:  Math.PI/2,  ox:  w / 2 + 0.05, oz: 0 },
            { faceW: d, faceH: h, rotY: -Math.PI/2,  ox: -w / 2 - 0.05, oz: 0 },
        ];

        for (const face of faces) {
            const cols  = Math.max(1, Math.floor(face.faceW / 2.5));
            const winGeo = buildWindowGeo(face.faceW, face.faceH, cols, rows);
            _quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), face.rotY);
            _mat4.compose(
                new THREE.Vector3(cx + face.ox, 0, cz + face.oz),
                _quat,
                new THREE.Vector3(1, 1, 1),
            );
            winGeo.applyMatrix4(_mat4);
            this._windowGeos.push(winGeo);
        }

        // Rooftop detail
        if (h >= 16) this._addRooftopDetail(cx, cz, w, d, h);
    }

    _addRooftopDetail(cx, cz, w, d, h) {
        const bx = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), M.detail);
        bx.position.set(cx + w * 0.25, h + 0.95, cz + d * 0.25);
        this.scene.add(bx);

        if (h >= 20) {
            const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2, 5), M.detail);
            legs.position.set(cx - w * 0.2, h + 1, cz - d * 0.2);
            this.scene.add(legs);

            const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.8, 8), M.tank);
            tank.position.set(cx - w * 0.2, h + 2.4, cz - d * 0.2);
            this.scene.add(tank);
        }
    }

    // ─── street lamps — InstancedMesh (3 draw calls for all lamps) ───────────

    _makeStreetLamps() {
        const positions = [];

        for (let z = -40; z <= 40; z += 20) {
            positions.push({ x:  ROAD_HALF + 0.6, z, rotY: 0 });
            positions.push({ x: -ROAD_HALF - 0.6, z, rotY: Math.PI });
        }
        for (let x = -40; x <= 40; x += 20) {
            if (Math.abs(x) < ROAD_HALF + 2) continue;
            positions.push({ x, z:  ROAD_HALF + 0.6, rotY: -Math.PI / 2 });
            positions.push({ x, z: -ROAD_HALF - 0.6, rotY:  Math.PI / 2 });
        }
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            positions.push({ x: sx * (ROAD_HALF + 0.6), z: sz * (ROAD_HALF + 0.6), rotY: 0 });
        }

        const count = positions.length;

        // InstancedMesh — 3 draw calls total regardless of lamp count
        const postInst = new THREE.InstancedMesh(
            new THREE.CylinderGeometry(0.07, 0.1, 5, 6), M.post, count);
        const armInst  = new THREE.InstancedMesh(
            new THREE.CylinderGeometry(0.05, 0.05, 1.4, 5), M.post, count);
        const headInst = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.22, 6, 6), M.head, count);

        const up      = new THREE.Vector3(0, 1, 0);
        const fwd     = new THREE.Vector3(1, 0, 0);
        const unitScale = new THREE.Vector3(1, 1, 1);
        const m = new THREE.Matrix4();

        positions.forEach(({ x, z, rotY }, i) => {
            const yQ = new THREE.Quaternion().setFromAxisAngle(up, rotY);

            // Post: centred at (x, 2.5, z)
            m.compose(new THREE.Vector3(x, 2.5, z), yQ, unitScale);
            postInst.setMatrixAt(i, m);

            // Arm: offset (0.7, 5.1, 0) in local space, rotated 90° around Z
            const armLocalPos = new THREE.Vector3(0.7, 5.1, 0).applyQuaternion(yQ);
            const armQuat = new THREE.Quaternion()
                .setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2)
                .premultiply(yQ);
            m.compose(new THREE.Vector3(x, 0, z).add(armLocalPos), armQuat, unitScale);
            armInst.setMatrixAt(i, m);

            // Head: offset (1.4, 5.0, 0) in local space
            const headWorldPos = new THREE.Vector3(1.4, 5.0, 0)
                .applyQuaternion(yQ)
                .add(new THREE.Vector3(x, 0, z));
            m.compose(headWorldPos, new THREE.Quaternion(), unitScale);
            headInst.setMatrixAt(i, m);

            // Octree collider (player)
            const octCol = new THREE.Mesh(
                new THREE.BoxGeometry(0.3, 5, 0.3),
                new THREE.MeshBasicMaterial({ visible: false }),
            );
            octCol.position.set(x, 2.5, z);
            this._collidables.add(octCol);

            // Rapier collider (car)
            if (this.rapierWorld) {
                const rb = this.rapierWorld.createRigidBody(
                    RAPIER.RigidBodyDesc.fixed().setTranslation(x, 2.5, z),
                );
                this.rapierWorld.createCollider(RAPIER.ColliderDesc.cylinder(2.5, 0.15), rb);
            }
        });

        postInst.instanceMatrix.needsUpdate = true;
        armInst.instanceMatrix.needsUpdate  = true;
        headInst.instanceMatrix.needsUpdate = true;

        this.scene.add(postInst, armInst, headInst);
        // No PointLights — the emissive lamp head provides visual glow at zero GPU cost
    }
}
