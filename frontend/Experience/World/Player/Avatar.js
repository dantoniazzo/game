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
        this.avatar.scale.set(0.99, 0.99, 0.99);
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

        for (const clip of this.avatar.animations) {
            this.animation.clips[clip.name] = clip;
            const action = this.animation.mixer.clipAction(clip);

            if (JUMP_ANIMS.includes(clip.name)) {
                action.setLoop(THREE.LoopOnce, 1);
                action.clampWhenFinished = true;
            }

            this.animation.actions[clip.name] = action;
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
}
