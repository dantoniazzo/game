import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

// Loads the Mixamo death animation (Dying.fbx) once, lazily. It is intentionally
// NON-FATAL: if the file is missing the game just skips the death animation (the
// player still dies + respawns). To enable it, drop Dying.fbx into
// public/models/  (see CHARACTERS.md / CLAUDE.md).
//
// Avatar._retargetClip() remaps the clip's bone names onto each character's own
// skeleton, so one Mixamo clip works across all the rigs.

let _clip = null;
let _state = "idle"; // "idle" | "loading" | "ready" | "failed"

export function loadDyingAnimation(url = "/models/dying.fbx") {
    if (_state !== "idle") return;
    _state = "loading";

    new FBXLoader().load(
        url,
        (fbx) => {
            _clip = (fbx.animations && fbx.animations[0]) || null;
            _state = _clip ? "ready" : "failed";
            if (!_clip) {
                console.warn("dying.fbx loaded but contains no animation clip.");
            }
        },
        undefined,
        () => {
            _state = "failed";
            console.warn(
                `Dying.fbx not found at ${url} — death animation disabled. ` +
                "Copy it into public/models/ to enable it."
            );
        }
    );
}

export function getDyingClip() {
    return _clip;
}
