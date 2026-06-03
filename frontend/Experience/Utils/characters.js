/**
 * Character roster — the single source of truth for selectable player models.
 *
 * Each entry:
 *   { id, label, file? }
 *     id    – unique key. Used as the asset name AND the value broadcast over
 *             the network as `avatarSkin`. Must be filesystem/URL safe.
 *     label – pretty name shown on the Welcome Screen character selector.
 *     file  – OPTIONAL. The .glb filename in public/models/. Defaults to
 *             `${id}.glb`. Set this only when the file name differs from the id.
 *
 * The roster drives BOTH:
 *   • asset loading  (Utils/assets.js maps each entry to a glbModel asset), and
 *   • the in-menu character cycle button (WelcomeScreen.js).
 *
 * ── Adding a Mixamo character (full steps in CHARACTERS.md) ──────────────────
 *   1. Export a single .glb containing the clips idle / walk / run / jump
 *      (+ optional running-jump) and drop it in public/models/.
 *      Clip names are case-insensitive and fuzzy-matched, so Mixamo's default
 *      "Idle" / "Walking" / "Running" / "Jump" work as-is. running-jump falls
 *      back to the jump clip when absent. (See Avatar.js > setAnimation.)
 *   2. Add ONE line below. That's it.
 */
export default [
    { id: "mike", label: "Mike" },
    { id: "monster", label: "Monster" },
    { id: "brute", label: "Brute" },
    { id: "asian_male_animated", label: "Vic" },
    { id: "asian_female_animated", label: "Nova" },

    // Add your downloaded Mixamo characters here, e.g.:
    // { id: "ninja", label: "Ninja" },
    // { id: "vanguard", label: "Vanguard", file: "vanguard_mixamo.glb" },
];
