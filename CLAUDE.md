# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository. It doubles as a **handoff document**: it is written so a fresh session (e.g. on another device) can pick up with zero prior context.

> **Last substantive update:** 2026-06-02 — added the **GTA VI–style Welcome Screen / main menu** (the new entry point). See the [Welcome Screen / Main Menu](#welcome-screen--main-menu) section; that is the most recent work and the most likely thing to keep iterating on. The prior feature was the **Park / custom-shader grass / daytime environment** ([section](#park-grass--daytime-environment)).

---

## Commands

```bash
# Development (runs Vite in build-watch mode + nodemon server concurrently)
npm run dev

# Frontend only (HMR dev server, no Express)
npm run frontend-dev

# Backend only
npm run backend-dev

# Production build (outputs to dist/)
npm run prod-build
```

There is no test suite and no linter configured. **Verification = it builds + reads correctly.** To confirm a change compiles without disturbing `dist/`:

```bash
npx vite build --outDir /tmp/check --emptyOutDir   # look for "✓ N modules transformed" / "✓ built in …"
node --check path/to/file.js                        # quick per-file syntax check
```

> **Build gotcha (sandbox only):** `npm run prod-build` / `npx vite build` empties `dist/` first. In a restricted sandbox this throws `EPERM … unlink dist/.DS_Store`. That is an environment permission quirk on the macOS `.DS_Store` file, **not a code error** — the modules still transform successfully, and on the real machine the build completes normally. Build to a temp `--outDir` to verify cleanly.

---

## Architecture

A real-time multiplayer 3D game: a Vite/Three.js frontend bundled into `dist/`, served by an Express + Socket.io backend (`server.js`). Physics for the drivable vehicle uses Rapier (WASM); player + scenery collision uses a Three.js Octree. **There are two independent collision systems — see [Collision systems](#collision-systems).**

### Frontend (`frontend/`)

Entry point: `frontend/index.js` — sets up two Socket.io namespaces (`/chat`, `/update`), creates the `Experience` singleton, and wires up the chat UI.

**Experience singleton** (`Experience/Experience.js`) — classic Three.js "experience" pattern. Instantiated once; subsequent `new Experience()` calls return the same instance. Holds: `scene`, `camera`, `renderer`, `resources`, `time`, `sizes`, `world`. All subsystems grab the singleton via `new Experience()`. Its `update()` is the single `requestAnimationFrame` loop and calls, in order: `welcomeScreen`, `camera`, `renderer`, `world`, `time`.

**Subsystem hierarchy:**
```
Experience
├── Sizes          – window resize tracking
├── Time           – delta-time loop; Time.delta is in SECONDS (capped at 60)
├── Resources      – asset loader (GLB models, textures) — emits "ready"
├── WelcomeScreen  – GTA-VI-style main menu / entry point (replaces Preloader)
├── Camera         – PerspectiveCamera (fov 75, near 0.001, far 1000) + input mode:
│   ├── Desktop: pointer-lock, spherical-coord third-person orbit (camera.target)
│   └── Mobile:  OrbitControls (nipplejs joystick); camera.controls.target
├── Renderer       – THREE.WebGLRenderer (SRGB output, NoToneMapping, pixelRatio≤1.5)
└── World
    ├── Octree     – player/scenery collision (Three.js Octree)
    ├── rapierWorld– vehicle physics (Rapier, async WASM init)
    ├── Player     – local player controller
    │   ├── Avatar – cloned GLB + AnimationMixer per skin
    │   └── Nametag
    ├── Environment– sky + lights (now DAYTIME)
    ├── CityBlock  – procedural city grid (roads, buildings, lamps)
    ├── Park       – grass park (NEW)
    ├── Vehicle    – drivable Rapier raycast car
    └── Compass
```

**World bootstrap order** (`World.js`) — important because Park/CityBlock depend on it:
1. Constructor creates the `Octree` and kicks off `_initRapier()` (async: `RAPIER.init()`, build `rapierWorld` with gravity + a fixed ground collider cuboid `160×0.25×160` at `y=-0.25`).
2. On `resources "ready"`: `createGround()` (invisible `320×0.5×320` Octree box at `y=-0.25`), then `new Player()`, `new Environment()`, `new Compass()`. Sets `_resourcesReady`, calls `_tryCreateVehicle()`.
3. `_tryCreateVehicle()` runs only when **both** Rapier and resources are ready. It creates `CityBlock` (passing `rapierWorld` + `parkRegions`), then `Park` (passing `rapierWorld` + `region`), then the `Vehicle` (spawns at `(25, 2, 0)`), and hands the vehicle to the Player.
4. `World.update()` ticks `player`, `vehicle`, `compass`, and `park` every frame.

**Player spawn:** the player capsule starts at the **origin `(0, 2, 0)`** (`Player.js`, `new Capsule(...)`), with a respawn point at `(0, 3, 0)`. On vehicle exit the player is teleported beside the car. The park's south-west corner sits ~10 units from origin, so it is immediately visible on spawn.

#### Collision systems

| System | Library | Blocks | How scenery registers |
| --- | --- | --- | --- |
| **Octree** | `three/examples/jsm/math/Octree` | the **player** capsule | add invisible meshes to a `THREE.Group`, `group.updateMatrixWorld(true)`, then `octree.fromGraphNode(group)` |
| **Rapier** | `@dimforge/rapier3d-compat` | the **vehicle** | `rapierWorld.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(…))` + `createCollider(RAPIER.ColliderDesc.cuboid/cylinder(…), rb)` |

New solid scenery that should stop **both** the player and the car must register with **both** systems. `CityBlock` does this for buildings and lamps; `Park` does it for trees (benches are Octree-only — see [next steps](#current-state--possible-next-steps)).

**Player movement:** `Player.update()` runs each frame — movement impulse → `updateColliderMovement()` → capsule collision → camera target copy → avatar position/rotation sync → animation state machine (`updateDesiredAnimation()`). Desktop mouse input is accumulated via `mousemove` + a 50 ms timeout to zero it. Mobile uses the nipplejs joystick.

**Animation state machine** (inside `Avatar`): actions stored by clip name. `play(name, fadeDuration)` crossfades from the current action. Jump animations (`jump`, `running-jump`) use `LoopOnce` + `clampWhenFinished`. Standing jumps use a frame counter; running/walking jumps use `jumpReady` + `liftoffFrames`.

**Multiplayer sync:** the `/update` namespace ticks at ~50 Hz. Each client emits `updatePlayer` every 20 ms (position, quaternion, animation, avatar skin). The server broadcasts `playerData` (all connected players) back to every socket. `Player.setPlayerSocket()` creates `Avatar` instances for new remote players and updates them in `updateOtherPlayers()`.

**Asset loading** (`Utils/assets.js`): exports an array of asset-group objects keyed by scene name (currently only `westgate`). Each asset is `{ name, type, path }` where `type` ∈ `glbModel | imageTexture | cubeTexture | videoTexture`. `Resources` loads them all, stores them on `resources.items[name]`, and emits `"ready"`. Textures live under `public/` (served verbatim; reference them **without** a leading `dist/`).

### Backend (`server.js`)

Two Socket.io namespaces:
- `/chat` — broadcast messages between clients.
- `/update` — maintains a `connectedSockets` Map; a 20 ms `setInterval` per socket broadcasts the full player list. Only players with both `name` and `avatarSkin` set are included.

### Vite config

- Root: `frontend/`; Public dir: `public/` (copied verbatim to `dist/`); Output: `dist/`.
- `VITE_SERVER_URL` overrides the socket URL (defaults to `window.location.href`).
- `node_modules` are split into separate chunks by package name. Rapier is the largest chunk (~2.2 MB) — expect the "chunk larger than 1600 kB" warning; it is benign.

### Renderer / colour notes

`Renderer.js` uses `outputColorSpace = SRGBColorSpace` and `toneMapping = NoToneMapping`. The grass material sets `toneMapped: false` and ends its fragment shader with `#include <tonemapping_fragment>` + `#include <colorspace_fragment>`, so it manages its own colour conversion and is consistent with the renderer. **There are no real-time shadow maps** — directional light does not cast shadows; the moving "cloud shadows" on the grass are faked entirely in the grass fragment shader.

---

## Welcome Screen / Main Menu

The game's **entry point**. A full-screen, GTA-VI-styled neon menu that shows on
load and hands off to the live game when the player starts. It **replaces** the
old `Preloader` name-input flow (which auto-picked the `mike` skin).

### Files

| File | Role |
| --- | --- |
| `Experience/WelcomeScreen.js` | **NEW.** The whole menu: markup, inline SVG art (palms + "VI" logo), keyboard/mouse nav, the shared overlay card, and the start-game handoff. |
| `styles/components/welcomescreen.scss` | All visuals — sunset gradient, palm silhouettes, gradient logo, neon menu, loading dots, overlay card. Imported in `index.scss`. |
| `Experience/Experience.js` | Now does `setWelcomeScreen()` (was `setPreloader()`) and ticks `welcomeScreen.update()`. |
| `Experience/Preloader.js` | **Dormant** — no longer imported (kept on disk, like `CharacterSelect.js`). |

### Look
Sunset gradient (burnt-orange → magenta → deep purple) + animated pink glow,
two CSS-mirrored **palm-tree silhouettes** (one inline SVG, flipped via
`scaleX(-1)`), a gradient **"VI"** logo (SVG `<text>`, blue→magenta→pink→orange,
white outline + neon drop-shadow) with a **"grand theft auto"** wordmark, faint
grain + vignette. Fonts: **Anton** (loaded from Google Fonts) for the logo/titles;
the project's **Gilroy** (heavy italic) for menu items + buttons.

### Menu & behaviour
Items: **Start Game, Settings, Online, Social Club, Quit Game**. Navigate with
`↑/↓` or `W/S`, activate with `Enter`/`Space`, or mouse hover + click; `Esc`
closes an open card.
- **Start Game** → `startGame()` with a random `Player####` name.
- **Online** → opens the shared overlay card with a username `<input>`; submit (non-empty) → `startGame(username)`. Empty input shake-animates.
- **Settings / Social Club** → open the shared card as themed **"Coming Soon"** placeholders (no real functionality yet).
- **Quit Game** → `quitGame()` calls `window.close()` (only succeeds for script-opened tabs); when the browser blocks it, it falls back to a "close the tab manually" card.

The menu stays in a **LOADING** state (animated dots) until `resources` emit
`"ready"`; that adds `.is-ready` to `.gta-screen`, which fades/staggers the menu
in. `startGame(name)` mirrors the old Preloader handoff exactly: `socket.emit("setName", name)` + `socket.emit("setAvatar", "mike")`, then `camera.pointerLockEnabled = true`, then fades the overlay out (`.is-leaving`) and removes it after 1 s. Re-entry is guarded by a `_started` flag.

### Knobs / next steps
- Menu items + their actions live in the `MENU` array at the top of `WelcomeScreen.js`; the default skin is `DEFAULT_SKIN = "mike"` (only `mike`/`monster` exist — see `assets.js`).
- Colours/animation timings are SCSS vars at the top of `welcomescreen.scss` (`$gta-pink`, `$gta-purple`, …).
- Possible follow-ups: wire **Settings** to real controls (music toggle — there's `#myAudio` + the `=` key in `index.js` — and `camera.MOUSE_SENSITIVITY`); let **Start Game** route through the dormant `CharacterSelect`; play menu music on first interaction.

---

## Park, Grass & Daytime Environment

The most recent feature. Logic was ported from an external three.js sketch (`sketches/nature/grass`, not in this repo) that renders instanced grass blades with a custom shader and animated cloud-shadow darkening. The goal: bring that grass + environment into the live city and drop a park into it.

### What it looks like
A ~**106 × 106** unit green space occupying a **2 × 2 block** chunk of the city near spawn (centre `(60, 60)`), bounded by the surrounding roads. It has a textured ground, a **cross path + central circular plaza**, ~30 procedural low-poly **trees**, **benches**, and a field of **~450 000 animated grass blades** with cloud shadows drifting across them. The whole city is lit as **daytime**.

### File map

| File | Role |
| --- | --- |
| `World/Park/GrassMaterial.js` | **The cloud-shadow grass `ShaderMaterial`** actually used by the park. Pre-existing — *do not rewrite without reason.* Uniforms: `uTime`, `uBladeHeight`, `uCloud`, `alphaMap`. Fragment shader samples `uCloud` at `vPosition/90` scrolled by `uTime` to darken blades (the cloud shadow). Vertex shader bends blades via per-instance quaternion + simplex-noise wind. |
| `World/Park/Park.js` | **NEW.** The park system: ground, paths, grass field, trees, benches, colliders, per-frame `uTime` update. |
| `World/Grass.js` | Exports **`GrassGeometry`** (the `InstancedBufferGeometry` the park uses) **and a separate legacy `GrassMaterial`** (no cloud shadows — *not* the one the park uses). Don't confuse the two `GrassMaterial` classes. |
| `World/GrassWorld.js` | Standalone reference world: chunked, infinite, noisy-terrain grass demo. **Not wired into the live game** — reference only. |
| `World/CityBlock.js` | Procedural city. Now accepts `parkRegions` and omits buildings/street-furniture inside them. |
| `World/Environment.js` | Sky + lights. Switched from night to daytime. |
| `World/World.js` | Defines `PARK_REGION`, wires `CityBlock` + `Park`, calls `park.update()`. |
| `Utils/assets.js` | Loads three relevant textures: `cloudTexture` (`textures/cloud.jpg`), `grassBladeAlpha` (`textures/grass-blade-alpha.jpg`), `parkGround` (`textures/baked/grass.jpg`). |

### `GrassGeometry` (in `Grass.js`)
A single `InstancedBufferGeometry` = one draw call for the whole field. Base geometry is `PlaneGeometry(bladeWidth, bladeHeight, 1, bladeJoints)` translated up by `bladeHeight/2`. Per-instance attributes: `offset` (vec3 world pos), `orientation` (vec4 quaternion), `stretch` (float), `halfRootAngleSin`/`halfRootAngleCos` (float), `baseColor`/`middleColor`/`tipColor` (vec3). A bounding sphere is derived from `area` so frustum culling works.

Constructor options:
```js
new GrassGeometry({
  bladeWidth, bladeHeight, bladeJoints, instances,
  getGroundHeight,                  // (x, z) => y  — where each blade base sits
  area: { minX, maxX, minZ, maxZ }, // sampling rectangle
  mask,                             // OPTIONAL (x, z) => boolean
})
```
`mask` returns **true to keep** grass, false to leave bare (used to carve the paths). Rejected samples are retried up to 8× so the surrounding lawn keeps its density; only after 8 misses is an instance skipped. This was added specifically for the park — keep it backward-compatible (it's optional).

### `Park.js` internals
- `_pathMask(x, z)` → returns false on the two cross-path arms (`|x-cx| < PATH_HALF` or `|z-cz| < PATH_HALF`) and inside the central plaza radius; true elsewhere. Passed as `mask` to `GrassGeometry` **and** reused to keep trees/benches off the path.
- `_buildGround()` — textured plane (`parkGround`, `RepeatWrapping`, repeat = size/10), `MeshStandardMaterial`. Sits at `GROUND_Y` so it covers the interior road that runs under the park.
- `_buildPaths()` — two `PlaneGeometry` arms + a `CircleGeometry` plaza, drawn slightly above the ground.
- `_buildGrass()` — instantiates `GrassMaterial` (from `./GrassMaterial.js`), wires `uCloud = resources.items.cloudTexture` (RepeatWrapping), `alphaMap = resources.items.grassBladeAlpha`, `uBladeHeight = BLADE_HEIGHT`, then builds the `GrassGeometry` over the region (inset 1.5 so blades don't spill onto the bordering road) with `mask = _pathMask`.
- `_buildTrees()` — formal tree rows lining the path + scattered clusters per quadrant; each tree = `TRUNK_GEO` cylinder + 3 stacked `IcosahedronGeometry` canopy lumps (random scale/rotation, flat-shaded). Registers an **Octree box** and a **Rapier cylinder** collider per tree.
- `_buildBenches()` — box seat/back/legs along the paths; **Octree collider only**.
- `update()` — `elapsedTime += time.delta` (seconds); sets `grassMaterial.uniforms.uTime.value`. Called from `World.update()`.

### Tuning knobs — `Park.js` constants (top of file)

| Constant | Current | Meaning / effect |
| --- | --- | --- |
| `BLADE_WIDTH` | `0.035` | blade width |
| `BLADE_HEIGHT` | `0.2` | blade height (also fed to `uBladeHeight`; keep them equal) |
| `BLADE_JOINTS` | `4` | vertical segments per blade (bend smoothness) |
| `GRASS_BLADES` | `450000` | total instances = density. One draw call, but heavy on mobile |
| `GROUND_Y` | `0.06` | park ground height — must stay **above** road markings (≤0.07) so it hides the covered interior road |
| `PATH_HALF` | `2.2` | half-width of each cross-path arm |
| `PLAZA_R` | `7.0` | central plaza radius |

> History: blades were originally `0.07 × 0.4` at `200000` instances; the user asked to halve blade size and increase density → current `0.035 × 0.2` at `450000`. To go denser, raise `GRASS_BLADES`; for a taller meadow, raise `BLADE_HEIGHT` (and it auto-updates `uBladeHeight`).

### Park placement — `PARK_REGION` (in `World.js`)
```js
const PARK_REGION = { minX: 7, maxX: 113, minZ: 7, maxZ: 113 };
```
A world-space rectangle. The same object is passed to **both** `CityBlock` (as `parkRegions: [PARK_REGION]`, to omit furniture) and `Park` (as `region`, to fill it). To **move/resize the park**, edit this one constant and keep its edges aligned to road inner edges: roads sit on `ROAD_GRID = [-120, -60, 0, 60, 120]` with `ROAD_HALF = 7`, so a clean park edge is `ROAD_GRID[i] ± 7`. The current rect spans the roads at `x = 0/120` and `z = 0/120`, enclosing the four blocks centred at `(30,30) (90,30) (30,90) (90,90)` plus the interior road crossing at `(60,60)`.

### CityBlock reservation (`CityBlock.js`)
Constructor now takes `{ rapierWorld, parkRegions }`. `_inPark(x, z)` tests the rectangles. Anything whose position falls inside is **skipped**: buildings (per building centre), sidewalk segments, road centre-lines, lane dashes, crosswalk bars, and lamp posts. **The road asphalt planes themselves are *not* cut** (they're long merged strips) — the interior road is simply hidden under the park's raised ground plane, which is why `GROUND_Y` must sit above the road markings. The big world ground plane and the perimeter roads stay intact and border the park.

### Daytime environment (`Environment.js`)
Replaced the old near-black night scene. Now: `scene.background = #a9cdf0` (sky blue); a `HemisphereLight(#bfe0ff sky, #5e6b48 ground, 0.95)`; a low `AmbientLight(0.25)` fill; a warm `DirectionalLight(#fff3df, 1.7)` high at `(60, 90, 40)`. **No `scene.fog`** — the raw-`ShaderMaterial` grass ignores fog, so adding fog would make the grass visibly not fade while everything else does. `CharacterSelect.js` temporarily swaps the background/lights during character selection and restores them afterward (it saves `scene.background`/`scene.fog` and disposes its own lights), so it stays compatible.

---

## Adding a new world / scene

1. Add asset entries to `frontend/Experience/Utils/assets.js` (under the active scene key, currently `westgate`).
2. Create a world class (e.g. `World/MyWorld.js`).
3. Instantiate it from `World.js` after `resources` emits `"ready"` (and, if it needs Rapier colliders, from inside `_tryCreateVehicle()` like `CityBlock`/`Park`).
4. Add collidable meshes to `this.octree` via `octree.fromGraphNode(mesh)` after `mesh.updateMatrixWorld(true)`; add Rapier colliders too if the vehicle should collide.
5. If the class needs per-frame updates, call its `update()` from `World.update()`.

---

## Conventions & gotchas

- `Time.delta` is in **seconds** (capped at 60). Animations/shaders accumulate seconds.
- Desktop vs mobile camera target differ: desktop uses `camera.target`; mobile uses `camera.controls.target`. Code that needs the player's look point must handle both (see `GrassWorld.getPlayerPosition`).
- Textures live in `public/` and are referenced by path without `dist/`. `parkGround` reuses `public/textures/baked/grass.jpg`.
- Two `GrassMaterial` classes exist (`Grass.js` legacy, `Park/GrassMaterial.js` cloud-shadow). The park uses the latter. Don't cross them up.
- Grass renders unlit (`toneMapped:false`, ignores scene lights) — it stays visible regardless of the environment lighting; only the city/trees/benches respond to the lights.
- The `EPERM unlink dist/.DS_Store` build error is sandbox-only; verify via `--outDir /tmp/...`.

## Current state & possible next steps

The feature is complete and builds clean (76 modules transformed). Open items a future session might tackle:
- **Bench Rapier colliders** — benches currently block only the player (Octree), not the car. Add fixed cuboid Rapier colliders in `_makeBench` if needed.
- **Mobile performance** — 450 k blades is one draw call but vertex-heavy. Consider lowering `GRASS_BLADES` when `experience.camera.isMobile`, or distance-based culling/LOD.
- **Multiple parks** — `CityBlock` already accepts an array of regions; `World` passes `[PARK_REGION]`. `Park` currently takes a single `region`, so multiple parks = one `Park` per region (or refactor `Park` to accept several).
- **Grass base brightness** — the fragment shader mixes by `cloudPos.y` (≈0 on flat ground → ~0.7 darken). If the lawn looks too dark, that factor in `Park/GrassMaterial.js` is the knob.
- **Procedural → assets** — trees/benches are basic geometry; could swap for GLB models loaded via `Resources`.
