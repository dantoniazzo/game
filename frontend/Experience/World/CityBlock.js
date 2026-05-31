import * as THREE from 'three';
import Experience from '../Experience.js';

// ─── palette ─────────────────────────────────────────────────────────────────

const C = {
    asphalt:   0x1c1c1e,
    sidewalk:  0x8a8478,
    lineWhite: 0xddddd0,
    lineYellow:0xf0c040,
    curb:      0x555550,

    // building facade colours — rotated round-robin per building
    facades: [
        0x8a9ba8,  // concrete blue-grey
        0xb8a898,  // warm stone
        0x7e8c80,  // sage
        0xa09080,  // terracotta-grey
        0xaaaaaa,  // light grey
        0x6e7d8c,  // slate
        0xc4b49a,  // cream
        0x9a8878,  // dark sand
    ],

    window:    0x1a3a5c,  // dark tinted glass
    winGlow:   0x3a6080,  // emissive tint for a lit-window feel
    lampPost:  0x333333,
    lampLight: 0xfff5cc,
};

// road geometry constants
const ROAD_HALF   = 7;     // half-width of each road (total 14 units wide)
const SW_WIDTH    = 2.5;   // sidewalk width
const CURB_H      = 0.12;  // kerb / sidewalk height
const BUILD_START = ROAD_HALF + SW_WIDTH; // buildings start here (~9.5)

// ─── helpers ─────────────────────────────────────────────────────────────────

function mat(color, roughness = 0.85, metalness = 0, emissive = 0x000000, emissiveIntensity = 0) {
    return new THREE.MeshStandardMaterial({ color, roughness, metalness, emissive, emissiveIntensity });
}

/** Same as mat() but with polygon offset so it never z-fights with the
 *  surface it overlays (road markings, window panels, etc.). */
function overlayMat(color, roughness = 0.85, metalness = 0, emissive = 0x000000, emissiveIntensity = 0) {
    const m = mat(color, roughness, metalness, emissive, emissiveIntensity);
    m.polygonOffset      = true;
    m.polygonOffsetFactor = -2;
    m.polygonOffsetUnits  = -2;
    return m;
}

/** Flat plane lying on the XZ plane, slightly above y=0 */
function hPlane(w, d, color, roughness = 0.95, overlay = false) {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geo, overlay ? overlayMat(color, roughness) : mat(color, roughness));
}

/** Merge an array of { x, y, cols, rows, ww, wh, colGap, rowGap } specs
 *  into a single BufferGeometry (all windows for one building face). */
function buildWindowGeo(faceW, faceH, cols, rows) {
    const colGap  = faceW / (cols + 1);
    const rowGap  = faceH / (rows + 1);
    const ww = Math.min(colGap * 0.55, 1.4);
    const wh = Math.min(rowGap * 0.60, 1.6);

    const positions = [];
    const normals   = [];
    const indices   = [];
    let vi = 0;

    for (let r = 0; r < rows; r++) {
        const y = rowGap * (r + 1);
        for (let c = 0; c < cols; c++) {
            const x = colGap * (c + 1) - faceW / 2;
            positions.push(
                x - ww / 2, y - wh / 2, 0,
                x + ww / 2, y - wh / 2, 0,
                x + ww / 2, y + wh / 2, 0,
                x - ww / 2, y + wh / 2, 0,
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
    constructor() {
        this.experience   = new Experience();
        this.scene        = this.experience.scene;
        this.octree       = this.experience.world.octree;

        // invisible collidable meshes fed to the Octree
        this._collidables = new THREE.Group();
        this._colorIdx    = 0;

        this._build();

        this.scene.add(this._collidables);
        this._collidables.updateMatrixWorld(true);
        this.octree.fromGraphNode(this._collidables);
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
        const mesh = hPlane(100, 100, C.asphalt, 1.0);
        mesh.receiveShadow = true;
        this.scene.add(mesh);
    }

    // ─── roads ───────────────────────────────────────────────────────────────

    _makeRoads() {
        const roadMat = mat(C.asphalt, 0.95);

        // N-S road (along Z)
        const ns = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_HALF * 2, 100).rotateX(-Math.PI / 2), roadMat);
        ns.position.y = 0.01;
        this.scene.add(ns);

        // E-W road (along X)
        const ew = new THREE.Mesh(new THREE.PlaneGeometry(100, ROAD_HALF * 2).rotateX(-Math.PI / 2), roadMat);
        ew.position.y = 0.01;
        this.scene.add(ew);
    }

    // ─── sidewalks ───────────────────────────────────────────────────────────

    _makeSidewalks() {
        // The raised BoxGeometry itself forms a natural kerb step — no separate
        // lip mesh needed (those shared vertical faces caused z-fighting).
        const swMat = mat(C.sidewalk, 0.9);
        const y = CURB_H / 2;
        const L = 100;

        for (const sx of [-1, 1]) {
            const sw = new THREE.Mesh(new THREE.BoxGeometry(SW_WIDTH, CURB_H, L), swMat);
            sw.position.set(sx * (ROAD_HALF + SW_WIDTH / 2), y, 0);
            this.scene.add(sw);
        }

        for (const sz of [-1, 1]) {
            const sw = new THREE.Mesh(new THREE.BoxGeometry(L, CURB_H, SW_WIDTH), swMat);
            sw.position.set(0, y, sz * (ROAD_HALF + SW_WIDTH / 2));
            this.scene.add(sw);
        }
    }

    // ─── road markings ───────────────────────────────────────────────────────

    _makeRoadMarkings() {
        const Y = 0.012; // sits just above the road; polygonOffset handles the rest

        // Centre lines — split into two halves either side of the junction so
        // the N-S and E-W planes never overlap (that overlap caused them to
        // fight each other despite sharing the same polygonOffset).
        const halfLen = 50 - ROAD_HALF;  // length of each arm outside the junction
        const armOff  = ROAD_HALF + halfLen / 2; // centre of each arm

        for (const sign of [-1, 1]) {
            const ns = hPlane(0.18, halfLen, C.lineYellow, 1.0, true);
            ns.position.set(0, Y, sign * armOff);
            this.scene.add(ns);

            const ew = hPlane(halfLen, 0.18, C.lineYellow, 1.0, true);
            ew.position.set(sign * armOff, Y, 0);
            this.scene.add(ew);
        }

        // dashed lane dividers – N-S road
        const dashLen = 3, dashGap = 3, laneOff = 3.5;
        for (let z = -48; z < 48; z += dashLen + dashGap) {
            if (Math.abs(z + dashLen / 2) < ROAD_HALF + 1) continue;
            for (const xo of [-laneOff, laneOff]) {
                const d = hPlane(0.12, dashLen, C.lineWhite, 1.0, true);
                d.position.set(xo, Y, z + dashLen / 2);
                this.scene.add(d);
            }
        }

        // dashed lane dividers – E-W road
        for (let x = -48; x < 48; x += dashLen + dashGap) {
            if (Math.abs(x + dashLen / 2) < ROAD_HALF + 1) continue;
            for (const zo of [-laneOff, laneOff]) {
                const d = hPlane(dashLen, 0.12, C.lineWhite, 1.0, true);
                d.position.set(x + dashLen / 2, Y, zo);
                this.scene.add(d);
            }
        }

        // crosswalk stripes — 4 sides of the intersection
        const stripeW = 0.8, stripeD = ROAD_HALF * 2;
        const crosswalkOffsets = [-2.4, -1.2, 0, 1.2, 2.4];
        for (const offset of crosswalkOffsets) {
            const n = hPlane(stripeW, stripeD, C.lineWhite, 1.0, true);
            n.position.set(offset, Y, ROAD_HALF + SW_WIDTH / 2);
            this.scene.add(n);

            const s = hPlane(stripeW, stripeD, C.lineWhite, 1.0, true);
            s.position.set(offset, Y, -(ROAD_HALF + SW_WIDTH / 2));
            this.scene.add(s);

            const e = hPlane(stripeD, stripeW, C.lineWhite, 1.0, true);
            e.position.set(ROAD_HALF + SW_WIDTH / 2, Y, offset);
            this.scene.add(e);

            const w = hPlane(stripeD, stripeW, C.lineWhite, 1.0, true);
            w.position.set(-(ROAD_HALF + SW_WIDTH / 2), Y, offset);
            this.scene.add(w);
        }
    }

    // ─── buildings ───────────────────────────────────────────────────────────

    _makeAllBuildings() {
        // Each building spec: ox, oz (offset from block corner), w, d, h
        // Block corner sits at x = ±BUILD_START, z = ±BUILD_START

        const ne = [
            { ox:  2, oz:  2, w: 16, d: 14, h: 22 },
            { ox: 20, oz:  2, w: 12, d: 12, h: 14 },
            { ox:  2, oz: 18, w: 10, d: 14, h: 18 },
            { ox: 20, oz: 18, w: 16, d: 14, h:  9 },
            { ox: 34, oz:  4, w:  9, d: 18, h: 28 },
            { ox:  4, oz: 34, w: 14, d:  9, h: 16 },
            { ox: 22, oz: 34, w: 12, d:  9, h: 12 },
        ];

        const nw = [
            { ox:  2, oz:  2, w: 18, d: 12, h: 16 },
            { ox: 22, oz:  2, w: 11, d: 12, h: 24 },
            { ox:  2, oz: 16, w: 14, d: 16, h: 12 },
            { ox: 18, oz: 16, w: 14, d: 16, h: 20 },
            { ox: 34, oz:  6, w:  8, d: 14, h: 14 },
            { ox: 10, oz: 34, w: 20, d:  8, h:  8 },
            { ox: 34, oz: 24, w:  8, d: 14, h: 18 },
        ];

        const se = [
            { ox:  2, oz:  2, w: 14, d: 16, h: 18 },
            { ox: 18, oz:  2, w: 14, d: 12, h: 26 },
            { ox:  4, oz: 20, w: 16, d: 12, h: 14 },
            { ox: 24, oz: 18, w: 12, d: 14, h: 10 },
            { ox:  2, oz: 34, w: 12, d:  8, h: 20 },
            { ox: 34, oz: 34, w:  9, d:  9, h:  8 },
            { ox: 36, oz:  6, w:  7, d: 12, h: 16 },
        ];

        const sw = [
            { ox:  2, oz:  2, w: 14, d: 14, h: 12 },
            { ox: 18, oz:  2, w: 14, d: 12, h: 20 },
            { ox:  2, oz: 18, w: 10, d: 16, h: 24 },
            { ox: 20, oz: 18, w: 16, d: 14, h: 16 },
            { ox: 34, oz:  8, w:  9, d: 16, h: 22 },
            { ox: 10, oz: 34, w: 16, d:  8, h: 14 },
            { ox: 28, oz: 34, w: 10, d:  8, h: 10 },
        ];

        this._placeBlock( 1,  1, ne);
        this._placeBlock(-1,  1, nw);
        this._placeBlock( 1, -1, se);
        this._placeBlock(-1, -1, sw);
    }

    _placeBlock(signX, signZ, specs) {
        for (const b of specs) {
            const cx = signX * (BUILD_START + b.ox + b.w / 2);
            const cz = signZ * (BUILD_START + b.oz + b.d / 2);
            this._addBuilding(cx, cz, b.w, b.d, b.h);
        }
    }

    _addBuilding(cx, cz, w, d, h) {
        const color  = C.facades[this._colorIdx++ % C.facades.length];
        const facadeMat = mat(color, 0.9);
        const roofMat   = mat(0x333333, 0.8);
        // overlayMat so window quads never z-fight the building face
        const winMat    = overlayMat(C.window, 0.1, 0.3, C.winGlow, 0.25);

        // ── main body ──────────────────────────────────────────────────────
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), facadeMat);
        body.position.set(cx, h / 2, cz);
        body.castShadow = true;
        body.receiveShadow = true;
        this.scene.add(body);

        // ── flat roof (slightly wider) ──────────────────────────────────────
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.4, d + 0.3), roofMat);
        roof.position.set(cx, h + 0.2, cz);
        this.scene.add(roof);

        // ── invisible collider (full height so players can't jump over) ────
        const colMesh = new THREE.Mesh(
            new THREE.BoxGeometry(w, h, d),
            new THREE.MeshBasicMaterial({ visible: false }),
        );
        colMesh.position.set(cx, h / 2, cz);
        this._collidables.add(colMesh);

        // ── windows on each vertical face ──────────────────────────────────
        const floorH = 3.0;
        const rows   = Math.max(1, Math.floor(h / floorH) - 1);

        const faces = [
            { faceW: w, faceH: h, rotY:       0, offX:  0,        offZ:  d / 2 + 0.05 },
            { faceW: w, faceH: h, rotY: Math.PI, offX:  0,        offZ: -d / 2 - 0.05 },
            { faceW: d, faceH: h, rotY:  Math.PI / 2, offX:  w / 2 + 0.05, offZ: 0 },
            { faceW: d, faceH: h, rotY: -Math.PI / 2, offX: -w / 2 - 0.05, offZ: 0 },
        ];

        for (const face of faces) {
            const cols = Math.max(1, Math.floor(face.faceW / 2.5));
            const winGeo = buildWindowGeo(face.faceW, face.faceH, cols, rows);
            const winMesh = new THREE.Mesh(winGeo, winMat);
            winMesh.rotation.y = face.rotY;
            winMesh.position.set(cx + face.offX, 0, cz + face.offZ);
            this.scene.add(winMesh);
        }

        // ── rooftop detail (water tower or AC unit) on taller buildings ────
        if (h >= 16) {
            this._addRooftopDetail(cx, cz, w, d, h);
        }
    }

    _addRooftopDetail(cx, cz, w, d, h) {
        const detMat = mat(0x444444, 0.8);
        // small box on roof
        const bx = new THREE.Mesh(new THREE.BoxGeometry(2, 1.5, 2), detMat);
        bx.position.set(cx + w * 0.25, h + 0.95, cz + d * 0.25);
        this.scene.add(bx);

        // cylinder water-tower on very tall buildings
        if (h >= 20) {
            const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 2, 6), detMat);
            legs.position.set(cx - w * 0.2, h + 1, cz - d * 0.2);
            this.scene.add(legs);
            const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.2, 1.8, 10), mat(0x6a4030, 0.9));
            tank.position.set(cx - w * 0.2, h + 2.4, cz - d * 0.2);
            this.scene.add(tank);
        }
    }

    // ─── street lamps ────────────────────────────────────────────────────────

    _makeStreetLamps() {
        // Place lamps along both roads and at block corners
        const lampPositions = [];

        // Along N-S road, east and west edges
        for (let z = -40; z <= 40; z += 20) {
            lampPositions.push({ x:  ROAD_HALF + 0.6, z, rotY: 0 });
            lampPositions.push({ x: -ROAD_HALF - 0.6, z, rotY: Math.PI });
        }

        // Along E-W road, north and south edges
        for (let x = -40; x <= 40; x += 20) {
            if (Math.abs(x) < ROAD_HALF + 2) continue; // skip intersection cluster
            lampPositions.push({ x, z:  ROAD_HALF + 0.6, rotY: -Math.PI / 2 });
            lampPositions.push({ x, z: -ROAD_HALF - 0.6, rotY:  Math.PI / 2 });
        }

        // Corner lamps at intersection
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
            lampPositions.push({ x: sx * (ROAD_HALF + 0.6), z: sz * (ROAD_HALF + 0.6), rotY: 0 });
        }

        for (const { x, z, rotY } of lampPositions) {
            this._addLamp(x, z, rotY);
        }
    }

    _addLamp(x, z, rotY) {
        const postMat = mat(C.lampPost, 0.6, 0.4);
        const headMat = mat(C.lampLight, 0.3, 0.0, C.lampLight, 1.0);

        const group = new THREE.Group();
        group.position.set(x, 0, z);
        group.rotation.y = rotY;

        // vertical post
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.1, 5, 8), postMat);
        post.position.y = 2.5;
        group.add(post);

        // horizontal arm
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), postMat);
        arm.rotation.z = Math.PI / 2;
        arm.position.set(0.7, 5.1, 0);
        group.add(arm);

        // lamp head
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 8), headMat);
        head.position.set(1.4, 5.0, 0);
        group.add(head);

        // actual point light (low intensity, short range — one per lamp is fine)
        const light = new THREE.PointLight(0xfff5cc, 1.2, 18, 2);
        light.position.set(1.4, 4.8, 0);
        group.add(light);

        this.scene.add(group);
    }
}
