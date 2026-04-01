import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import Experience from "../Experience.js";
import { GrassGeometry, GrassMaterial } from "./Grass.js";

const GROUND_COLOR = "#1f0e01";
const GRASS_WIDTH = 50;
const GRASS_INSTANCES = 50000;
const BLADE_WIDTH = 0.04;
const BLADE_HEIGHT = 0.3;
const BLADE_JOINTS = 4;

const simplexNoise = createNoise2D();

function getGroundHeight(x, z) {
  return 0.2 * simplexNoise(x / 10, z / 10);
}

export default class GrassWorld {
  constructor() {
    this.experience = new Experience();
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;
    this.octree = this.experience.world.octree;
    this.time = this.experience.time;
    this.elapsedTime = 0;

    this.setWorld();
  }

  setWorld() {
    // Grass
    this.grassMaterial = new GrassMaterial();

    const cloudTexture = this.resources.items.cloudTexture;
    cloudTexture.wrapS = cloudTexture.wrapT = THREE.RepeatWrapping;

    this.grassMaterial.uniforms.uCloud.value = cloudTexture;
    this.grassMaterial.uniforms.alphaMap.value =
      this.resources.items.grassBladeAlpha;
    this.grassMaterial.uniforms.uBladeHeight.value = BLADE_HEIGHT;

    const grassGeometry = new GrassGeometry({
      bladeWidth: BLADE_WIDTH,
      bladeHeight: BLADE_HEIGHT,
      bladeJoints: BLADE_JOINTS,
      width: GRASS_WIDTH,
      instances: GRASS_INSTANCES,
      getGroundHeight,
    });

    this.grassMesh = new THREE.Mesh(grassGeometry, this.grassMaterial);
    this.scene.add(this.grassMesh);

    // Ground (visual)
    const groundGeometry = new THREE.PlaneGeometry(
      GRASS_WIDTH,
      GRASS_WIDTH,
      32,
      32,
    );
    groundGeometry.rotateX(-Math.PI / 2);

    // Apply same height displacement as grass
    const posArray = groundGeometry.attributes.position.array;
    for (let i = 0; i < posArray.length / 3; i++) {
      const x = posArray[i * 3 + 0];
      const z = posArray[i * 3 + 2];
      posArray[i * 3 + 1] = getGroundHeight(x, z);
    }
    groundGeometry.computeVertexNormals();

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: GROUND_COLOR,
    });
    this.groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundMesh.position.y = -0.05;
    this.scene.add(this.groundMesh);

    // Collider (flat box for Octree collision)
    const colliderGeometry = new THREE.BoxGeometry(
      GRASS_WIDTH,
      0.5,
      GRASS_WIDTH,
    );
    const colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.colliderMesh = new THREE.Mesh(colliderGeometry, colliderMaterial);
    this.colliderMesh.position.y = -0.25;
    this.colliderMesh.updateMatrixWorld(true);
    this.scene.add(this.colliderMesh);

    this.octree.fromGraphNode(this.colliderMesh);
  }

  update() {
    this.elapsedTime += this.time.delta;
    this.grassMaterial.uniforms.uTime.value = this.elapsedTime;
  }
}
