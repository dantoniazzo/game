import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import RAPIER from '@dimforge/rapier3d-compat';
import { RapierRaycastVehicle } from './RapierRaycastVehicle.js';

// ─── constants ───────────────────────────────────────────────────────────────

const WHEEL_RADIUS = 0.38;
const VEHICLE_WIDTH = 1.7;
const VEHICLE_HEIGHT = -0.3;
const VEHICLE_FRONT = -1.35; // local X — the "back" in physics forward (+X) terms
const VEHICLE_BACK = 1.3;   // local X — the "front" in physics forward (+X) terms

const MAX_FORCE = 30;
const MAX_STEER = 0.5;   // radians (~28°)
const MAX_BRAKE = 2;

// Camera smoothing
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

        this.active = false; // true while player is driving

        // Camera state (updated each frame when active, read by Camera.js)
        this.cameraPosition = new THREE.Vector3(5, 5, -15);
        this.cameraLookAt = new THREE.Vector3();

        this._boundKeyDown = this._onKeyDown.bind(this);
        this._boundKeyUp = this._onKeyUp.bind(this);

        this._createPhysics(spawnPosition || new THREE.Vector3(5, 2, 5));
        this._createVisuals(chassisGLTF, wheelGLTF);
        this._createPromptUI();
    }

    // ─── physics setup ───────────────────────────────────────────────────────

    _createPhysics(spawnPosition) {
        // Chassis rigid body — spawned rotated -90° around Y so the model
        // faces down the world -Z axis initially (matching the sketch's
        // rotation={[0, -Math.PI/2, 0]} on the Vehicle RigidBody).
        const spawnQuat = new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            -Math.PI / 2,
        );

        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(spawnPosition.x, spawnPosition.y, spawnPosition.z)
            .setRotation({ x: spawnQuat.x, y: spawnQuat.y, z: spawnQuat.z, w: spawnQuat.w });

        this.chassisBody = this.rapierWorld.createRigidBody(bodyDesc);

        // Cuboid collider with mass 150 kg
        const colliderDesc = RAPIER.ColliderDesc.cuboid(2.35, 0.55, 1).setMass(150);
        this.rapierWorld.createCollider(colliderDesc, this.chassisBody);

        // Raycast vehicle controller
        this.rapierVehicle = new RapierRaycastVehicle({
            world: this.rapierWorld,
            chassisRigidBody: this.chassisBody,
            indexRightAxis: 2,
            indexForwardAxis: 0,
            indexUpAxis: 1,
        });

        const commonWheelOptions = {
            radius: WHEEL_RADIUS,
            directionLocal: new THREE.Vector3(0, -1, 0),
            axleLocal: new THREE.Vector3(0, 0, 1),
            suspensionStiffness: 30,
            suspensionRestLength: 0.3,
            maxSuspensionForce: 100000,
            maxSuspensionTravel: 0.3,
            sideFrictionStiffness: 1,
            frictionSlip: 1.4,
            dampingRelaxation: 2.3,
            dampingCompression: 4.4,
            rollInfluence: 0.01,
            customSlidingRotationalSpeed: -30,
            useCustomSlidingRotationalSpeed: true,
            forwardAcceleration: 1,
            sideAcceleration: 1,
        };

        // Wheel order matches the sketch:
        // 0 = topLeft    (VEHICLE_BACK,  VEHICLE_HEIGHT, +halfWidth)  → steering
        // 1 = topRight   (VEHICLE_BACK,  VEHICLE_HEIGHT, -halfWidth)  → steering
        // 2 = bottomLeft (VEHICLE_FRONT, VEHICLE_HEIGHT, +halfWidth)  → engine
        // 3 = bottomRight(VEHICLE_FRONT, VEHICLE_HEIGHT, -halfWidth)  → engine
        const wheelConfigs = [
            new THREE.Vector3(VEHICLE_BACK,  VEHICLE_HEIGHT,  VEHICLE_WIDTH * 0.5),
            new THREE.Vector3(VEHICLE_BACK,  VEHICLE_HEIGHT, -VEHICLE_WIDTH * 0.5),
            new THREE.Vector3(VEHICLE_FRONT, VEHICLE_HEIGHT,  VEHICLE_WIDTH * 0.5),
            new THREE.Vector3(VEHICLE_FRONT, VEHICLE_HEIGHT, -VEHICLE_WIDTH * 0.5),
        ];

        for (const pos of wheelConfigs) {
            this.rapierVehicle.addWheel({ ...commonWheelOptions, chassisConnectionPointLocal: pos });
        }
    }

    // ─── visual setup ────────────────────────────────────────────────────────

    _createVisuals(chassisGLTF, wheelGLTF) {
        // ── Chassis ──────────────────────────────────────────────────────────
        // The GLB is modelled facing -Z. The physics forward axis is +X.
        // Inner group is rotated PI/2 around Y (same as sketch inner chassis),
        // then offset to centre it.
        this.chassisGroup = new THREE.Group();
        const chassisScene = SkeletonUtils.clone(chassisGLTF.scene);
        chassisScene.position.set(-0.2, -0.25, 0);
        chassisScene.rotation.y = Math.PI / 2;
        this.chassisGroup.add(chassisScene);
        this.scene.add(this.chassisGroup);

        // ── Wheels ───────────────────────────────────────────────────────────
        // Wheels 0 & 2 are left-side (mirrored), 1 & 3 are right-side.
        this.wheelMeshes = [];
        const sides = ['left', 'right', 'left', 'right'];

        for (let i = 0; i < 4; i++) {
            const wheelGroup = new THREE.Group();
            const wheelScene = SkeletonUtils.clone(wheelGLTF.scene);
            const scale = WHEEL_RADIUS / 0.34; // model's native radius is 0.34
            const mirrorX = sides[i] === 'left' ? -1 : 1;
            wheelScene.scale.set(scale * mirrorX, scale, scale);
            wheelScene.rotation.y = Math.PI / 2; // align with chassis orientation
            wheelGroup.add(wheelScene);
            this.scene.add(wheelGroup);
            this.wheelMeshes.push(wheelGroup);
        }
    }

    // ─── UI prompt ───────────────────────────────────────────────────────────

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
    }

    disableControls() {
        document.removeEventListener('keydown', this._boundKeyDown);
        document.removeEventListener('keyup', this._boundKeyUp);
        // reset all inputs
        for (const key of Object.keys(this.controls)) this.controls[key] = false;
        this.active = false;
        this.showExitPrompt(false);
    }

    _onKeyDown(e) {
        // Don't consume if typing in chat
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
        // Clamp delta so physics doesn't explode on tab-switch spikes
        const dt = Math.min(delta, 0.05);

        // Apply controls (only when player is driving)
        let engineForce = 0;
        let steering = 0;

        if (this.active) {
            if (this.controls.forward)  engineForce += MAX_FORCE;
            if (this.controls.backward) engineForce -= MAX_FORCE;
            if (this.controls.left)     steering    += MAX_STEER;
            if (this.controls.right)    steering    -= MAX_STEER;
        }

        const brakeForce = (this.active && this.controls.brake) ? MAX_BRAKE : 0;

        for (let i = 0; i < this.rapierVehicle.wheels.length; i++) {
            this.rapierVehicle.setBrakeValue(brakeForce, i);
        }

        // Steer wheels 0 & 1 (front-facing in the sketch)
        this.rapierVehicle.setSteeringValue(steering, 0);
        this.rapierVehicle.setSteeringValue(steering, 1);

        // Engine on wheels 2 & 3 (rear-facing in the sketch)
        this.rapierVehicle.applyEngineForce(engineForce, 2);
        this.rapierVehicle.applyEngineForce(engineForce, 3);

        // Step physics
        this.rapierWorld.timestep = dt;
        this.rapierVehicle.update(dt);
        this.rapierWorld.step();

        // ── Sync visuals ─────────────────────────────────────────────────────

        const t = this.chassisBody.translation();
        const r = this.chassisBody.rotation();
        this.chassisGroup.position.set(t.x, t.y, t.z);
        this.chassisGroup.quaternion.set(r.x, r.y, r.z, r.w);

        for (let i = 0; i < this.rapierVehicle.wheels.length; i++) {
            const ws = this.rapierVehicle.wheels[i].state;
            this.wheelMeshes[i].position.copy(ws.worldTransform.position);
            this.wheelMeshes[i].quaternion.copy(ws.worldTransform.quaternion);
        }

        // ── Camera target (read by Camera.js) ────────────────────────────────

        if (this.active) {
            _chassisPos.set(t.x, t.y, t.z);
            _chassisRot.set(r.x, r.y, r.z, r.w);

            const smoothing = 1.0 - Math.pow(0.01, dt);

            // Offset behind + above the car (in local chassis space)
            _idealOffset.set(-10, 3, 0);
            _idealOffset.applyQuaternion(_chassisRot);
            _idealOffset.add(_chassisPos);
            if (_idealOffset.y < 0.5) _idealOffset.y = 0.5;

            // Look-at point slightly above car centre
            _idealLookAt.set(0, 1, 0);
            _idealLookAt.applyQuaternion(_chassisRot);
            _idealLookAt.add(_chassisPos);

            this.cameraPosition.lerp(_idealOffset, smoothing);
            this.cameraLookAt.lerp(_idealLookAt, smoothing);
        }
    }

    // ─── helpers ─────────────────────────────────────────────────────────────

    /** World position of the chassis centre */
    getPosition() {
        const t = this.chassisBody.translation();
        return new THREE.Vector3(t.x, t.y, t.z);
    }

    /** Teleport the car to a position (use when re-entering after a fall, etc.) */
    resetPosition(pos) {
        this.chassisBody.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
        this.chassisBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.chassisBody.setAngvel({ x: 0, y: 0, z: 0 }, true);
    }
}
