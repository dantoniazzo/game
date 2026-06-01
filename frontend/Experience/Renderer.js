import * as THREE from "three";
import Experience from "./Experience.js";

export default class Renderer {
    constructor() {
        this.experience = new Experience();
        this.sizes = this.experience.sizes;
        this.scene = this.experience.scene;
        this.canvas = this.experience.canvas;
        this.camera = this.experience.camera;

        this.setRenderer();
    }

    setRenderer() {
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance',
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        // NoToneMapping skips the tone-map post-process each frame
        this.renderer.toneMapping = THREE.NoToneMapping;
        this.renderer.setSize(this.sizes.width, this.sizes.height);
        // Cap at 1.5 — retina beyond this gives diminishing returns vs GPU cost
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    }

    onResize() {
        this.renderer.setSize(this.sizes.width, this.sizes.height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    }

    update() {
        this.renderer.render(this.scene, this.camera.perspectiveCamera);
    }
}
