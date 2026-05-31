import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import GUI from 'lil-gui';
import { RapierRaycastVehicle } from './RapierRaycastVehicle.js';

// Camera smoothing scratch objects
const _idealOffset = new THREE.Vector3();
const _idealLookAt = new THREE.Vector3();
const _chassisPos = new THREE.Vector3();
const _chassisRot = new THREE.Quaternion();

// ─── Vehicle ──────────────────────────────────────────────────────────────────

export default class Vehicle {
    constructor({ rapierWorld, scene, chassisGLTF, wheelGLTF, spawnPosition }) {
        this.rapierWorld = rapierWorld;
        this.scene = scene;

        this.controls = {
            forward: false,
            backward: false,
            left: false,
            right: false,
            brake: false,
        };

        this.active = false;

        // Camera state read by Camera.js each frame
        this.cameraPosition = new THREE.Vector3(5, 5, -15);
        this.cameraLookAt = new THREE.Vector3();

        this._boundKeyDown = this._onKeyDown.bind(this);
        this._boundKeyUp = this._onKeyUp.bind(this);

        // ── Tunable params (mirroring the Leva controls in the sketch) ─────────
        // All wheel options are stored here so the GUI can mutate them live;
        // RapierRaycastVehicle reads wheel.options every frame, so changes take
        // effect immediately without recreating anything.
        this.params = {
            // Controls
            maxForce: 200,
            maxSteer: 0.5,
            maxBrake: 10,

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
            forwardAcceleration: 1,
            sideAcceleration: 1,

            // Sliding spin
            customSlidingRotationalSpeed: -30,
            useCustomSlidingRotationalSpeed: true,
        };

        this._createPhysics(spawnPosition || new THREE.Vector3(5, 2, 5));
        this._createVisuals(chassisGLTF, wheelGLTF);
        this._createPromptUI();
        this._createGUI();
    }

    // ─── physics setup ───────────────────────────────────────────────────────

    _createPhysics(spawnPosition) {
        const spawnQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -Math.PI / 2,
        );

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
            .setRotation({ x: spawnQuat.x, y: spawnQuat.y, z: spawnQuat.z, w: spawnQuat.w });

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

    // ─── lil-gui panel ───────────────────────────────────────────────────────

    _createGUI() {
        this.gui = new GUI({ title: 'Vehicle', width: 280 });
        // Start hidden — shown/hidden based on vehicle proximity / active state
        this.gui.hide();

        const p = this.params;

        // Propagate a named set of wheel option keys to all 4 wheels live
        const syncWheels = (...keys) => {
            for (const wheel of this.rapierVehicle.wheels) {
                for (const key of keys) {
                    wheel.options[key] = p[key];
                }
            }
        };

        // ── Controls ────────────────────────────────────────────────────────
        const controlsFolder = this.gui.addFolder('Controls');
        controlsFolder.add(p, 'maxForce', 0, 1000, 1).name('Max Force');
        controlsFolder.add(p, 'maxSteer', 0.1, 1.5, 0.01).name('Max Steer (rad)');
        controlsFolder.add(p, 'maxBrake', 0, 50, 0.5).name('Max Brake');

        // ── Suspension ──────────────────────────────────────────────────────
        const suspFolder = this.gui.addFolder('Suspension');
        suspFolder.add(p, 'suspensionStiffness', 1, 200, 1).name('Stiffness')
            .onChange(() => syncWheels('suspensionStiffness'));
        suspFolder.add(p, 'suspensionRestLength', 0.05, 1, 0.01).name('Rest Length')
            .onChange(() => syncWheels('suspensionRestLength'));
        suspFolder.add(p, 'maxSuspensionTravel', 0.05, 1, 0.01).name('Max Travel')
            .onChange(() => syncWheels('maxSuspensionTravel'));
        suspFolder.add(p, 'maxSuspensionForce', 1000, 500000, 1000).name('Max Force')
            .onChange(() => syncWheels('maxSuspensionForce'));
        suspFolder.add(p, 'dampingRelaxation', 0, 10, 0.1).name('Damping Relax')
            .onChange(() => syncWheels('dampingRelaxation'));
        suspFolder.add(p, 'dampingCompression', 0, 10, 0.1).name('Damping Compress')
            .onChange(() => syncWheels('dampingCompression'));
        suspFolder.close();

        // ── Friction / Handling ─────────────────────────────────────────────
        const frictionFolder = this.gui.addFolder('Friction / Handling');
        frictionFolder.add(p, 'frictionSlip', 0, 5, 0.05).name('Friction Slip')
            .onChange(() => syncWheels('frictionSlip'));
        frictionFolder.add(p, 'sideFrictionStiffness', 0, 5, 0.05).name('Side Friction')
            .onChange(() => syncWheels('sideFrictionStiffness'));
        frictionFolder.add(p, 'rollInfluence', 0, 1, 0.01).name('Roll Influence')
            .onChange(() => syncWheels('rollInfluence'));
        frictionFolder.add(p, 'forwardAcceleration', 0.1, 5, 0.1).name('Fwd Acceleration')
            .onChange(() => syncWheels('forwardAcceleration'));
        frictionFolder.add(p, 'sideAcceleration', 0.1, 5, 0.1).name('Side Acceleration')
            .onChange(() => syncWheels('sideAcceleration'));
        frictionFolder.close();

        // ── Sliding ─────────────────────────────────────────────────────────
        const slidingFolder = this.gui.addFolder('Sliding');
        slidingFolder.add(p, 'useCustomSlidingRotationalSpeed').name('Custom Slide Spin')
            .onChange(() => syncWheels('useCustomSlidingRotationalSpeed'));
        slidingFolder.add(p, 'customSlidingRotationalSpeed', -100, 0, 1).name('Slide Spin Speed')
            .onChange(() => syncWheels('customSlidingRotationalSpeed'));
        slidingFolder.close();
    }

    // ─── UI prompts ──────────────────────────────────────────────────────────

    _createPromptUI() {
        this.promptEl = document.createElement('div');
        this.promptEl.textContent = 'Press F to enter vehicle';
        Object.assign(this.promptEl.style, {
            position: 'fixed',
            bottom: '30%',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'white',
            fontSize: '16px',
            fontFamily: 'sans-serif',
            backgroundColor: 'rgba(0,0,0,0.55)',
            padding: '8px 20px',
            borderRadius: '6px',
            display: 'none',
            pointerEvents: 'none',
            zIndex: '100',
        });
        document.body.appendChild(this.promptEl);

        this.exitPromptEl = document.createElement('div');
        this.exitPromptEl.textContent = 'Press F to exit vehicle';
        Object.assign(this.exitPromptEl.style, {
            position: 'fixed',
            top: '12%',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'white',
            fontSize: '14px',
            fontFamily: 'sans-serif',
            backgroundColor: 'rgba(0,0,0,0.55)',
            padding: '6px 16px',
            borderRadius: '6px',
            display: 'none',
            pointerEvents: 'none',
            zIndex: '100',
        });
        document.body.appendChild(this.exitPromptEl);
    }

    showEnterPrompt(visible) {
        this.promptEl.style.display = visible ? 'block' : 'none';
        // Show the tuning panel whenever the player is close enough to interact
        if (visible) this.gui.show(); else if (!this.active) this.gui.hide();
    }

    showExitPrompt(visible) {
        this.exitPromptEl.style.display = visible ? 'block' : 'none';
    }

    // ─── controls ────────────────────────────────────────────────────────────

    enableControls() {
        document.addEventListener('keydown', this._boundKeyDown);
        document.addEventListener('keyup', this._boundKeyUp);
        this.active = true;
        this.showExitPrompt(true);
        this.gui.show();
    }

    disableControls() {
        document.removeEventListener('keydown', this._boundKeyDown);
        document.removeEventListener('keyup', this._boundKeyUp);
        for (const key of Object.keys(this.controls)) this.controls[key] = false;
        this.active = false;
        this.showExitPrompt(false);
        this.gui.hide();
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

    // ─── per-frame update ────────────────────────────────────────────────────

    update(delta) {
        const dt = Math.min(delta, 0.05);
        const p = this.params;

        let engineForce = 0;
        let steering = 0;

        if (this.active) {
            if (this.controls.forward)  engineForce += p.maxForce;
            if (this.controls.backward) engineForce -= p.maxForce;
            if (this.controls.left)     steering    += p.maxSteer;
            if (this.controls.right)    steering    -= p.maxSteer;
        }

        const brakeForce = (this.active && this.controls.brake) ? p.maxBrake : 0;

        for (let i = 0; i < this.rapierVehicle.wheels.length; i++) {
            this.rapierVehicle.setBrakeValue(brakeForce, i);
        }

        this.rapierVehicle.setSteeringValue(steering, 0);
        this.rapierVehicle.setSteeringValue(steering, 1);
        this.rapierVehicle.applyEngineForce(engineForce, 2);
        this.rapierVehicle.applyEngineForce(engineForce, 3);

        this.rapierWorld.timestep = dt;
        this.rapierVehicle.update(dt);
        this.rapierWorld.step();

        // Sync visuals
        const t = this.chassisBody.translation();
        const r = this.chassisBody.rotation();
        this.chassisGroup.position.set(t.x, t.y, t.z);
        this.chassisGroup.quaternion.set(r.x, r.y, r.z, r.w);

        for (let i = 0; i < this.rapierVehicle.wheels.length; i++) {
            const ws = this.rapierVehicle.wheels[i].state;
            this.wheelMeshes[i].position.copy(ws.worldTransform.position);
            this.wheelMeshes[i].quaternion.copy(ws.worldTransform.quaternion);
        }

        // Camera
        if (this.active) {
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
