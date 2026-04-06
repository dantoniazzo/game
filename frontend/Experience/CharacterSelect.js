import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import Experience from "./Experience.js";

const SELECT_Y = 200;

const CHARACTERS = [
    { name: "brute", label: "Brute", x: -1.2 },
    { name: "monster", label: "Monster", x: 1.2 },
];

export default class CharacterSelect {
    constructor() {
        this.experience = new Experience();
        this.resources = this.experience.resources;
        this.socket = this.experience.socket;
        this.scene = this.experience.scene;
        this.camera = this.experience.camera;
        this.canvas = this.experience.canvas;

        this.objects = [];
        this.models = [];
        this.mixers = [];
        this.active = false;

        this.loadFont();
        this.show();
    }

    loadFont() {
        if (!document.querySelector('link[href*="MedievalSharp"]')) {
            const fontLink = document.createElement("link");
            fontLink.rel = "stylesheet";
            fontLink.href =
                "https://fonts.googleapis.com/css2?family=MedievalSharp&display=swap";
            document.head.appendChild(fontLink);
        }
    }

    createTextSprite(text, fontSize, color, fontFamily = "sans-serif") {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        canvas.width = 512;
        canvas.height = 128;

        ctx.font = `bold ${fontSize}px ${fontFamily}`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, 256, 64);

        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        const material = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            depthTest: false,
        });
        return new THREE.Sprite(material);
    }

    show() {
        // Save and override scene
        this.savedBackground = this.scene.background;
        this.savedFog = this.scene.fog;
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = null;

        // Freeze camera at remote selection area
        this.camera.frozen = true;
        this.camera.perspectiveCamera.position.set(0, SELECT_Y + 1.3, 4);
        this.camera.perspectiveCamera.lookAt(0, SELECT_Y + 0.7, 0);

        const medievalFont =
            "'MedievalSharp', 'Uncial Antiqua', 'Luminari', fantasy";

        // Black backdrop
        const backdropGeo = new THREE.PlaneGeometry(20, 12);
        const backdropMat = new THREE.MeshBasicMaterial({
            color: 0x000000,
            side: THREE.DoubleSide,
        });
        const backdrop = new THREE.Mesh(backdropGeo, backdropMat);
        backdrop.position.set(0, SELECT_Y + 1, -2);
        this.scene.add(backdrop);
        this.objects.push(backdrop);

        // Lighting
        const ambient = new THREE.AmbientLight(0xffffff, 1.5);
        ambient.position.y = SELECT_Y;
        this.scene.add(ambient);
        this.objects.push(ambient);

        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(2, SELECT_Y + 5, 3);
        this.scene.add(dirLight);
        this.objects.push(dirLight);

        const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
        backLight.position.set(-2, SELECT_Y + 2, -2);
        this.scene.add(backLight);
        this.objects.push(backLight);

        // Title
        const title = this.createTextSprite(
            "Select Character",
            44,
            "white",
            medievalFont
        );
        title.position.set(0, SELECT_Y + 2.8, 0);
        title.scale.set(4, 1, 1);
        this.scene.add(title);
        this.objects.push(title);

        // Characters
        for (const char of CHARACTERS) {
            const resource = this.resources.items[char.name];
            if (!resource) continue;

            const model = SkeletonUtils.clone(resource.scene);
            model.position.set(char.x, SELECT_Y, 0);
            model.rotation.y = 0;
            model.userData.characterName = char.name;

            model.traverse((child) => {
                child.userData.characterName = char.name;
            });

            this.scene.add(model);
            this.models.push(model);
            this.objects.push(model);

            // Idle animation
            const mixer = new THREE.AnimationMixer(model);
            const idleClip = resource.animations.find(
                (c) => c.name === "idle"
            );
            if (idleClip) {
                mixer.clipAction(idleClip.clone()).play();
            }
            this.mixers.push(mixer);

            // Label
            const label = this.createTextSprite(
                char.label,
                48,
                "#de3500",
                medievalFont
            );
            label.position.set(char.x, SELECT_Y - 0.3, 0);
            label.scale.set(2.5, 0.6, 1);
            this.scene.add(label);
            this.objects.push(label);
        }

        // Raycaster
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this._onClick = this.onClick.bind(this);
        this._onMove = this.onMove.bind(this);
        this.canvas.addEventListener("click", this._onClick);
        this.canvas.addEventListener("mousemove", this._onMove);

        this.active = true;
    }

    onMove(event) {
        if (!this.active) return;

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(
            this.mouse,
            this.camera.perspectiveCamera
        );
        const intersects = this.raycaster.intersectObjects(this.models, true);
        this.canvas.style.cursor =
            intersects.length > 0 ? "pointer" : "default";
    }

    onClick(event) {
        if (!this.active) return;

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(
            this.mouse,
            this.camera.perspectiveCamera
        );
        const intersects = this.raycaster.intersectObjects(this.models, true);

        if (intersects.length > 0) {
            const name = intersects[0].object.userData.characterName;
            if (name) this.select(name);
        }
    }

    select(skinName) {
        this.active = false;
        this.canvas.style.cursor = "default";
        this.canvas.removeEventListener("click", this._onClick);
        this.canvas.removeEventListener("mousemove", this._onMove);

        this.socket.emit("setAvatar", skinName);

        // Clean up
        for (const obj of this.objects) {
            this.scene.remove(obj);
            obj.traverse?.((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }
        this.objects = [];
        this.models = [];
        this.mixers = [];

        // Restore scene
        this.scene.background = this.savedBackground;
        this.scene.fog = this.savedFog;

        // Unfreeze camera and start game
        this.camera.frozen = false;
        this.camera.target.set(0, 0, 0);
        this.camera.angles.horizontal = 0;
        this.camera.angles.vertical = 0.15;
        this.camera.pointerLockEnabled = true;
    }

    update() {
        if (!this.active || this.mixers.length === 0) return;

        const delta = this.experience.time.delta;

        for (const mixer of this.mixers) {
            mixer.update(delta);
        }

        for (const model of this.models) {
            model.rotation.y += 0.3 * delta;
        }

        // Keep camera locked
        this.camera.perspectiveCamera.position.set(0, SELECT_Y + 1.3, 4);
        this.camera.perspectiveCamera.lookAt(0, SELECT_Y + 0.7, 0);
    }
}
