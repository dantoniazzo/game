import * as THREE from "three";
import Experience from "../../Experience.js";
import { Capsule } from "three/examples/jsm/math/Capsule";

import nipplejs from "nipplejs";
import elements from "../../Utils/functions/elements.js";

import Avatar from "./Avatar.js";
import { unregisterAvatar } from "../Combat/ShooterAnimations.js";

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
    this.setupCombatHUD();
  }

  // ─── vehicle interface ──────────────────────────────────────────────────

  setFleet(fleet) {
    this.fleet = fleet;
  }

  setProjectiles(projectiles) {
    this.projectiles = projectiles;
  }

  // ─── combat HUD ────────────────────────────────────────────────────────────

  setupCombatHUD() {
    this.hud = {
      root: document.querySelector(".combat-hud"),
      fill: document.querySelector(".health-hud__fill"),
      num: document.querySelector(".health-hud__num"),
      respawn: document.querySelector(".respawn-overlay"),
      respawnBtn: document.querySelector(".respawn-card__btn"),
      selector: document.querySelector(".weapon-selector"),
      selHand: document.querySelector('.weapon-slot[data-weapon="hand"]'),
      selGun: document.querySelector('.weapon-slot[data-weapon="gun"]'),
    };
    if (this.hud.respawnBtn) {
      this.hud.respawnBtn.addEventListener("click", () => this.respawn());
    }
  }

  // ─── weapon selector (hand / gun) ───────────────────────────────────────────

  setWeaponMode(mode) {
    if (mode === this.weaponMode) return;
    this.weaponMode = mode;
    if (this.avatar) this.avatar.setWeaponMode(mode);
    // crosshair is gated on gun mode via this class
    if (this.hud?.root) this.hud.root.classList.toggle("gun-mode", mode === "gun");
  }

  showWeaponSelector() {
    const sel = this.hud?.selector;
    if (!sel) return;
    sel.classList.remove("hidden");
    this.hud.selHand?.classList.toggle("is-active", this.weaponMode === "hand");
    this.hud.selGun?.classList.toggle("is-active", this.weaponMode === "gun");
    clearTimeout(this._selTimeout);
    this._selTimeout = setTimeout(() => sel.classList.add("hidden"), 1500);
  }

  showCombatHUD(visible) {
    if (this.hud?.root) this.hud.root.classList.toggle("hidden", !visible);
  }

  updateHealthHUD() {
    const pct = Math.max(0, this.player.health) / this.maxHealth;
    if (this.hud?.fill) {
      this.hud.fill.style.width = pct * 100 + "%";
      this.hud.fill.style.background =
        pct > 0.5
          ? "linear-gradient(90deg,#2fbf6a,#8ee05a)"
          : pct > 0.25
            ? "linear-gradient(90deg,#f0a93a,#f5c860)"
            : "linear-gradient(90deg,#e2453a,#ff7a6e)";
    }
    if (this.hud?.num) {
      this.hud.num.textContent = String(Math.max(0, Math.round(this.player.health)));
    }
  }

  // ─── shooting ──────────────────────────────────────────────────────────────

  fireWeapon() {
    const cam = this.camera.perspectiveCamera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);

    // Fire from the avatar's chest toward a far point along the camera ray so
    // bullets converge on the crosshair.
    const origin = this.avatar.avatar.position.clone();
    origin.y += 1.4;
    const aim = cam.position.clone().addScaledVector(fwd, 200);
    const dir = aim.sub(origin).normalize();

    this.projectiles.fireLocal(origin, dir);
    this._firingUntil = performance.now() + this.firingDuration;
  }

  // Remote players the local bullets can hit (alive + on foot).
  collectTargets() {
    const list = [];
    for (const id in this.otherPlayers) {
      const rp = this.otherPlayers[id];
      if (!rp.model || !rp.position) continue;
      if ((rp._prevVehicle ?? -1) >= 0) continue; // driving a car
      if ((rp.health ?? 100) <= 0) continue; // already down
      list.push({
        id,
        center: new THREE.Vector3(
          rp.position.position_x,
          rp.position.position_y + 1.2,
          rp.position.position_z,
        ),
      });
    }
    return list;
  }

  // ─── health / death / respawn ───────────────────────────────────────────────

  takeDamage(amount) {
    if (this.isDead) return;
    this.player.health = Math.max(0, this.player.health - amount);
    this.updateHealthHUD();
    if (this.player.health <= 0) this.die();
  }

  die() {
    if (this.isDead) return;
    this.isDead = true;
    this.player.health = 0;
    this.updateHealthHUD();

    if (this.inVehicle) this.exitVehicle();

    // Play + broadcast the death animation (others see it via the animation field)
    this.player.animation = "dying";
    if (this.avatar) {
      this.avatar.ensureDying();
      this.avatar.animation.play("dying", 0.15);
    }

    // Free the cursor and show the respawn prompt
    if (document.pointerLockElement) document.exitPointerLock();
    this.camera.pointerLockEnabled = false;
    this.showCombatHUD(false);
    if (this.hud?.respawn) this.hud.respawn.classList.remove("hidden");
  }

  respawn() {
    if (!this.isDead) return;
    this.isDead = false;
    this.player.health = this.maxHealth;
    this.updateHealthHUD();

    const spawnPos = new THREE.Vector3(0, 3, 0);
    this.player.collider.start.copy(spawnPos);
    this.player.collider.end.copy(spawnPos);
    this.player.collider.end.y += this.player.height;
    this.player.velocity.set(0, 0, 0);

    this.player.animation = "idle";
    if (this.avatar) {
      this.avatar.resetFromDeath();
      this.avatar.animation.play("idle", 0.2);
    }

    if (this.hud?.respawn) this.hud.respawn.classList.add("hidden");
    this.showCombatHUD(true);
    this.camera.pointerLockEnabled = true; // re-locks on next canvas click
  }

  enterVehicle() {
    if (!this.fleet || this.inVehicle) return;

    // Enter the nearest car, unless another player is already driving it
    const near = this.fleet.getNearest(this.player.collider.end, 6);
    if (!near || this.fleet.isRemoteOccupied(near.index)) return;

    this.inVehicle = true;
    this.currentVehicle = near.car;
    this.currentVehicleIndex = near.index;

    // Hide the player avatar
    if (this.avatar) this.avatar.avatar.visible = false;

    // Broadcast the car transform instead of the avatar while driving
    this._inVehicleFlag = true;

    // Disable player controls
    this.actions.forward = false;
    this.actions.backward = false;
    this.actions.left = false;
    this.actions.right = false;
    this.actions.jump = false;

    // Switch camera to vehicle mode
    this.camera.enterVehicleMode(this.currentVehicle);

    // Seed the vehicle camera at the current camera position so there's no jump
    this.currentVehicle.cameraPosition.copy(this.camera.perspectiveCamera.position);

    // Take local control of this car (recompute every car's authority)
    this._applyCarAuthority();
    this.fleet.showEnterPrompt(false);
    this.fleet.showExitPrompt(true);
    this.hud?.root?.classList.add("in-vehicle"); // hide crosshair while driving
  }

  exitVehicle() {
    if (!this.inVehicle || !this.currentVehicle) return;
    this.inVehicle = false;
    this._inVehicleFlag = false;

    // Restore avatar
    if (this.avatar) this.avatar.avatar.visible = true;

    // Teleport player collider next to the car (offset sideways so they don't spawn inside)
    const carPos = this.currentVehicle.getPosition();
    const exitOffset = new THREE.Vector3(3, 1, 0);
    const spawnPos = carPos.clone().add(exitOffset);

    this.player.collider.start.copy(spawnPos);
    this.player.collider.end.copy(spawnPos);
    this.player.collider.end.y += this.player.height;
    this.player.velocity.set(0, 0, 0);

    if (this.fleet) this.fleet.showExitPrompt(false);
    this.hud?.root?.classList.remove("in-vehicle");

    // Switch camera back to player mode
    this.camera.exitVehicleMode();

    this.currentVehicle = null;
    this.currentVehicleIndex = -1;

    // The car I left is now parked — host simulates it, everyone else mirrors
    this._applyCarAuthority();
  }

  // Decide each car's mode from who's driving it and who the host is:
  //   • I'm driving it           → "local"  (I simulate + broadcast it)
  //   • another player drives it → "remote" (kinematic from their broadcast)
  //   • parked (nobody driving)  → host simulates + broadcasts it ("idle");
  //     every other client mirrors it ("remote"). Before the host is known,
  //     simulate locally ("idle") so cars settle onto their suspension.
  _applyCarAuthority() {
    if (!this.fleet) return;
    for (let k = 0; k < this.fleet.cars.length; k++) {
      const car = this.fleet.cars[k];
      if (this.currentVehicleIndex === k) {
        car.setMode("local");
      } else if (car.remoteDriverId != null) {
        car.setMode("remote");
      } else {
        car.setMode(this._hostKnown && !this.isHost ? "remote" : "idle");
      }
    }
  }

  initPlayer() {
    this.player = {};
    this.inVehicle = false;
    this.fleet = null;
    this.currentVehicle = null;
    this.currentVehicleIndex = -1;

    // Multiplayer car authority: the server names one client the "host", which
    // simulates + broadcasts every parked (un-driven) car so all clients agree.
    this.isHost = false;
    this.hostId = null;
    this._hostKnown = false;

    // Combat
    this.maxHealth = 100;
    this.player.health = 100;
    this.isDead = false;
    this.projectiles = null;
    this._lastFire = 0;
    this.fireCooldown = 180; // ms between shots
    this._firingUntil = 0; // play the "firing" anim until this timestamp
    this.firingDuration = 350; // ms the firing pose holds per shot
    this.weaponMode = "hand"; // "hand" (no gun) | "gun" (shooter mode)
    this._lastWheel = 0;

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
        this.showCombatHUD(true);
        this.updateHealthHUD();
      }
    });

    // Server names one client the authority for all parked cars.
    this.socket.on("hostId", (id) => {
      this.hostId = id;
      this.isHost = id === this.socket.id;
      this._hostKnown = true;
      this._applyCarAuthority();
    });

    // Transforms of parked cars, broadcast by the host. Non-host clients render
    // them so every client sees identical positions for un-driven cars.
    this.socket.on("carData", (cars) => {
      if (this.isHost || !this.fleet) return;
      for (const c of cars) {
        this.fleet.setRemoteState(
          c.id,
          { position_x: c.px, position_y: c.py, position_z: c.pz },
          { quaternion_x: c.qx, quaternion_y: c.qy, quaternion_z: c.qz, quaternion_w: c.qw },
        );
      }
    });

    // Another player fired — draw a cosmetic tracer (no damage on this client).
    this.socket.on("playerShoot", (d) => {
      if (!this.projectiles) return;
      this.projectiles.spawnRemote(
        new THREE.Vector3(d.ox, d.oy, d.oz),
        new THREE.Vector3(d.dx, d.dy, d.dz),
      );
    });

    // One of my bullets hit me (per the shooter); apply the damage to myself.
    this.socket.on("hitByPlayer", (damage) => {
      this.takeDamage(damage);
    });

    this.socket.on("playerData", (playerData, hid) => {
      // Learn the current host from every broadcast — the one-shot "hostId"
      // event can fire before this client's listeners are attached.
      if (hid != null && (hid !== this.hostId || !this._hostKnown)) {
        this.hostId = hid;
        this.isHost = hid === this.socket.id;
        this._hostKnown = true;
      }

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
                  : "mike";
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
            const rp = this.otherPlayers[player.id];

            // ── position / rotation / animation ──────────────────────────
            rp.position = {
              position_x: player.position_x,
              position_y: player.position_y,
              position_z: player.position_z,
            };
            rp.quaternion = {
              quaternion_x: player.quaternion_x,
              quaternion_y: player.quaternion_y,
              quaternion_z: player.quaternion_z,
              quaternion_w: player.quaternion_w,
            };
            rp.animation = { animation: player.animation };

            // ── health (drives the floating bar above their head) ─────────
            rp.health = Number.isFinite(player.health) ? player.health : 100;
            if (rp.model && rp.model.healthBar) {
              rp.model.healthBar.set(Math.max(0, rp.health) / 100);
            }
            if (rp.model && rp.model.setWeaponMode) {
              rp.model.setWeaponMode(player.weaponMode === "gun" ? "gun" : "hand");
            }

            // ── which car (if any) this player is driving ────────────────
            const prevV = rp._prevVehicle ?? -1;
            const nowV = Number.isInteger(player.vehicleId) ? player.vehicleId : -1;

            if (nowV !== prevV) {
              if (prevV >= 0 && this.fleet) this.fleet.releaseCar(prevV, player.id);

              if (nowV >= 0) {
                // Driving a fleet car — hide their avatar, mark the car remote
                rp.model.avatar.visible = false;
                rp.model.nametag.visible = false;
                if (rp.model.healthBar) rp.model.healthBar.sprite.visible = false;
                if (this.fleet) this.fleet.occupyCar(nowV, player.id);
                // If I happen to be in that same car, step out
                if (this.inVehicle && this.currentVehicleIndex === nowV) this.exitVehicle();
              } else {
                // Back on foot — restore their avatar
                rp.model.avatar.visible = true;
                rp.model.nametag.visible = true;
                if (rp.model.healthBar) rp.model.healthBar.sprite.visible = true;
              }
              rp._prevVehicle = nowV;
            }

            // Feed the car its latest transform each network tick
            if (nowV >= 0 && this.fleet) {
              this.fleet.setRemoteState(nowV, rp.position, rp.quaternion);
            }
          }
        }
      }

      // Recompute every car's authority now that drivers may have changed
      this._applyCarAuthority();
    });

    this.socket.on("removePlayer", (id) => {
      this.disconnectedPlayerId = id;
      if (!this.otherPlayers[id]) return;

      // If this player was driving a car, free it so it can be used again
      const _leftV = this.otherPlayers[id]._prevVehicle ?? -1;
      if (_leftV >= 0 && this.fleet) {
        this.fleet.releaseCar(_leftV, id);
        this._applyCarAuthority();
      }

      if (this.otherPlayers[id].model.healthBar) {
        this.scene.remove(this.otherPlayers[id].model.healthBar.sprite);
        this.otherPlayers[id].model.healthBar.dispose();
      }
      unregisterAvatar(this.otherPlayers[id].model);

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
      if (!this.avatar) return;

      if (this._inVehicleFlag && this.currentVehicle) {
        // Broadcast car position so other players see the car moving
        const t = this.currentVehicle.chassisBody.translation();
        const r = this.currentVehicle.chassisBody.rotation();
        this.socket.emit("updatePlayer", {
          position: { x: t.x, y: t.y, z: t.z },
          quaternion: [r.x, r.y, r.z, r.w],
          animation: this.player.animation,
          avatarSkin: this.player.avatarSkin,
          inVehicle: true,
          vehicleId: this.currentVehicleIndex,
          health: this.player.health,
          dead: this.isDead,
          weaponMode: this.weaponMode,
        });
      } else {
        this.socket.emit("updatePlayer", {
          position: this.avatar.avatar.position,
          quaternion: this.avatar.avatar.quaternion,
          animation: this.player.animation,
          avatarSkin: this.player.avatarSkin,
          inVehicle: false,
          vehicleId: -1,
          health: this.player.health,
          dead: this.isDead,
          weaponMode: this.weaponMode,
        });
      }

      // As host, broadcast every parked car so all clients agree on its pose
      if (this.isHost && this.fleet) {
        const cars = [];
        for (let k = 0; k < this.fleet.cars.length; k++) {
          const car = this.fleet.cars[k];
          if (car.mode !== "idle") continue;
          const t = car.chassisBody.translation();
          const r = car.chassisBody.rotation();
          cars.push({ id: k, px: t.x, py: t.y, pz: t.z, qx: r.x, qy: r.y, qz: r.z, qw: r.w });
        }
        if (cars.length) this.socket.emit("updateCars", cars);
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

    // F key — enter / exit vehicle
    if (e.code === "KeyF") {
      if (this.inVehicle) {
        this.exitVehicle();
      } else if (this.fleet && this._isNearVehicle()) {
        this.enterVehicle();
      }
      return;
    }

    // Block all other player controls while driving
    if (this.inVehicle) return;

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

  onMouseDown = (e) => {
    if (e.button !== 0) return; // left click only
    if (!document.pointerLockElement) return; // only while locked into the game
    if (this.inVehicle || this.isDead || !this.avatar || !this.projectiles) return;
    if (this.weaponMode !== "gun") return; // only shoot with the gun equipped

    const now = performance.now();
    if (now - this._lastFire < this.fireCooldown) return;
    this._lastFire = now;
    this.fireWeapon();
  };

  onWheel = () => {
    if (!this.avatar || this.isDead || this.inVehicle) return;
    const now = performance.now();
    if (now - this._lastWheel < 200) return; // one notch per toggle
    this._lastWheel = now;
    this.setWeaponMode(this.weaponMode === "gun" ? "hand" : "gun");
    this.showWeaponSelector();
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
    document.addEventListener("mousedown", this.onMouseDown);
    document.addEventListener("wheel", this.onWheel, { passive: true });

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

    // Push player out of every car's oriented bounding box
    if (this.fleet) this.fleet.resolvePlayerCollision(this.player.collider);

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
      const rp = this.otherPlayers[player];
      if (!rp.position) continue;

      // Driving a fleet car — VehicleFleet positions the car from the network
      // transform and the avatar is hidden, so there's nothing to update here.
      if ((rp._prevVehicle ?? -1) >= 0) continue;

      // Normal on-foot avatar update
      rp.model.avatar.position.set(
        rp.position.position_x,
        rp.position.position_y,
        rp.position.position_z,
      );

      const rpAnim = rp.animation.animation;
      if (rp._wasDying && rpAnim !== "dying") rp.model.resetFromDeath();
      rp._wasDying = rpAnim === "dying";
      rp.model.animation.play(rpAnim);
      rp.model.animation.update(this.time.delta);

      rp.model.avatar.quaternion.set(
        rp.quaternion.quaternion_x,
        rp.quaternion.quaternion_y,
        rp.quaternion.quaternion_z,
        rp.quaternion.quaternion_w,
      );

      rp.model.nametag.position.set(
        rp.position.position_x,
        rp.position.position_y + 2.1,
        rp.position.position_z,
      );

      if (rp.model.healthBar) {
        rp.model.healthBar.sprite.position.set(
          rp.position.position_x,
          rp.position.position_y + 1.85,
          rp.position.position_z,
        );
      }
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

    const firing = performance.now() < this._firingUntil;
    let desired;
    if (inJump) {
      desired = this.jumpAnim;
    } else if (firing && this.isMoving()) {
      // Run-and-gun: legs keep moving, upper body fires (layered in Avatar).
      desired = this.actions.run ? "firing-run" : "firing-walk";
    } else if (firing) {
      desired = "firing";
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

  // ─── vehicle proximity helper ────────────────────────────────────────────

  _isNearVehicle() {
    return this.fleet
      ? !!this.fleet.getNearest(this.player.collider.end, 6)
      : false;
  }

  update() {
    // Dead: freeze movement; keep the death animation playing and other
    // players updating until the player respawns.
    if (this.isDead) {
      if (this.avatar) this.avatar.animation.update(this.time.delta);
      this.updateOtherPlayers();
      return;
    }

    // While in the vehicle, still update other players' avatars but skip
    // all player movement / animation
    if (this.inVehicle) {
      this.updateOtherPlayers();
      return;
    }

    if (this.avatar) {
      this.updateColliderMovement();
      this.updateAvatarPosition();
      this.updateAvatarRotation();
      this.updateDesiredAnimation();
      this.updateCameraPosition();
      this.updateOtherPlayers();

      // Show/hide "Press F to enter" prompt based on proximity
      if (this.fleet) {
        this.fleet.showEnterPrompt(this._isNearVehicle());
      }
    }
  }
}
