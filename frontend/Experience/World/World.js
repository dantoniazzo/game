import * as THREE from "three";
import { EventEmitter } from "events";
import Experience from "../Experience.js";

import { Octree } from "three/examples/jsm/math/Octree";

import Player from "./Player/Player.js";
import Environment from "./Environment.js";
import Compass from "./Compass.js";

export default class World extends EventEmitter {
    constructor() {
        super();
        this.experience = new Experience();
        this.resources = this.experience.resources;

        this.octree = new Octree();

        this.player = null;

        this.resources.on("ready", () => {
            if (this.player === null) {
                this.createGround();
                this.player = new Player();
                this.environment = new Environment();
                this.compass = new Compass();
            }
        });
    }

    createGround() {
        const size = 100;
        const geometry = new THREE.PlaneGeometry(size, size, 20, 20);
        geometry.rotateX(-Math.PI / 2);

        const material = new THREE.MeshBasicMaterial({
            color: 0x2244aa,
            wireframe: true,
        });

        this.ground = new THREE.Mesh(geometry, material);
        this.experience.scene.add(this.ground);

        // Collider for Octree
        const colliderGeometry = new THREE.BoxGeometry(size, 0.5, size);
        const colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
        const collider = new THREE.Mesh(colliderGeometry, colliderMaterial);
        collider.position.y = -0.25;
        collider.updateMatrixWorld(true);
        this.experience.scene.add(collider);

        this.octree.fromGraphNode(collider);
    }

    update() {
        if (this.player) this.player.update();
        if (this.compass) this.compass.update();
    }
}
