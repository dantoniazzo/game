import Experience from "../Experience.js";
import * as THREE from "three";

export default class Environment {
    constructor() {
        this.experience = new Experience();
        this.scene = this.experience.scene;

        this.setEnvironment();
    }

    setEnvironment() {
        this.scene.background = new THREE.Color("#87ceeb");

        const ambient = new THREE.AmbientLight(0xffffff, 1.5);
        this.scene.add(ambient);

        this.sunLight = new THREE.DirectionalLight("#ffffff", 2);
        this.sunLight.position.set(10, 15, 10);
        this.scene.add(this.sunLight);

        const hemiLight = new THREE.HemisphereLight("#87ceeb", "#228b22", 0.8);
        this.scene.add(hemiLight);
    }

    update() {}
}
