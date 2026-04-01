import * as THREE from "three";
import Experience from "./Experience.js";
import { OrbitControls } from "../Experience/Utils/CustomOrbitControls.js";

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

    update() {
        if (this.frozen) return;

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
            this.angles.horizontal -=
                this.mouseMovement.x * this.MOUSE_SENSITIVITY;
            this.angles.vertical = THREE.MathUtils.clamp(
                this.angles.vertical +
                    this.mouseMovement.y * this.MOUSE_SENSITIVITY,
                this.MIN_VERTICAL,
                this.MAX_VERTICAL
            );
        }

        const { horizontal: theta, vertical: phi } = this.angles;
        const { x, y, z } = this.target;
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
