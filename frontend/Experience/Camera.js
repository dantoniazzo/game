import * as THREE from "three";
import Experience from "./Experience.js";
import { OrbitControls } from "../Experience/Utils/CustomOrbitControls.js";

// Scratch vectors for the over-the-shoulder aim camera.
const _F = new THREE.Vector3();
const _up = new THREE.Vector3();
const _right = new THREE.Vector3();
const _pivot = new THREE.Vector3();

export default class Camera {
    constructor() {
        this.experience = new Experience();
        this.sizes = this.experience.sizes;
        this.scene = this.experience.scene;
        this.canvas = this.experience.canvas;
        this.params = {
            fov: 75,
            aspect: this.sizes.aspect,
            near: 0.001,
            far: 1000,
        };
        this.controls = null;

        this.isMobile =
            /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
                navigator.userAgent
            ) ||
            ("ontouchstart" in window && navigator.maxTouchPoints > 0);

        this.setPerspectiveCamera();

        if (this.isMobile) {
            this.setOrbitControls();
        } else {
            this.setPointerLockCamera();
        }
    }

    setPerspectiveCamera() {
        this.perspectiveCamera = new THREE.PerspectiveCamera(
            this.params.fov,
            this.params.aspect,
            this.params.near,
            this.params.far
        );

        this.perspectiveCamera.position.set(0, 3, 6);

        this.scene.add(this.perspectiveCamera);
    }

    setOrbitControls() {
        this.controls = new OrbitControls(this.perspectiveCamera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.enablePan = false;
        this.controls.maxDistance = 6;
        this.controls.dampingFactor = 0.1;
    }

    setPointerLockCamera() {
        // Spherical coordinate angles for third-person camera
        this.angles = { horizontal: 0, vertical: 0.15 };
        this.pointerLockEnabled = false;
        this.target = new THREE.Vector3();

        this.DISTANCE = 6;
        this.LOOK_AT_HEIGHT = 0.9;
        this.MOUSE_SENSITIVITY = 0.002;
        this.MIN_VERTICAL = 0.1;
        this.MAX_VERTICAL = 0.51;

        // Over-the-shoulder aim mode (held right mouse button)
        this.aimMode = false;
        this._savedVertical = this.angles.vertical;
        this.AIM_DISTANCE = 2.0; // camera distance behind the player
        this.AIM_SIDE = 0.7; // shift right so the player sits on the left
        this.AIM_UP = 0.25; // raise the pivot toward the head
        this.AIM_MIN_VERTICAL = -1.2; // look well up (rooftops) …
        this.AIM_MAX_VERTICAL = 1.2; // … and down

        this._cameraPos = new THREE.Vector3();
        this._lookAt = new THREE.Vector3();

        this.mouseMovement = { x: 0, y: 0 };
        this.moveTimeout = null;

        // Request pointer lock on click (gated until game starts)
        const onClick = () => {
            if (this.pointerLockEnabled) this.canvas.requestPointerLock();
        };
        this.canvas.addEventListener("click", onClick);

        // Track mouse movement while pointer is locked
        document.addEventListener("mousemove", (e) => {
            if (document.pointerLockElement) {
                this.mouseMovement.x = e.movementX;
                this.mouseMovement.y = e.movementY;

                if (this.moveTimeout) clearTimeout(this.moveTimeout);
                this.moveTimeout = setTimeout(() => {
                    this.mouseMovement.x = 0;
                    this.mouseMovement.y = 0;
                }, 50);
            }
        });

        this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    }

    setAimMode(on) {
        if (!this.angles) return; // desktop pointer-lock only
        if (on === this.aimMode) return;
        this.aimMode = on;
        if (on) {
            this._savedVertical = this.angles.vertical;
            this.angles.vertical = 0; // start level
        } else {
            this.angles.vertical = THREE.MathUtils.clamp(
                this._savedVertical,
                this.MIN_VERTICAL,
                this.MAX_VERTICAL
            );
        }
    }

    enableOrbitControls() {
        if (this.controls) this.controls.enabled = true;
    }

    disableOrbitControls() {
        if (this.controls) this.controls.enabled = false;
    }

    onResize() {
        this.perspectiveCamera.aspect = this.sizes.aspect;
        this.perspectiveCamera.updateProjectionMatrix();
    }

    // ─── vehicle camera ──────────────────────────────────────────────────────

    enterVehicleMode(vehicle) {
        this.vehicleMode = true;
        this.vehicle = vehicle;

        // Release pointer lock so the mouse is free while driving
        if (document.pointerLockElement) document.exitPointerLock();
        // Disable OrbitControls on mobile while driving
        if (this.controls) this.controls.enabled = false;
    }

    exitVehicleMode() {
        this.vehicleMode = false;
        this.vehicle = null;

        // Re-enable pointer lock for desktop player camera
        if (!this.isMobile) this.pointerLockEnabled = true;
        // Re-enable OrbitControls on mobile
        if (this.controls) this.controls.enabled = true;
    }

    // ─── main update ─────────────────────────────────────────────────────────

    update() {
        if (this.frozen) return;

        if (this.vehicleMode && this.vehicle) {
            // Vehicle.js updates cameraPosition / cameraLookAt each frame;
            // we just copy them to the Three.js camera here.
            this.perspectiveCamera.position.copy(this.vehicle.cameraPosition);
            this.perspectiveCamera.lookAt(this.vehicle.cameraLookAt);
            return;
        }

        if (this.isMobile) {
            if (this.controls && this.controls.enabled) {
                this.controls.update();
            }
        } else {
            this.updatePointerLockCamera();
        }
    }

    updatePointerLockCamera() {
        if (this.mouseMovement.x !== 0 || this.mouseMovement.y !== 0) {
            const minV = this.aimMode ? this.AIM_MIN_VERTICAL : this.MIN_VERTICAL;
            const maxV = this.aimMode ? this.AIM_MAX_VERTICAL : this.MAX_VERTICAL;
            this.angles.horizontal -=
                this.mouseMovement.x * this.MOUSE_SENSITIVITY;
            this.angles.vertical = THREE.MathUtils.clamp(
                this.angles.vertical +
                    this.mouseMovement.y * this.MOUSE_SENSITIVITY,
                minV,
                maxV
            );
        }

        const { x, y, z } = this.target;

        if (this.aimMode) {
            // Over-the-shoulder: camera close behind, shifted to its right so
            // the player sits on the left of the screen; aim direction (F)
            // carries pitch so you can fire up at rooftops.
            const theta = this.angles.horizontal;
            const pitch = -this.angles.vertical; // mouse up → aim up
            const cosP = Math.cos(pitch);
            _F.set(
                -Math.sin(theta) * cosP,
                Math.sin(pitch),
                -Math.cos(theta) * cosP
            ).normalize();
            _up.set(0, 1, 0);
            _right.crossVectors(_F, _up).normalize();
            _pivot.set(x, y + this.AIM_UP, z);

            this._cameraPos
                .copy(_pivot)
                .addScaledVector(_F, -this.AIM_DISTANCE)
                .addScaledVector(_right, this.AIM_SIDE);
            this.perspectiveCamera.position.copy(this._cameraPos);

            this._lookAt
                .copy(_pivot)
                .addScaledVector(_F, 8)
                .addScaledVector(_right, this.AIM_SIDE);
            this.perspectiveCamera.lookAt(this._lookAt);
            return;
        }

        const theta = this.angles.horizontal;
        const phi = this.angles.vertical;
        const centerY = y + this.LOOK_AT_HEIGHT;
        const cosPhi = Math.cos(phi);

        this._cameraPos.set(
            x + this.DISTANCE * Math.sin(theta) * cosPhi,
            centerY + this.DISTANCE * Math.sin(phi),
            z + this.DISTANCE * Math.cos(theta) * cosPhi
        );

        this.perspectiveCamera.position.copy(this._cameraPos);
        this.perspectiveCamera.lookAt(this._lookAt.set(x, centerY, z));
    }
}
