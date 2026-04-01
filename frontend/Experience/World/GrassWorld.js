import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import Experience from "../Experience.js";
import { GrassGeometry, GrassMaterial } from "./Grass.js";

const GROUND_COLOR = "#1f0e01";
const TERRAIN_WIDTH = 300;
const TERRAIN_HALF = TERRAIN_WIDTH / 2;

const CHUNK_SIZE = 20;
const VIEW_DISTANCE = 50;
const BLADES_PER_CHUNK = 25000;

const BLADE_WIDTH = 0.02;
const BLADE_HEIGHT = 0.15;
const BLADE_JOINTS = 3;

const simplexNoise = createNoise2D();

function getGroundHeight(x, z) {
  let y = 2 * simplexNoise(x / 50, z / 50);
  y += 4 * simplexNoise(x / 100, z / 100);
  y += 0.5 * simplexNoise(x / 10, z / 10);
  return y;
}

export default class GrassWorld {
  constructor() {
    this.experience = new Experience();
    this.scene = this.experience.scene;
    this.resources = this.experience.resources;
    this.octree = this.experience.world.octree;
    this.time = this.experience.time;
    this.elapsedTime = 0;

    this.chunks = new Map();
    this.lastPlayerChunkX = null;
    this.lastPlayerChunkZ = null;

    this.setWorld();
  }

  setWorld() {
    // Shared grass material
    this.grassMaterial = new GrassMaterial();

    const cloudTexture = this.resources.items.cloudTexture;
    cloudTexture.wrapS = cloudTexture.wrapT = THREE.RepeatWrapping;

    this.grassMaterial.uniforms.uCloud.value = cloudTexture;
    this.grassMaterial.uniforms.alphaMap.value =
      this.resources.items.grassBladeAlpha;
    this.grassMaterial.uniforms.uBladeHeight.value = BLADE_HEIGHT;

    // Ground (visual)
    const groundGeometry = new THREE.PlaneGeometry(
      TERRAIN_WIDTH,
      TERRAIN_WIDTH,
      128,
      128,
    );
    groundGeometry.rotateX(-Math.PI / 2);

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

    // Collider — terrain geometry for Octree collision
    const colliderGeometry = new THREE.PlaneGeometry(
      TERRAIN_WIDTH,
      TERRAIN_WIDTH,
      128,
      128,
    );
    colliderGeometry.rotateX(-Math.PI / 2);

    const colliderPosArray = colliderGeometry.attributes.position.array;
    for (let i = 0; i < colliderPosArray.length / 3; i++) {
      const x = colliderPosArray[i * 3 + 0];
      const z = colliderPosArray[i * 3 + 2];
      colliderPosArray[i * 3 + 1] = getGroundHeight(x, z);
    }
    colliderGeometry.computeVertexNormals();

    const colliderMaterial = new THREE.MeshBasicMaterial({ visible: false });
    this.colliderMesh = new THREE.Mesh(colliderGeometry, colliderMaterial);
    this.colliderMesh.updateMatrixWorld(true);
    this.scene.add(this.colliderMesh);

    this.octree.fromGraphNode(this.colliderMesh);
  }

  createChunk(cx, cz) {
    const minX = cx * CHUNK_SIZE;
    const maxX = (cx + 1) * CHUNK_SIZE;
    const minZ = cz * CHUNK_SIZE;
    const maxZ = (cz + 1) * CHUNK_SIZE;

    const geometry = new GrassGeometry({
      bladeWidth: BLADE_WIDTH,
      bladeHeight: BLADE_HEIGHT,
      bladeJoints: BLADE_JOINTS,
      instances: BLADES_PER_CHUNK,
      getGroundHeight,
      area: { minX, maxX, minZ, maxZ },
    });

    const mesh = new THREE.Mesh(geometry, this.grassMaterial);
    this.scene.add(mesh);
    return mesh;
  }

  removeChunk(key) {
    const mesh = this.chunks.get(key);
    if (mesh) {
      this.scene.remove(mesh);
      mesh.geometry.dispose();
      this.chunks.delete(key);
    }
  }

  updateChunks(playerX, playerZ) {
    const pcx = Math.floor(playerX / CHUNK_SIZE);
    const pcz = Math.floor(playerZ / CHUNK_SIZE);

    if (pcx === this.lastPlayerChunkX && pcz === this.lastPlayerChunkZ) return;
    this.lastPlayerChunkX = pcx;
    this.lastPlayerChunkZ = pcz;

    const radius = Math.ceil(VIEW_DISTANCE / CHUNK_SIZE);
    const needed = new Set();

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (Math.sqrt(dx * dx + dz * dz) * CHUNK_SIZE > VIEW_DISTANCE)
          continue;

        const cx = pcx + dx;
        const cz = pcz + dz;

        // Skip chunks outside the terrain
        if (
          (cx + 1) * CHUNK_SIZE < -TERRAIN_HALF ||
          cx * CHUNK_SIZE > TERRAIN_HALF ||
          (cz + 1) * CHUNK_SIZE < -TERRAIN_HALF ||
          cz * CHUNK_SIZE > TERRAIN_HALF
        )
          continue;

        needed.add(`${cx},${cz}`);
      }
    }

    // Remove chunks no longer needed
    for (const key of this.chunks.keys()) {
      if (!needed.has(key)) {
        this.removeChunk(key);
      }
    }

    // Create new chunks
    for (const key of needed) {
      if (!this.chunks.has(key)) {
        const [cx, cz] = key.split(",").map(Number);
        this.chunks.set(key, this.createChunk(cx, cz));
      }
    }
  }

  getPlayerPosition() {
    const camera = this.experience.camera;
    if (camera.isMobile) {
      return camera.controls?.target;
    }
    return camera.target;
  }

  update() {
    this.elapsedTime += this.time.delta;
    this.grassMaterial.uniforms.uTime.value = this.elapsedTime;

    const pos = this.getPlayerPosition();
    if (pos) {
      this.updateChunks(pos.x, pos.z);
    }
  }
}
