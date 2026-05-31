import * as THREE from "three";
import { EventEmitter } from "events";
import Experience from "../Experience.js";

import { Octree } from "three/examples/jsm/math/Octree";
import RAPIER from "@dimforge/rapier3d-compat";

import Player from "./Player/Player.js";
import Environment from "./Environment.js";
import Compass from "./Compass.js";
import Vehicle from "./Vehicle/Vehicle.js";
import CityBlock from "./CityBlock.js";

export default class World extends EventEmitter {
    constructor() {
        super();
        this.experience = new Experience();
        this.resources = this.experience.resources;

        this.octree = new Octree();

        this.player = null;
        this.vehicle = null;

        this._rapierReady = false;
        this._resourcesReady = false;

        // Initialise Rapier (async WASM load) in parallel with asset loading
        this._initRapier();

        this.resources.on("ready", () => {
            if (this.player === null) {
                this.createGround();
                this.player = new Player();
                this.environment = new Environment();
                this.compass = new Compass();
            }
            this._resourcesReady = true;
            this._tryCreateVehicle();
        });
    }

    async _initRapier() {
        await RAPIER.init();

        // Physics world with standard gravity
        this.rapierWorld = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

        // Ground collider matching the visual ground:
        // visual ground is a 100×100 plane at y=0; Octree collider is
        // BoxGeometry(100, 0.5, 100) centred at y=-0.25.
        const groundDesc = RAPIER.RigidBodyDesc.fixed();
        const groundBody = this.rapierWorld.createRigidBody(groundDesc);
        // cuboid half-extents: 50 in X/Z, 0.25 in Y, positioned at y=-0.25
        const groundCollider = RAPIER.ColliderDesc.cuboid(50, 0.25, 50)
            .setTranslation(0, -0.25, 0)
            .setFriction(1.0);
        this.rapierWorld.createCollider(groundCollider, groundBody);

        this._rapierReady = true;
        this._tryCreateVehicle();
    }

    _tryCreateVehicle() {
        if (!this._rapierReady || !this._resourcesReady) return;

        const chassisGLTF = this.resources.items["vehicleChassis"];
        const wheelGLTF   = this.resources.items["vehicleWheel"];

        if (!chassisGLTF || !wheelGLTF) {
            console.warn("Vehicle GLB assets not found — skipping vehicle creation.");
            return;
        }

        this.vehicle = new Vehicle({
            rapierWorld: this.rapierWorld,
            scene: this.experience.scene,
            chassisGLTF,
            wheelGLTF,
            spawnPosition: new THREE.Vector3(25, 2, 0),
        });

        // Give Player a reference so it can handle enter/exit
        if (this.player) {
            this.player.setVehicle(this.vehicle);
        }
    }

    createGround() {
        const size = 100;
        const geometry = new THREE.PlaneGeometry(size, size, 20, 20);
        geometry.rotateX(-Math.PI / 2);

        // Invisible — CityBlock renders the visual ground on top
        const material = new THREE.MeshBasicMaterial({ visible: false });

        this.ground = new THREE.Mesh(geometry, material);
        this.experience.scene.add(this.ground);

        // Collider for Octree (player collision)
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
        if (this.vehicle) this.vehicle.update(this.experience.time.delta);
        if (this.compass) this.compass.update();
    }
}
