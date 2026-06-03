import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import Nametag from "./Nametag.js";

const JUMP_ANIMS = ["jump", "running-jump"];

export default class Avatar {
  constructor(avatar, scene, name = "Anonymous", id) {
    this.scene = scene;
    this.name = new Nametag();
    this.nametag = this.name.createNametag(16, 150, name);
    this.avatar = SkeletonUtils.clone(avatar.scene);
    this.avatar.userData.id = id;

    this.avatar.animations = avatar.animations.map((clip) => {
      return clip.clone();
    });

    this.setAvatar();
  }

  setAvatar() {
    this.avatar.scale.set(1.3, 1.3, 1.3);
    this.setAnimation();
    this.scene.add(this.avatar);

    if (this.avatar.userData.id) {
      this.scene.add(this.nametag);
    }
  }

  setAnimation() {
    this.animation = {};

    this.animation.mixer = new THREE.AnimationMixer(this.avatar);
    this.animation.actions = {};
    this.animation.clips = {};

    // Map this model's clips onto the canonical names the player state machine
    // drives, so any Mixamo character animates correctly regardless of how its
    // clips were named on export (e.g. "Idle"/"Walking"/"Running"/"Jump").
    const resolved = this._resolveClips(this.avatar.animations);

    for (const [name, clip] of Object.entries(resolved)) {
      this.animation.clips[name] = clip;
      const action = this.animation.mixer.clipAction(clip);

      if (JUMP_ANIMS.includes(name)) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }

      this.animation.actions[name] = action;
    }

    this.animation.current = "idle";
    if (this.animation.actions.idle) {
      this.animation.actions.idle.play();
    }

    this.animation.play = (name, fadeDuration = 0.2) => {
      const newAction = this.animation.actions[name];
      const oldAction = this.animation.actions[this.animation.current];

      if (!newAction || this.animation.current === name) return;

      newAction.reset();
      if (oldAction && oldAction !== newAction) {
        newAction.crossFadeFrom(oldAction, fadeDuration, false);
      }
      newAction.play();

      this.animation.current = name;
    };

    this.animation.isCurrentDone = () => {
      const clip = this.animation.clips[this.animation.current];
      const action = this.animation.actions[this.animation.current];
      if (!clip || !action) return true;
      return action.time >= clip.duration - 0.05;
    };

    this.animation.update = (time) => {
      this.animation.mixer.update(time);
    };
  }

  // Resolve a model's clips to the canonical set the player state machine
  // drives: idle, walk, run, jump, running-jump. Matching is case-insensitive
  // and fuzzy (so Mixamo's "Idle"/"Walking"/"Running"/"Jump" work as-is), and
  // missing clips fall back gracefully (running-jump → jump → idle). Each
  // picked clip is cloned + renamed so the canonical actions stay distinct
  // (LoopOnce on the jumps can't leak across names).
  _resolveClips(animations) {
    if (!animations || animations.length === 0) return {};

    const lc = (c) => c.name.toLowerCase();
    const findRunJump = animations.find((c) => /run/.test(lc(c)) && /jump/.test(lc(c)));
    const findJump = animations.find((c) => /jump/.test(lc(c)) && !/run/.test(lc(c)));
    const findRun = animations.find(
      (c) => /(^|[^a-z])(run|jog|sprint)/.test(lc(c)) && !/jump/.test(lc(c)),
    );
    const findWalk = animations.find((c) => /walk/.test(lc(c)));
    const findIdle = animations.find((c) => /idle|stand/.test(lc(c)));

    const fallback = findIdle || animations[0];
    const picks = {
      idle: findIdle || fallback,
      walk: findWalk || findRun || fallback,
      run: findRun || findWalk || fallback,
      jump: findJump || findRunJump || fallback,
      "running-jump": findRunJump || findJump || fallback,
    };

    const out = {};
    for (const [name, clip] of Object.entries(picks)) {
      if (!clip) continue;
      const cloned = clip.clone();
      cloned.name = name;
      out[name] = cloned;
    }
    return out;
  }
}
