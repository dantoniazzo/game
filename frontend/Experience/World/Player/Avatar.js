import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import Nametag from "./Nametag.js";
import HealthBar from "../Combat/HealthBar.js";
import { getDyingClip } from "../Combat/DyingAnimation.js";
import { registerAvatar } from "../Combat/ShooterAnimations.js";

const JUMP_ANIMS = ["jump", "running-jump"];

// Scratch quaternions reused during clip retargeting (avoid per-keyframe allocs).
const _qTarget = new THREE.Quaternion();
const _qSrcInv = new THREE.Quaternion();
const _qWork = new THREE.Quaternion();

// Upper-body bones (everything above the hips) — used to split the firing clip
// from locomotion so the legs can keep moving while the upper body fires.
const UPPER_BODY_BONE = /(Spine|Neck|Head|Shoulder|Arm|ForeArm|Hand)/i;

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
      this.healthBar = new HealthBar();
      this.scene.add(this.healthBar.sprite);
    }
  }

  setHealth(pct) {
    if (this.healthBar) this.healthBar.set(pct);
  }

  setAnimation() {
    this.animation = {};
    this.weaponMode = "hand"; // "hand" = character's own anims; "gun" = shooter pack

    this.animation.mixer = new THREE.AnimationMixer(this.avatar);
    this.animation.actions = {}; // base / hand-mode actions (the character's own clips)
    this.animation.gunActions = {}; // gun-mode actions (shooter-pack), filled on load
    this.animation.gunUpper = {}; // upper-body-only gun actions (firing overlay)
    this.animation.gunLower = {}; // lower-body-only gun actions (legs while firing)
    this.animation.upperAction = null; // active upper-body overlay, if any
    this.animation.clips = {};
    this.animation.currentName = null;
    this.animation.currentAction = null;

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

    this.animation.currentName = "idle";
    this.animation.currentAction = this.animation.actions.idle || null;
    if (this.animation.currentAction) this.animation.currentAction.play();

    this.animation.play = (name, fadeDuration = 0.2) => {
      // The death clip (from Dying.fbx) is added lazily the first time it's used.
      if (name === "dying" && !this.animation.actions.dying) this.ensureDying();

      // Run-and-gun: legs keep their walk/run while the upper body fires.
      if (name === "firing-run" || name === "firing-walk") {
        this._playFiringMove(name === "firing-run" ? "run" : "walk", fadeDuration);
        this.animation.currentName = name;
        return;
      }

      // Any normal state clears the upper-body firing overlay.
      this._setUpper(null);

      const newAction = this._actionFor(name);
      if (!newAction) return;
      if (
        this.animation.currentName === name &&
        this.animation.currentAction === newAction
      ) {
        return;
      }

      newAction.reset();
      const oldAction = this.animation.currentAction;
      if (oldAction && oldAction !== newAction) {
        newAction.crossFadeFrom(oldAction, fadeDuration, false);
      }
      newAction.play();

      this.animation.currentName = name;
      this.animation.currentAction = newAction;
    };

    this.animation.isCurrentDone = () => {
      const action = this.animation.currentAction;
      if (!action) return true;
      return action.time >= action.getClip().duration - 0.05;
    };

    this.animation.update = (time) => {
      this.animation.mixer.update(time);
    };

    // Capture the bind pose (each bone's local rotation + the hip position)
    // BEFORE any external clip is applied — used to retarget the shooter-pack
    // clips onto this skeleton and to restore the body after the death pose.
    this._bindQuats = {};
    this._hipsBone = null;
    this._hipsBind = null;
    this.avatar.traverse((o) => {
      if (!o.isBone) return;
      this._bindQuats[o.name] = o.quaternion.clone();
      if (!this._hipsBone && /Hips$/i.test(o.name)) {
        this._hipsBone = o;
        this._hipsBind = o.position.clone();
      }
    });

    // Apply shooter-pack clips (gun mode) now if loaded, and again on each load.
    registerAvatar(this);
  }

  // Pick the action for a canonical state name, honouring the weapon mode:
  // gun mode uses the shooter-pack action when available, else the base action.
  _actionFor(name) {
    if (this.weaponMode === "gun" && this.animation.gunActions[name]) {
      return this.animation.gunActions[name];
    }
    return this.animation.actions[name];
  }

  // Switch between "hand" (character's own anims) and "gun" (shooter pack incl.
  // the rifle idle), re-playing the current state in the new action set.
  setWeaponMode(mode) {
    if (mode !== "hand" && mode !== "gun") return;
    if (mode === this.weaponMode) return;
    this.weaponMode = mode;
    const name = this.animation && this.animation.currentName;
    if (name) {
      this.animation.currentName = null; // force a fresh crossfade into the new set
      this.animation.play(name, 0.2);
    }
  }

  // ─── run-and-gun layering (upper-body firing over lower-body locomotion) ─────

  // Clone a clip keeping only upper-body tracks (keepUpper) or only the rest.
  _maskClip(clip, keepUpper) {
    const c = clip.clone();
    c.tracks = c.tracks.filter((t) => {
      const isUpper = UPPER_BODY_BONE.test(t.name);
      return keepUpper ? isUpper : !isUpper;
    });
    return c;
  }

  // Fade an upper-body overlay action in (or null to fade the current one out).
  _setUpper(action) {
    const cur = this.animation.upperAction || null;
    if (cur === action) return;
    if (cur) cur.fadeOut(0.15);
    if (action) {
      action.reset();
      action.setEffectiveWeight(1);
      action.fadeIn(0.15);
      action.play();
    }
    this.animation.upperAction = action || null;
  }

  // Play lower-body walk/run + the upper-body firing overlay simultaneously.
  _playFiringMove(locoName, fade = 0.2) {
    const lower = this.animation.gunLower[locoName];
    const upper = this.animation.gunUpper.firing;

    // Clips not split yet (still loading) → fall back to full-body firing.
    if (!lower || !upper) {
      this._setUpper(null);
      const f = this._actionFor("firing");
      if (f && this.animation.currentAction !== f) {
        f.reset();
        if (this.animation.currentAction) {
          f.crossFadeFrom(this.animation.currentAction, fade, false);
        }
        f.play();
        this.animation.currentAction = f;
      }
      return;
    }

    if (this.animation.currentAction !== lower) {
      lower.reset();
      if (this.animation.currentAction) {
        lower.crossFadeFrom(this.animation.currentAction, fade, false);
      }
      lower.play();
      this.animation.currentAction = lower;
    }
    this._setUpper(upper);
  }

  // Clear the death pose so the avatar stands again on respawn.
  resetFromDeath() {
    if (this.animation?.actions?.dying) this.animation.actions.dying.stop();
    if (this._hipsBone && this._hipsBind) {
      this._hipsBone.position.copy(this._hipsBind);
    }
    if (this.animation) {
      if (this.animation.upperAction) {
        this.animation.upperAction.stop();
        this.animation.upperAction = null;
      }
      this.animation.currentName = null; // next play() starts fresh
      this.animation.currentAction = null;
    }
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

  // Lazily add the "dying" action from the shared Dying.fbx clip (if loaded),
  // retargeted onto this character's own skeleton.
  ensureDying() {
    if (this.animation.actions.dying) return;
    const clip = getDyingClip();
    if (!clip) return;

    // Keep the (scaled) hip translation so the body drops to the ground.
    const retargeted = this._retargetClip(clip, this.avatar, { keepPosition: true });
    if (!retargeted) return;
    retargeted.name = "dying";

    const action = this.animation.mixer.clipAction(retargeted);
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;

    this.animation.clips.dying = retargeted;
    this.animation.actions.dying = action;
  }

  // Remap a Mixamo clip's bone names onto this avatar's skeleton by swapping the
  // bone-name prefix (e.g. "mixamorig:" → "mixamorig12:" or ""). Keeps only
  // rotation tracks so the FBX's centimetre-scale root translation can't fling
  // the body across the map — the character crumples in place.
  _retargetClip(clip, root, { keepPosition = false, sourceBind = null } = {}) {
    // Avatar's bone prefix + bind hip height (in the avatar's own units).
    let avatarPrefix = null;
    let avatarHipY = null;
    root.traverse((o) => {
      if (avatarPrefix === null && o.isBone && /Hips$/i.test(o.name)) {
        avatarPrefix = o.name.replace(/Hips$/i, "");
        avatarHipY = o.position.y;
      }
    });
    if (avatarPrefix === null) return null;

    // Clip's bone prefix (e.g. "mixamorig") from a Hips track name.
    let clipPrefix = null;
    for (const t of clip.tracks) {
      const m = t.name.match(/^(.*?)Hips\./i);
      if (m) {
        clipPrefix = m[1];
        break;
      }
    }

    // Scale factor that maps the clip's hip units onto this avatar's, derived
    // from the standing hip height so it works regardless of the source scale.
    let posScale = 1;
    if (keepPosition && avatarHipY != null) {
      const hp = clip.tracks.find((t) => /Hips\.position$/i.test(t.name));
      if (hp && hp.values.length >= 2 && hp.values[1] !== 0) {
        posScale = avatarHipY / hp.values[1];
      }
    }

    const out = clip.clone();
    // Which tracks to keep:
    //  • dying (keepPosition): every rotation + the (scaled) hip position so the
    //    body falls to the ground.
    //  • locomotion/gun: every rotation; the Hips rotation is kept only when we
    //    can properly retarget it (sourceBind given). Without sourceBind the
    //    Hips rotation is dropped — its raw FBX↔glTF up-axis offset would pitch
    //    the whole character ~90° forward. All non-hip positions are dropped.
    out.tracks = out.tracks.filter((t) => {
      if (/Hips\.position$/i.test(t.name)) return keepPosition;
      if (/\.position$/i.test(t.name)) return false;
      if (/Hips\.quaternion$/i.test(t.name)) return keepPosition || !!sourceBind;
      return t.name.endsWith(".quaternion");
    });

    for (const t of out.tracks) {
      const sourceName = t.name; // before prefix remap (matches sourceBind keys)
      if (clipPrefix !== null && t.name.startsWith(clipPrefix)) {
        t.name = avatarPrefix + t.name.slice(clipPrefix.length);
      }

      if (t.name.endsWith(".position")) {
        if (keepPosition && posScale !== 1) {
          for (let i = 0; i < t.values.length; i++) t.values[i] *= posScale;
        }
        continue;
      }

      // Proper rotation retarget: re-express the source's local rotation as a
      // delta from the SOURCE bind, then apply it onto the TARGET bind. This
      // cancels bind-pose differences between the FBX rig and this skeleton
      // (the slight lean / yaw) and the root up-axis offset:
      //   newLocal = targetBind * inverse(sourceBind) * clipLocal
      if (sourceBind && this._bindQuats) {
        const targetBone = t.name.replace(/\.quaternion$/i, "");
        const sourceBone = sourceName.replace(/\.quaternion$/i, "");
        const tb = this._bindQuats[targetBone];
        const sb = sourceBind[sourceBone];
        if (tb && sb) {
          _qTarget.copy(tb);
          _qSrcInv.copy(sb).invert();
          const v = t.values;
          for (let i = 0; i < v.length; i += 4) {
            _qWork.set(v[i], v[i + 1], v[i + 2], v[i + 3]);
            _qWork.premultiply(_qSrcInv).premultiply(_qTarget);
            v[i] = _qWork.x;
            v[i + 1] = _qWork.y;
            v[i + 2] = _qWork.z;
            v[i + 3] = _qWork.w;
          }
        }
      }
    }
    return out;
  }

  // Replace a canonical action with an external (shooter-pack) clip, retargeted
  // onto this skeleton. Used for walk / run / running-jump / firing. Rotation-
  // only so physics-driven movement doesn't fight the clip's root motion.
  applyExternalClip(name, clip, sourceBind = null) {
    if (!this.animation) return;
    const retargeted = this._retargetClip(clip, this.avatar, { sourceBind });
    if (!retargeted) return;
    retargeted.name = `${name}-gun`;

    const action = this.animation.mixer.clipAction(retargeted);
    if (name === "running-jump") {
      action.setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
    }
    this.animation.gunActions[name] = action;

    // Masked variants for run-and-gun layering: an upper-body-only firing clip
    // and lower-body-only walk/run so the legs keep moving while the upper body
    // fires (disjoint bone sets → they combine without blending conflicts).
    if (name === "firing") {
      const up = this._maskClip(retargeted, true);
      up.name = "firing-upper";
      this.animation.gunUpper.firing = this.animation.mixer.clipAction(up);
    } else if (name === "walk" || name === "run") {
      const low = this._maskClip(retargeted, false);
      low.name = `${name}-lower`;
      this.animation.gunLower[name] = this.animation.mixer.clipAction(low);
    }

    // If we're in gun mode and currently in this state, swap to the new action.
    if (this.weaponMode === "gun" && this.animation.currentName === name) {
      const old = this.animation.currentAction;
      if (old && old !== action) old.stop();
      action.reset().play();
      this.animation.currentAction = action;
    }
  }
}
