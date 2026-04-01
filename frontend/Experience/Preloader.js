import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import Experience from "./Experience.js";

// Remote Y position far above the world for the selection scene
const SELECT_Y = 200;

export default class Preloader {
    constructor() {
        this.experience = new Experience();
        this.resources = this.experience.resources;
        this.socket = this.experience.socket;
        this.scene = this.experience.scene;
        this.camera = this.experience.camera;
        this.canvas = this.experience.canvas;

        this.selectObjects = [];
        this.selectMixers = [];
        this.selectModels = [];
        this.playerName = "";
        this.selectActive = false;

        this.createOverlay();

        this.resources.on("ready", () => {
            this.onResourcesReady();
        });
    }

    createOverlay() {
        // HTML overlay only for loading + name input
        this.overlay = document.createElement("div");
        Object.assign(this.overlay.style, {
            position: "fixed",
            inset: "0",
            zIndex: "200",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "black",
            transition: "opacity 1s ease",
            opacity: "1",
        });

        // Diamond loader
        this.loader = document.createElement("span");
        this.loader.className = "diamond-loader";
        this.overlay.appendChild(this.loader);

        // Name input container
        this.nameContainer = document.createElement("div");
        Object.assign(this.nameContainer.style, {
            display: "none",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
        });

        this.nameInput = document.createElement("input");
        this.nameInput.type = "text";
        this.nameInput.placeholder = "Enter your name";
        this.nameInput.maxLength = 25;
        Object.assign(this.nameInput.style, {
            width: "320px",
            padding: "14px 20px",
            fontSize: "18px",
            fontFamily: "sans-serif",
            color: "white",
            backgroundColor: "transparent",
            border: "2px solid #de3500",
            borderRadius: "8px",
            outline: "none",
            textAlign: "center",
        });

        this.nameInput.addEventListener("focus", () => {
            this.nameInput.style.borderColor = "#ff5722";
            this.nameInput.style.boxShadow = "0 0 12px rgba(222, 53, 0, 0.4)";
        });
        this.nameInput.addEventListener("blur", () => {
            this.nameInput.style.borderColor = "#de3500";
            this.nameInput.style.boxShadow = "none";
        });
        this.nameInput.addEventListener("keydown", (e) => {
            if (e.code === "Enter") this.onNameSubmit();
        });

        this.nameContainer.appendChild(this.nameInput);
        this.overlay.appendChild(this.nameContainer);

        // Load medieval font
        const fontLink = document.createElement("link");
        fontLink.rel = "stylesheet";
        fontLink.href =
            "https://fonts.googleapis.com/css2?family=MedievalSharp&display=swap";
        document.head.appendChild(fontLink);

        // CSS
        const style = document.createElement("style");
        style.textContent = `
            .diamond-loader {
                position: relative;
                width: 64px;
                height: 64px;
                background-color: rgba(0, 0, 0, 0.5);
                transform: rotate(45deg);
                overflow: hidden;
            }
            .diamond-loader::after {
                content: "";
                position: absolute;
                inset: 8px;
                margin: auto;
                background: #222b32;
            }
            .diamond-loader::before {
                content: "";
                position: absolute;
                inset: -15px;
                margin: auto;
                background: #de3500;
                animation: diamondLoader 2s linear infinite;
            }
            @keyframes diamondLoader {
                0%, 10% { transform: translate(-64px, -64px) rotate(-45deg); }
                90%, 100% { transform: translate(0px, 0px) rotate(-45deg); }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(this.overlay);
    }

    onResourcesReady() {
        this.loader.style.display = "none";
        this.nameContainer.style.display = "flex";
        this.nameInput.focus();
    }

    onNameSubmit() {
        const name = this.nameInput.value.trim();
        if (!name) return;

        this.playerName = name;
        this.socket.emit("setName", name);

        // Remove HTML overlay entirely
        this.overlay.remove();

        this.showCharacterSelect();
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

    showCharacterSelect() {
        // Save and override scene background
        this.savedBackground = this.scene.background;
        this.savedFog = this.scene.fog;
        this.scene.background = new THREE.Color(0x000000);
        this.scene.fog = null;

        // Freeze the camera — position it manually at the remote selection area
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
        this.selectObjects.push(backdrop);

        // Selection lighting
        const ambient = new THREE.AmbientLight(0xffffff, 1.5);
        ambient.position.y = SELECT_Y;
        this.scene.add(ambient);
        this.selectObjects.push(ambient);

        const dirLight = new THREE.DirectionalLight(0xffffff, 2);
        dirLight.position.set(2, SELECT_Y + 5, 3);
        this.scene.add(dirLight);
        this.selectObjects.push(dirLight);

        const backLight = new THREE.DirectionalLight(0xffffff, 0.5);
        backLight.position.set(-2, SELECT_Y + 2, -2);
        this.scene.add(backLight);
        this.selectObjects.push(backLight);

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
        this.selectObjects.push(title);

        // Characters
        const characters = [
            { name: "brute", label: "Brute", x: -1.2 },
            { name: "monster", label: "Monster", x: 1.2 },
        ];

        for (const char of characters) {
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
            this.selectModels.push(model);
            this.selectObjects.push(model);

            // Idle animation
            const mixer = new THREE.AnimationMixer(model);
            const idleClip = resource.animations.find(
                (c) => c.name === "idle"
            );
            if (idleClip) {
                mixer.clipAction(idleClip.clone()).play();
            }
            this.selectMixers.push(mixer);

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
            this.selectObjects.push(label);
        }

        // Raycaster click/hover
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this._onCanvasClick = this.onCanvasClick.bind(this);
        this._onCanvasMove = this.onCanvasMove.bind(this);
        this.canvas.addEventListener("click", this._onCanvasClick);
        this.canvas.addEventListener("mousemove", this._onCanvasMove);

        this.selectActive = true;
    }

    onCanvasMove(event) {
        if (!this.selectActive) return;

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(
            this.mouse,
            this.camera.perspectiveCamera
        );
        const intersects = this.raycaster.intersectObjects(
            this.selectModels,
            true
        );
        this.canvas.style.cursor =
            intersects.length > 0 ? "pointer" : "default";
    }

    onCanvasClick(event) {
        if (!this.selectActive) return;

        const rect = this.canvas.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(
            this.mouse,
            this.camera.perspectiveCamera
        );
        const intersects = this.raycaster.intersectObjects(
            this.selectModels,
            true
        );

        if (intersects.length > 0) {
            const name = intersects[0].object.userData.characterName;
            if (name) this.onCharacterSelect(name);
        }
    }

    onCharacterSelect(skinName) {
        this.selectActive = false;
        this.canvas.style.cursor = "default";
        this.canvas.removeEventListener("click", this._onCanvasClick);
        this.canvas.removeEventListener("mousemove", this._onCanvasMove);

        this.socket.emit("setAvatar", skinName);

        // Clean up all selection objects
        for (const obj of this.selectObjects) {
            this.scene.remove(obj);
            obj.traverse?.((child) => {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    if (child.material.map) child.material.map.dispose();
                    child.material.dispose();
                }
            });
        }
        this.selectObjects = [];
        this.selectModels = [];
        this.selectMixers = [];

        // Restore scene
        this.scene.background = this.savedBackground;
        this.scene.fog = this.savedFog;

        // Unfreeze camera — move it back to world origin and enable game
        this.camera.frozen = false;
        this.camera.target.set(0, 0, 0);
        this.camera.angles.horizontal = 0;
        this.camera.angles.vertical = 0.15;
        this.camera.pointerLockEnabled = true;
    }

    update() {
        if (!this.selectActive || this.selectMixers.length === 0) return;

        const delta = this.experience.time.delta;

        for (const mixer of this.selectMixers) {
            mixer.update(delta);
        }

        for (const model of this.selectModels) {
            model.rotation.y += 0.3 * delta;
        }

        // Keep camera locked in position during selection
        this.camera.perspectiveCamera.position.set(0, SELECT_Y + 1.3, 4);
        this.camera.perspectiveCamera.lookAt(0, SELECT_Y + 0.7, 0);
    }
}
