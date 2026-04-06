import * as THREE from "three";
import Experience from "../../Experience.js";
import { Capsule } from "three/examples/jsm/math/Capsule";

import nipplejs from "nipplejs";
import elements from "../../Utils/functions/elements.js";

import Avatar from "./Avatar.js";

const JUMP_ANIMS = ["jump", "running-jump"];
const CROSSFADE_DURATION = 0.2;
const JUMP_IN_CROSSFADE = 0.1;
const JUMP_OUT_CROSSFADE = 0.5;

export default class Player {
  constructor() {
    this.experience = new Experience();
    this.time = this.experience.time;
    this.scene = this.experience.scene;
    this.camera = this.experience.camera;
    this.octree = this.experience.world.octree;
    this.resources = this.experience.resources;
    this.socket = this.experience.socket;

    this.domElements = elements({
      joystickArea: ".joystick-area",
      controlOverlay: ".control-overlay",
      messageInput: "#chat-message-input",
      switchViewButton: ".switch-camera-view",
      jumpButton: ".jump-button",
    });

    this.initPlayer();
    this.initControls();
    this.setPlayerSocket();
    this.setJoyStick();
    this.addEventListeners();
  }

  initPlayer() {
    this.player = {};

    this.player.body = this.camera.perspectiveCamera;
    this.player.animation = "idle";

    this.player.onFloor = false;
    this.player.gravity = 60;

    this.player.spawn = {
      position: new THREE.Vector3(),
      rotation: new THREE.Euler(),
      velocity: new THREE.Vector3(),
    };

    this.player.raycaster = new THREE.Raycaster();
    this.player.raycaster.far = 5;

    this.player.height = 1.2;
    this.player.speedMultiplier = 0.35;
    this.player.position = new THREE.Vector3();
    this.player.quaternion = new THREE.Euler();
    this.player.directionOffset = 0;
    this.targetRotation = new THREE.Quaternion();

    this.upVector = new THREE.Vector3(0, 1, 0);
    this.player.velocity = new THREE.Vector3();
    this.player.direction = new THREE.Vector3();

    this.player.collider = new Capsule(
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(0, 2 + this.player.height, 0),
      0.35,
    );

    this.otherPlayers = {};

    this.socket.emit("setID");
    this.socket.emit("initPlayer", this.player);
  }

  initControls() {
    this.actions = {};

    this.coords = {
      previousX: 0,
      previousY: 0,
      currentX: 0,
      currentY: 0,
    };

    this.joystickVector = new THREE.Vector3();
    this.joystickDistance = 0;

    // Jump state
    this.standingJump = -1;
    this.liftoffFrames = 0;
    this.jumpAnim = "jump";
    this.jumpReady = false;
  }

  setJoyStick() {
    this.options = {
      zone: this.domElements.joystickArea,
      mode: "dynamic",
    };
    this.joystick = nipplejs.create(this.options);

    this.joystick.on("move", (e, data) => {
      this.actions.movingJoyStick = true;
      this.joystickVector.z = -data.vector.y;
      this.joystickVector.x = data.vector.x;
      this.joystickDistance = data.distance;
      this.actions.run = data.distance > 35;
    });

    this.joystick.on("end", () => {
      this.actions.movingJoyStick = false;
      this.joystickDistance = 0;
      this.actions.run = false;
    });
  }

  setPlayerSocket() {
    this.socket.on("setID", (setID, name) => {});

    this.socket.on("setAvatarSkin", (avatarSkin, id) => {
      if (!this.avatar && id === this.socket.id) {
        const skin = this.resources.items[avatarSkin] ? avatarSkin : "mike";
        this.player.avatarSkin = skin;
        this.avatar = new Avatar(this.resources.items[skin], this.scene);
        this.updatePlayerSocket();
      }
    });

    this.socket.on("playerData", (playerData) => {
      for (let player of playerData) {
        if (player.id !== this.socket.id) {
          this.scene.traverse((child) => {
            if (child.userData.id === player.id) {
              return;
            } else {
              if (!this.otherPlayers.hasOwnProperty(player.id)) {
                if (player.name === "" || player.avatarSkin === "") {
                  return;
                }

                const name = player.name.substring(0, 25);

                const otherSkin = this.resources.items[player.avatarSkin]
                  ? player.avatarSkin
                  : "brute";
                const newAvatar = new Avatar(
                  this.resources.items[otherSkin],
                  this.scene,
                  name,
                  player.id,
                );

                player.model = newAvatar;
                this.otherPlayers[player.id] = player;
              }
            }
          });
          if (this.otherPlayers[player.id]) {
            this.otherPlayers[player.id].position = {
              position_x: player.position_x,
              position_y: player.position_y,
              position_z: player.position_z,
            };
            this.otherPlayers[player.id].quaternion = {
              quaternion_x: player.quaternion_x,
              quaternion_y: player.quaternion_y,
              quaternion_z: player.quaternion_z,
              quaternion_w: player.quaternion_w,
            };
            this.otherPlayers[player.id].animation = {
              animation: player.animation,
            };
          }
        }
      }
    });

    this.socket.on("removePlayer", (id) => {
      this.disconnectedPlayerId = id;

      this.otherPlayers[id].model.nametag.material.dispose();
      this.otherPlayers[id].model.nametag.geometry.dispose();
      this.scene.remove(this.otherPlayers[id].model.nametag);

      this.otherPlayers[id].model.avatar.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.material.dispose();
          child.geometry.dispose();
        }

        if (child.material) {
          child.material.dispose();
        }

        if (child.geometry) {
          child.geometry.dispose();
        }
      });

      this.scene.remove(this.otherPlayers[id].model.avatar);

      delete this.otherPlayers[id].nametag;
      delete this.otherPlayers[id].model;
      delete this.otherPlayers[id];
    });
  }

  updatePlayerSocket() {
    setInterval(() => {
      if (this.avatar) {
        this.socket.emit("updatePlayer", {
          position: this.avatar.avatar.position,
          quaternion: this.avatar.avatar.quaternion,
          animation: this.player.animation,
          avatarSkin: this.player.avatarSkin,
        });
      }
    }, 20);
  }

  isMoving() {
    return (
      this.actions.forward ||
      this.actions.backward ||
      this.actions.left ||
      this.actions.right ||
      this.actions.movingJoyStick
    );
  }

  onKeyDown = (e) => {
    if (document.activeElement === this.domElements.messageInput) return;

    if (e.code === "KeyW" || e.code === "ArrowUp") this.actions.forward = true;
    if (e.code === "KeyS" || e.code === "ArrowDown")
      this.actions.backward = true;
    if (e.code === "KeyA" || e.code === "ArrowLeft") this.actions.left = true;
    if (e.code === "KeyD" || e.code === "ArrowRight") this.actions.right = true;
    if (e.code === "ShiftLeft") this.actions.run = true;

    if (
      e.code === "Space" &&
      !this.actions.jump &&
      this.player.onFloor &&
      this.standingJump < 0 &&
      this.liftoffFrames === 0
    ) {
      this.actions.jump = true;

      if (this.isMoving()) {
        // Walking or running jump — immediate impulse
        this.jumpAnim = "running-jump";
        this.jumpReady = true;
      } else {
        // Standing jump — animation only, no impulse
        this.jumpAnim = "jump";
        this.standingJump = 0;
      }
    }
  };

  onKeyUp = (e) => {
    if (e.code === "KeyW" || e.code === "ArrowUp") this.actions.forward = false;
    if (e.code === "KeyS" || e.code === "ArrowDown")
      this.actions.backward = false;
    if (e.code === "KeyA" || e.code === "ArrowLeft") this.actions.left = false;
    if (e.code === "KeyD" || e.code === "ArrowRight")
      this.actions.right = false;
    if (e.code === "ShiftLeft") this.actions.run = false;
    if (e.code === "Space") this.actions.jump = false;
  };

  playerCollisions() {
    const result = this.octree.capsuleIntersect(this.player.collider);
    this.player.onFloor = false;

    if (result) {
      this.player.onFloor = result.normal.y > 0;

      this.player.collider.translate(
        result.normal.multiplyScalar(result.depth),
      );
    }
  }

  getForwardVector() {
    this.camera.perspectiveCamera.getWorldDirection(this.player.direction);
    this.player.direction.y = 0;
    this.player.direction.normalize();

    return this.player.direction;
  }

  getSideVector() {
    this.camera.perspectiveCamera.getWorldDirection(this.player.direction);
    this.player.direction.y = 0;
    this.player.direction.normalize();
    this.player.direction.cross(this.camera.perspectiveCamera.up);

    return this.player.direction;
  }

  getJoyStickDirectionalVector() {
    let returnVector = new THREE.Vector3();
    returnVector.copy(this.joystickVector);

    returnVector.applyQuaternion(this.camera.perspectiveCamera.quaternion);
    returnVector.y = 0;

    // Scale speed progressively with joystick distance (0-50 range)
    const t = Math.min(this.joystickDistance / 50, 1);
    const speed = 0.5 + t * 2.5;
    returnVector.multiplyScalar(speed);

    return returnVector;
  }

  addEventListeners() {
    document.addEventListener("keydown", this.onKeyDown);
    document.addEventListener("keyup", this.onKeyUp);

    if (this.domElements.jumpButton) {
      this.domElements.jumpButton.addEventListener("touchstart", (e) => {
        e.preventDefault();
        if (
          !this.actions.jump &&
          this.player.onFloor &&
          this.standingJump < 0 &&
          this.liftoffFrames === 0
        ) {
          this.actions.jump = true;
          if (this.isMoving()) {
            this.jumpAnim = "running-jump";
            this.jumpReady = true;
          } else {
            this.jumpAnim = "jump";
            this.standingJump = 0;
          }
        }
      });
      this.domElements.jumpButton.addEventListener("touchend", (e) => {
        e.preventDefault();
        this.actions.jump = false;
      });
    }
  }

  resize() {}

  spawnPlayerOutOfBounds() {
    const spawnPos = new THREE.Vector3(0, 3, 0);
    this.player.velocity = this.player.spawn.velocity;

    this.player.collider.start.copy(spawnPos);
    this.player.collider.end.copy(spawnPos);

    this.player.collider.end.y += this.player.height;
  }

  updateColliderMovement() {
    const speed =
      (this.player.onFloor ? 1.75 : 0.1) *
      this.player.gravity *
      this.player.speedMultiplier;

    let speedDelta = this.time.delta * speed;

    if (this.actions.movingJoyStick) {
      this.player.velocity.add(this.getJoyStickDirectionalVector());
    }

    if (this.actions.run) {
      speedDelta *= 2.5;
    }

    if (this.actions.forward) {
      this.player.velocity.add(
        this.getForwardVector().multiplyScalar(speedDelta),
      );
    }
    if (this.actions.backward) {
      this.player.velocity.add(
        this.getForwardVector().multiplyScalar(-speedDelta),
      );
    }
    if (this.actions.left) {
      this.player.velocity.add(
        this.getSideVector().multiplyScalar(-speedDelta),
      );
    }
    if (this.actions.right) {
      this.player.velocity.add(this.getSideVector().multiplyScalar(speedDelta));
    }

    // --- Jump physics ---
    if (this.player.onFloor) {
      // Running/walking jump: immediate impulse
      if (this.jumpReady) {
        this.player.velocity.y = 6;
        this.jumpReady = false;
        this.liftoffFrames = 10;
      }

    } else {
      // Fell off ledge during standing jump — cancel
      if (this.standingJump >= 0) {
        this.standingJump = -1;
      }
      this.jumpReady = false;
    }

    // Liftoff counter: keeps jump state active while physics hasn't lifted yet
    if (this.liftoffFrames > 0) {
      if (!this.player.onFloor) {
        this.liftoffFrames = 0;
      } else {
        this.liftoffFrames--;
      }
    }

    // --- Gravity & damping ---
    let damping = Math.exp(-15 * this.time.delta) - 1;

    if (!this.player.onFloor) {
      const inJumpAnim = JUMP_ANIMS.includes(this.player.animation);
      if (inJumpAnim) {
        this.player.velocity.y -= this.player.gravity * 0.7 * this.time.delta;
      } else {
        this.player.velocity.y -= this.player.gravity * this.time.delta;
      }
      damping *= 0.1;
    }

    this.player.velocity.addScaledVector(this.player.velocity, damping);

    const deltaPosition = this.player.velocity
      .clone()
      .multiplyScalar(this.time.delta);

    this.player.collider.translate(deltaPosition);
    this.playerCollisions();

    if (this.camera.isMobile) {
      this.player.body.position.sub(this.camera.controls.target);
      this.camera.controls.target.copy(this.player.collider.end);
      this.player.body.position.add(this.player.collider.end);
    } else {
      this.camera.target.copy(this.player.collider.end);
    }

    this.player.body.updateMatrixWorld();

    if (this.player.body.position.y < -20) {
      this.spawnPlayerOutOfBounds();
    }
  }

  updateAvatarPosition() {
    this.avatar.avatar.position.copy(this.player.collider.end);
    this.avatar.avatar.position.y -= 1.56;

    this.avatar.animation.update(this.time.delta);
  }

  updateOtherPlayers() {
    for (let player in this.otherPlayers) {
      this.otherPlayers[player].model.avatar.position.set(
        this.otherPlayers[player].position.position_x,
        this.otherPlayers[player].position.position_y,
        this.otherPlayers[player].position.position_z,
      );

      this.otherPlayers[player].model.animation.play(
        this.otherPlayers[player].animation.animation,
      );

      this.otherPlayers[player].model.animation.update(this.time.delta);

      this.otherPlayers[player].model.avatar.quaternion.set(
        this.otherPlayers[player].quaternion.quaternion_x,
        this.otherPlayers[player].quaternion.quaternion_y,
        this.otherPlayers[player].quaternion.quaternion_z,
        this.otherPlayers[player].quaternion.quaternion_w,
      );

      this.otherPlayers[player].model.nametag.position.set(
        this.otherPlayers[player].position.position_x,
        this.otherPlayers[player].position.position_y + 2.1,
        this.otherPlayers[player].position.position_z,
      );
    }
  }

  updateAvatarRotation() {
    if (this.actions.movingJoyStick) {
      // Joystick: compute direction from joystick vector angle
      this.player.directionOffset = Math.atan2(
        this.joystickVector.x,
        this.joystickVector.z,
      );
      return;
    }

    if (this.actions.forward) {
      this.player.directionOffset = Math.PI;
    }
    if (this.actions.backward) {
      this.player.directionOffset = 0;
    }

    if (this.actions.left) {
      this.player.directionOffset = -Math.PI / 2;
    }

    if (this.actions.forward && this.actions.left) {
      this.player.directionOffset = Math.PI + Math.PI / 4;
    }
    if (this.actions.backward && this.actions.left) {
      this.player.directionOffset = -Math.PI / 4;
    }

    if (this.actions.right) {
      this.player.directionOffset = Math.PI / 2;
    }

    if (this.actions.forward && this.actions.right) {
      this.player.directionOffset = Math.PI - Math.PI / 4;
    }
    if (this.actions.backward && this.actions.right) {
      this.player.directionOffset = Math.PI / 4;
    }

    if (this.actions.forward && this.actions.left && this.actions.right) {
      this.player.directionOffset = Math.PI;
    }
    if (this.actions.backward && this.actions.left && this.actions.right) {
      this.player.directionOffset = 0;
    }

    if (this.actions.right && this.actions.backward && this.actions.forward) {
      this.player.directionOffset = Math.PI / 2;
    }

    if (this.actions.left && this.actions.backward && this.actions.forward) {
      this.player.directionOffset = -Math.PI / 2;
    }
  }

  updateDesiredAnimation() {
    const playingJump = JUMP_ANIMS.includes(this.player.animation);

    let jumpAnimDone = false;
    if (playingJump) {
      jumpAnimDone = this.avatar.animation.isCurrentDone();
    }

    const isStandingJump = this.standingJump >= 0;
    const isLiftingOff = this.liftoffFrames > 0;

    // Stay in jump until animation finishes AND character has landed.
    // Only enter jump from an actual jump initiation (standing jump/liftoff), not from onFloor flicker.
    const inJump = playingJump
      ? !jumpAnimDone || !this.player.onFloor
      : isStandingJump || isLiftingOff;

    // Reset standing jump flag when leaving jump state
    if (!inJump && isStandingJump) {
      this.standingJump = -1;
    }

    let desired;
    if (inJump) {
      desired = this.jumpAnim;
    } else if (this.isMoving()) {
      desired = this.actions.run ? "run" : "walk";
    } else {
      desired = "idle";
    }

    if (desired !== this.player.animation) {
      const enteringJump = JUMP_ANIMS.includes(desired);
      const leavingJump = JUMP_ANIMS.includes(this.player.animation);

      const fade = enteringJump
        ? JUMP_IN_CROSSFADE
        : leavingJump
          ? JUMP_OUT_CROSSFADE
          : CROSSFADE_DURATION;

      this.avatar.animation.play(desired, fade);
      this.player.animation = desired;
    }
  }

  updateCameraPosition() {
    if (this.isMoving()) {
      const cameraAngleFromPlayer = Math.atan2(
        this.player.body.position.x - this.avatar.avatar.position.x,
        this.player.body.position.z - this.avatar.avatar.position.z,
      );

      this.targetRotation.setFromAxisAngle(
        this.upVector,
        cameraAngleFromPlayer + this.player.directionOffset,
      );
      this.avatar.avatar.quaternion.rotateTowards(this.targetRotation, 0.15);
    }
  }

  update() {
    if (this.avatar) {
      this.updateColliderMovement();
      this.updateAvatarPosition();
      this.updateAvatarRotation();
      this.updateDesiredAnimation();
      this.updateCameraPosition();
      this.updateOtherPlayers();
    }
  }
}
