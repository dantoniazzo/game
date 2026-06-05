import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import { RapierRaycastVehicle } from './RapierRaycastVehicle.js';

// Camera smoothing scratch objects
const _idealOffset    = new THREE.Vector3();
const _idealLookAt    = new THREE.Vector3();
const _chassisPos     = new THREE.Vector3();
const _chassisRot     = new THREE.Quaternion();

// Player collision scratch objects
const _carCollPos     = new THREE.Vector3();
const _carCollQuat    = new THREE.Quaternion();
const _carCollQuatInv = new THREE.Quaternion();
const _carLocal       = new THREE.Vector3();
const _carPush        = new THREE.Vector3();

// Network sync scratch objects
const _syncWheelOff   = new THREE.Vector3();

// Wheel local-space offsets (must match _createPhysics wheel configs)
const WHEEL_LOCAL_OFFSETS = [
    new THREE.Vector3( 1.3,  -0.3,  0.85),  // rear  left
    new THREE.Vector3( 1.3,  -0.3, -0.85),  // rear  right
    new THREE.Vector3(-1.35, -0.3,  0.85),  // front left
    new THREE.Vector3(-1.35, -0.3, -0.85),  // front right
];

// ─── Vehicle ──────────────────────────────────────────────────────────────────
//
// One drivable car. Several of these share a single Rapier world; the world is
// stepped ONCE per frame by VehicleFleet, not here. Each car is in one of three
// modes that decide how its transform is produced:
//   • "local"  – the local player is driving: physics-simulated + broadcast.
//   • "remote" – another player is driving: transform comes from the network
//                (the body is snapped to it each frame so the local car still
//                collides against it like a moving obstacle).
//   • "idle"   – nobody is driving: physics-simulated with no engine input, so
//                it rests on its suspension and can be bumped by the local car.

export default class Vehicle {
    constructor({ rapierWorld, scene, chassisGLTF, wheelGLTF, spawnPosition, id = 0, color = null, debugGUI = false }) {
        this.rapierWorld = rapierWorld;
        this.scene = scene;
        this.id = id;
        this.color = color;

        this.mode = 'idle';            // "local" | "remote" | "idle"
        this.active = false;           // convenience flag === (mode === "local")
        this.remoteDriverId = null;    // socket ID of whoever else is driving this car

        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            brake: false,
        };

        // Latest network transform (used in "remote" mode), plus an estimated
        // linear velocity so a remote car rams others with real momentum.
        this._netPos = new THREE.Vector3();
        this._netQuat = new THREE.Quaternion();
        this._netVel = new THREE.Vector3();
        this._netStamp = null;
        this._hasNet = false;

        // Camera state read by Camera.js each frame
        this.cameraPosition = new THREE.Vector3(5, 5, -15);
        this.cameraLookAt = new THREE.Vector3();

        this._boundKeyDown = this._onKeyDown.bind(this);
        this._boundKeyUp = this._onKeyUp.bind(this);

        // ── Tunable params (mirroring the Leva controls in the sketch) ─────────
        this.params = {
            // Controls
            maxForce: 500,
            maxSteer: 0.5,
            maxBrake: 10,

            // Damping — how quickly the car bleeds off speed when coasting
            linearDamping: 0.2,
            angularDamping: 2,

            // Wheel geometry
            radius: 0.38,

            // Suspension
            suspensionStiffness: 30,
            suspensionRestLength: 0.3,
            maxSuspensionForce: 100000,
            maxSuspensionTravel: 0.3,
            dampingRelaxation: 2.3,
            dampingCompression: 4.4,

            // Friction / handling
            sideFrictionStiffness: 1,
            frictionSlip: 1.4,
            rollInfluence: 0.01,
            forwardAcceleration: 2.5,
            sideAcceleration: 3.5,

            // Sliding spin
            customSlidingRotationalSpeed: -30,
            useCustomSlidingRotationalSpeed: true,
        };

        this._createPhysics(spawnPosition || new THREE.Vector3(5, 2, 5));
        this._createVisuals(chassisGLTF, wheelGLTF);
        if (debugGUI) this._createGUI();
    }

    // ─── physics setup ───────────────────────────────────────────────────────

    _createPhysics(spawnPosition) {
        const spawnQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            0, // faces along the E-W road
        );

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
            .setRotation({ x: spawnQuat.x, y: spawnQuat.y, z: spawnQuat.z, w: spawnQuat.w })
            .setLinearDamping(this.params.linearDamping)
            .setAngularDamping(this.params.angularDamping);

        this.chassisBody = this.rapierWorld.createRigidBody(bodyDesc);

        const colliderDesc = RAPIER.ColliderDesc.cuboid(2.35, 0.55, 1).setMass(150);
        this.rapierWorld.createCollider(colliderDesc, this.chassisBody);

        this.rapierVehicle = new RapierRaycastVehicle({
            world: this.rapierWorld,
            chassisRigidBody: this.chassisBody,
            indexRightAxis: 2,
            indexForwardAxis: 0,
            indexUpAxis: 1,
        });

        const p = this.params;
        const commonWheelOptions = {
            radius: p.radius,
            directionLocal: new THREE.Vector3(0, -1, 0),
            axleLocal: new THREE.Vector3(0, 0, 1),
            suspensionStiffness: p.suspensionStiffness,
            suspensionRestLength: p.suspensionRestLength,
            maxSuspensionForce: p.maxSuspensionForce,
            maxSuspensionTravel: p.maxSuspensionTravel,
            sideFrictionStiffness: p.sideFrictionStiffness,
            frictionSlip: p.frictionSlip,
            dampingRelaxation: p.dampingRelaxation,
            dampingCompression: p.dampingCompression,
            rollInfluence: p.rollInfluence,
            customSlidingRotationalSpeed: p.customSlidingRotationalSpeed,
            useCustomSlidingRotationalSpeed: p.useCustomSlidingRotationalSpeed,
            forwardAcceleration: p.forwardAcceleration,
            sideAcceleration: p.sideAcceleration,
        };

        // Wheel order: 0/1 → steering, 2/3 → engine (matches sketch)
        const VEHICLE_WIDTH  =  1.7;
        const VEHICLE_HEIGHT = -0.3;
        const VEHICLE_FRONT  = -1.35;
        const VEHICLE_BACK   =  1.3;

        const wheelPositions = [
            new THREE.Vector3(VEHICLE_BACK,  VEHICLE_HEIGHT,  VEHICLE_WIDTH * 0.5),
            new THREE.Vector3(VEHICLE_BACK,  VEHICLE_HEIGHT, -VEHICLE_WIDTH * 0.5),
            new THREE.Vector3(VEHICLE_FRONT, VEHICLE_HEIGHT,  VEHICLE_WIDTH * 0.5),
            new THREE.Vector3(VEHICLE_FRONT, VEHICLE_HEIGHT, -VEHICLE_WIDTH * 0.5),
        ];

        for (const pos of wheelPositions) {
            this.rapierVehicle.addWheel({ ...commonWheelOptions, chassisConnectionPointLocal: pos });
        }
    }

    // ─── visual setup ────────────────────────────────────────────────────────

    _createVisuals(chassisGLTF, wheelGLTF) {
        this.chassisGroup = new THREE.Group();
        const chassisScene = SkeletonUtils.clone(chassisGLTF.scene);
        chassisScene.position.set(-0.2, -0.25, 0);
        chassisScene.rotation.y = Math.PI / 2;

        // Per-car colour tint. SkeletonUtils.clone shares material references, so
        // clone each material before tinting or every car would change together.
        if (this.color != null) {
            const tint = new THREE.Color(this.color);
            const tintMat = (m) => {
                const c = m.clone();
                if (c.color) c.color.multiply(tint);
                return c;
            };
            chassisScene.traverse((o) => {
                if (o.isMesh && o.material) {
                    o.material = Array.isArray(o.material)
                        ? o.material.map(tintMat)
                        : tintMat(o.material);
                }
            });
        }

        this.chassisGroup.add(chassisScene);
        this.scene.add(this.chassisGroup);

        this.wheelMeshes = [];
        const sides = ['left', 'right', 'left', 'right'];

        for (let i = 0; i < 4; i++) {
            const wheelGroup = new THREE.Group();
            const wheelScene = SkeletonUtils.clone(wheelGLTF.scene);
            const scale = this.params.radius / 0.34;
            const mirrorX = sides[i] === 'left' ? -1 : 1;
            wheelScene.scale.set(scale * mirrorX, scale, scale);
            wheelScene.rotation.y = Math.PI / 2;
            wheelGroup.add(wheelScene);
            this.scene.add(wheelGroup);
            this.wheelMeshes.push(wheelGroup);
        }
    }

    // ─── lil-gui panel (opt-in; off for the fleet to avoid N stacked panels) ───

    _createGUI() {
        this.gui = new GUI({ title: `Vehicle ${this.id}`, width: 280 });
        const p = this.params;

        const syncWheels = (...keys) => {
            for (const wheel of this.rapierVehicle.wheels) {
                for (const key of keys) wheel.options[key] = p[key];
            }
        };

        const controlsFolder = this.gui.addFolder('Controls');
        controlsFolder.add(p, 'maxForce', 0, 1000, 1).name('Max Force');
        controlsFolder.add(p, 'maxSteer', 0.1, 1.5, 0.01).name('Max Steer (rad)');
        controlsFolder.add(p, 'maxBrake', 0, 50, 0.5).name('Max Brake');
        controlsFolder.add(p, 'linearDamping', 0, 10, 0.1).name('Linear Damping')
            .onChange(() => this.chassisBody.setLinearDamping(p.linearDamping));
        controlsFolder.add(p, 'angularDamping', 0, 10, 0.1).name('Angular Damping')
            .onChange(() => this.chassisBody.setAngularDamping(p.angularDamping));

        const suspFolder = this.gui.addFolder('Suspension');
        suspFolder.add(p, 'suspensionStiffness', 1, 200, 1).name('Stiffness')
            .onChange(() => syncWheels('suspensionStiffness'));
        suspFolder.add(p, 'suspensionRestLength', 0.05, 1, 0.01).name('Rest Length')
            .onChange(() => syncWheels('suspensionRestLength'));
        suspFolder.add(p, 'maxSuspensionTravel', 0.05, 1, 0.01).name('Max Travel')
            .onChange(() => syncWheels('maxSuspensionTravel'));
        suspFolder.close();

        const frictionFolder = this.gui.addFolder('Friction / Handling');
        frictionFolder.add(p, 'frictionSlip', 0, 5, 0.05).name('Friction Slip')
            .onChange(() => syncWheels('frictionSlip'));
        frictionFolder.add(p, 'forwardAcceleration', 0.1, 5, 0.1).name('Fwd Acceleration')
            .onChange(() => syncWheels('forwardAcceleration'));
        frictionFolder.close();
    }

    // ─── mode / controls ───────────────────────────────────────────────────────

    setMode(mode) {
        if (mode === this.mode) return;
        this.mode = mode;

        if (mode === 'local') {
            this.active = true;
            document.addEventListener('keydown', this._boundKeyDown);
            document.addEventListener('keyup', this._boundKeyUp);
        } else {
            this.active = false;
            document.removeEventListener('keydown', this._boundKeyDown);
            document.removeEventListener('keyup', this._boundKeyUp);
            for (const key of Object.keys(this.controls)) this.controls[key] = false;
        }
    }

    _onKeyDown(e) {
        if (document.activeElement?.tagName === 'INPUT') return;
        switch (e.code) {
            case 'KeyW': case 'ArrowUp':    this.controls.forward  = true; break;
            case 'KeyS': case 'ArrowDown':  this.controls.backward = true; break;
            case 'KeyA': case 'ArrowLeft':  this.controls.left     = true; break;
            case 'KeyD': case 'ArrowRight': this.controls.right    = true; break;
            case 'Space':                   this.controls.brake    = true; e.preventDefault(); break;
        }
    }

    _onKeyUp(e) {
        switch (e.code) {
            case 'KeyW': case 'ArrowUp':    this.controls.forward  = false; break;
            case 'KeyS': case 'ArrowDown':  this.controls.backward = false; break;
            case 'KeyA': case 'ArrowLeft':  this.controls.left     = false; break;
            case 'KeyD': case 'ArrowRight': this.controls.right    = false; break;
            case 'Space':                   this.controls.brake    = false; break;
        }
    }

    // ─── network sync (called by Player when a remote player drives this car) ──

    setNetworkState(posObj, quatObj) {
        const px = posObj.position_x;
        const py = posObj.position_y;
        const pz = posObj.position_z;

        // Estimate velocity from the position delta so the body carries momentum
        // into collisions (otherwise a remote car would just depenetrate others).
        const now =
            typeof performance !== "undefined" ? performance.now() : Date.now();
        if (this._hasNet && this._netStamp != null) {
            const dt = (now - this._netStamp) / 1000;
            if (dt > 0.0001) {
                this._netVel.set(
                    (px - this._netPos.x) / dt,
                    (py - this._netPos.y) / dt,
                    (pz - this._netPos.z) / dt,
                );
            }
        }
        this._netStamp = now;

        this._netPos.set(px, py, pz);
        this._netQuat.set(
            quatObj.quaternion_x, quatObj.quaternion_y,
            quatObj.quaternion_z, quatObj.quaternion_w,
        );
        this._hasNet = true;
    }

    // ─── per-frame: pre-step (before VehicleFleet steps the world) ─────────────

    // Local + idle cars: feed the raycast vehicle. Local reads the player's
    // controls; idle applies none (rests on suspension). Must run before step().
    applyControls(dt) {
        const p = this.params;
        let engineForce = 0;
        let steering = 0;

        if (this.mode === 'local') {
            if (this.controls.forward)  engineForce += p.maxForce;
            if (this.controls.backward) engineForce -= p.maxForce;
            if (this.controls.left)     steering    += p.maxSteer;
            if (this.controls.right)    steering    -= p.maxSteer;
        }

        const brakeForce = (this.mode === 'local' && this.controls.brake) ? p.maxBrake : 0;

        for (let i = 0; i < this.rapierVehicle.wheels.length; i++) {
            this.rapierVehicle.setBrakeValue(brakeForce, i);
        }
        this.rapierVehicle.setSteeringValue(steering, 0);
        this.rapierVehicle.setSteeringValue(steering, 1);
        this.rapierVehicle.applyEngineForce(engineForce, 2);
        this.rapierVehicle.applyEngineForce(engineForce, 3);

        this.rapierVehicle.update(dt);
    }

    // Remote cars: snap the body + visuals to the broadcast transform. Runs
    // before step() so the local player's car collides against it.
    applyNetworkSync() {
        if (!this._hasNet) return;
        const pos = this._netPos;
        const quat = this._netQuat;

        this.chassisGroup.position.copy(pos);
        this.chassisGroup.quaternion.copy(quat);

        for (let i = 0; i < this.wheelMeshes.length; i++) {
            _syncWheelOff.copy(WHEEL_LOCAL_OFFSETS[i]).applyQuaternion(quat).add(pos);
            this.wheelMeshes[i].position.copy(_syncWheelOff);
            this.wheelMeshes[i].quaternion.copy(quat);
        }

        // Clamp the estimated velocity so a network hiccup can't fling the body.
        const MAX_V = 60;
        let vx = this._netVel.x;
        let vy = this._netVel.y;
        let vz = this._netVel.z;
        const sp = Math.hypot(vx, vy, vz);
        if (sp > MAX_V) {
            const s = MAX_V / sp;
            vx *= s; vy *= s; vz *= s;
        }

        this.chassisBody.setTranslation({ x: pos.x,  y: pos.y,  z: pos.z  }, true);
        this.chassisBody.setRotation   ({ x: quat.x, y: quat.y, z: quat.z, w: quat.w }, true);
        this.chassisBody.setLinvel     ({ x: vx, y: vy, z: vz }, true);
        this.chassisBody.setAngvel     ({ x: 0, y: 0, z: 0 }, true);
    }

    // ─── per-frame: post-step (after VehicleFleet steps the world) ─────────────

    // Local + idle cars read their simulated transform into the visuals (remote
    // cars were already positioned in applyNetworkSync). Local also drives the
    // chase camera.
    syncVisuals(dt) {
        if (this.mode === 'remote') return;

        const t = this.chassisBody.translation();
        const r = this.chassisBody.rotation();
        this.chassisGroup.position.set(t.x, t.y, t.z);
        this.chassisGroup.quaternion.set(r.x, r.y, r.z, r.w);

        for (let i = 0; i < this.rapierVehicle.wheels.length; i++) {
            const ws = this.rapierVehicle.wheels[i].state;
            this.wheelMeshes[i].position.copy(ws.worldTransform.position);
            this.wheelMeshes[i].quaternion.copy(ws.worldTransform.quaternion);
        }

        if (this.mode === 'local') {
            _chassisPos.set(t.x, t.y, t.z);
            _chassisRot.set(r.x, r.y, r.z, r.w);

            const smoothing = 1.0 - Math.pow(0.01, dt);

            _idealOffset.set(-10, 3, 0);
            _idealOffset.applyQuaternion(_chassisRot);
            _idealOffset.add(_chassisPos);
            if (_idealOffset.y < 0.5) _idealOffset.y = 0.5;

            _idealLookAt.set(0, 1, 0);
            _idealLookAt.applyQuaternion(_chassisRot);
            _idealLookAt.add(_chassisPos);

            this.cameraPosition.lerp(_idealOffset, smoothing);
            this.cameraLookAt.lerp(_idealLookAt, smoothing);
        }
    }

    // ─── player collision ────────────────────────────────────────────────────
    // The Rapier collider is invisible to the player's Three.js Octree, so we
    // do an OBB check manually each frame and push the player's capsule out.

    resolvePlayerCollision(capsule) {
        if (!this.chassisBody) return;

        const t = this.chassisBody.translation();
        const r = this.chassisBody.rotation();

        const carPos    = _carCollPos.set(t.x, t.y, t.z);
        const carQuat   = _carCollQuat.set(r.x, r.y, r.z, r.w);
        const carQuatInv = _carCollQuatInv.copy(carQuat).conjugate();

        const RADIUS = capsule.radius;
        const hx = 2.35 + RADIUS;
        const hy = 0.55 + RADIUS;
        const hz = 1.0  + RADIUS;

        for (const pt of [capsule.start, capsule.end]) {
            _carLocal.copy(pt).sub(carPos).applyQuaternion(carQuatInv);

            const px = hx - Math.abs(_carLocal.x);
            const py = hy - Math.abs(_carLocal.y);
            const pz = hz - Math.abs(_carLocal.z);

            if (px > 0 && py > 0 && pz > 0) {
                _carPush.set(0, 0, 0);
                if (px <= py && px <= pz) {
                    _carPush.x = px * Math.sign(_carLocal.x);
                } else if (pz <= px && pz <= py) {
                    _carPush.z = pz * Math.sign(_carLocal.z);
                } else {
                    _carPush.y = py * Math.sign(_carLocal.y);
                }

                _carPush.applyQuaternion(carQuat);
                capsule.start.add(_carPush);
                capsule.end.add(_carPush);
                break;
            }
        }
    }

    // ─── helpers ─────────────────────────────────────────────────────────────

    getPosition() {
        const t = this.chassisBody.translation();
        return new THREE.Vector3(t.x, t.y, t.z);
    }

    resetPosition(pos) {
        this.chassisBody.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
}
