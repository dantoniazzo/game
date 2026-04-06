import Experience from "../Experience.js";
import * as THREE from "three";

export default class Environment {
    constructor() {
        this.experience = new Experience();
        this.scene = this.experience.scene;

        this.setEnvironment();
    }

    setEnvironment() {
        this.scene.background = new THREE.Color("#0a0a12");

        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        this.scene.add(ambient);

        this.sunLight = new THREE.DirectionalLight("#4466aa", 0.8);
        this.sunLight.position.set(10, 15, 10);
        this.scene.add(this.sunLight);
    }

    update() {}
}
