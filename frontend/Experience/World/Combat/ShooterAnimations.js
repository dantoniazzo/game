import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

// Loads ONLY the shooter-pack clips the game actually uses, each mapped to a
// canonical animation-state name. Avatars register themselves; when a clip
// finishes loading it is applied (retargeted) to every registered avatar, so
// load order doesn't matter. Files live in public/models/shooter-pack/.
const SOURCES = {
    idle: "/models/shooter-pack/rifle aiming idle.fbx",
    walk: "/models/shooter-pack/walking.fbx",
    run: "/models/shooter-pack/rifle run.fbx",
    "running-jump": "/models/shooter-pack/jump forward.fbx",
    firing: "/models/shooter-pack/firing rifle.fbx",
};

const _clips = {};
const _binds = {}; // source rig bind pose per clip (for retargeting)
const _avatars = new Set();
let _started = false;

export function loadShooterAnimations() {
    if (_started) return;
    _started = true;

    const loader = new FBXLoader();
    for (const [name, url] of Object.entries(SOURCES)) {
        loader.load(
            encodeURI(url), // filenames contain spaces
            (fbx) => {
                const clip = fbx.animations && fbx.animations[0];
                if (!clip) return;
                // Capture the source rig's bind pose so avatars can retarget the
                // clip onto their own skeleton (cancels bind-pose differences).
                const bind = {};
                fbx.traverse((o) => {
                    if (o.isBone) bind[o.name] = o.quaternion.clone();
                });
                _clips[name] = clip;
                _binds[name] = bind;
                for (const av of _avatars) av.applyExternalClip(name, clip, bind);
            },
            undefined,
            () => console.warn(`Shooter animation missing: ${url}`)
        );
    }
}

export function registerAvatar(avatar) {
    _avatars.add(avatar);
    // Apply whatever has already loaded.
    for (const name in _clips) {
        avatar.applyExternalClip(name, _clips[name], _binds[name]);
    }
}

export function unregisterAvatar(avatar) {
    _avatars.delete(avatar);
}
