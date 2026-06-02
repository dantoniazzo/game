import Experience from "../Experience.js";
import * as THREE from "three";

export default class Environment {
    constructor() {
        this.experience = new Experience();
        this.scene = this.experience.scene;

        this.setEnvironment();
    }

    setEnvironment() {
        // Daytime sky — soft blue so the grass + cloud-shadow shader reads well
        this.scene.background = new THREE.Color("#a9cdf0");

        // Sky/ground hemisphere fill gives the city soft, natural ambient colour
        this.hemiLight = new THREE.HemisphereLight("#bfe0ff", "#5e6b48", 0.95);
        this.hemiLight.position.set(0, 50, 0);
        this.scene.add(this.hemiLight);

        // A little flat ambient so shadowed faces never go fully black
        this.ambient = new THREE.AmbientLight(0xffffff, 0.25);
        this.scene.add(this.ambient);

        // Warm directional sun, high in the sky
        this.sunLight = new THREE.DirectionalLight("#fff3df", 1.7);
        this.sunLight.position.set(60, 90, 40);
        this.scene.add(this.sunLight);
    }

    update() {}
}
