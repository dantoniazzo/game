# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with this repository.

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

There is no test suite and no linter configured.

## Architecture

This is a real-time multiplayer 3D game: a Vite/Three.js frontend bundled into `dist/`, served by an Express + Socket.io backend (`server.js`).

### Frontend (`frontend/`)

Entry point: `frontend/index.js` — sets up two Socket.io namespaces (`/chat`, `/update`), creates the `Experience` singleton, and wires up the chat UI.

**Experience singleton** (`Experience/Experience.js`) — classic Three.js "experience" pattern. Instantiated once; subsequent `new Experience()` calls return the same instance. Holds: `scene`, `camera`, `renderer`, `resources`, `time`, `sizes`, `world`. All subsystems grab the singleton via `new Experience()`.

**Subsystem hierarchy:**
```
Experience
├── Sizes          – window resize tracking
├── Time           – delta-time loop (requestAnimationFrame)
├── Resources      – asset loader (GLB models, textures) — emits "ready"
├── Preloader      – loading screen UI
├── Camera         – PerspectiveCamera + input mode:
│   ├── Desktop: pointer-lock, spherical-coord third-person orbit
│   └── Mobile:  OrbitControls (nipplejs joystick)
├── Renderer       – THREE.WebGLRenderer
└── World
    ├── Octree     – collision geometry (Three.js Octree)
    ├── Player     – local player controller
    │   ├── Avatar – cloned GLB + AnimationMixer per skin
    │   └── Nametag
    ├── Environment
    └── Compass
```

**Collision system:** `World.createGround()` builds an invisible `BoxGeometry` collider and feeds it into a Three.js `Octree`. `Player` uses a `Capsule` against this octree every frame (`playerCollisions()`). Additional collidable geometry (e.g. buildings) must also be added via `octree.fromGraphNode(mesh)`.

**Player movement:** `Player.update()` runs each frame — movement impulse → `updateColliderMovement()` → capsule collision → camera target copy → avatar position/rotation sync → animation state machine (`updateDesiredAnimation()`). Desktop mouse input is accumulated via `mousemove` + a 50 ms timeout to zero it (no pointer-lock `mousemove` fires after release). Mobile uses the nipplejs joystick.

**Animation state machine** (inside `Avatar`): actions are stored by clip name. `play(name, fadeDuration)` crossfades from the current action. Jump animations (`jump`, `running-jump`) use `LoopOnce` + `clampWhenFinished`. Standing jumps use a frame counter (`standingJump`); running/walking jumps use `jumpReady` + `liftoffFrames` to decouple the physics impulse from the animation.

**Multiplayer sync:** The `/update` namespace ticks at ~50 Hz from the server (`setInterval` 20 ms). Each client emits `updatePlayer` every 20 ms with position, quaternion, animation, and avatar skin. The server broadcasts `playerData` (all connected players) back to every socket in the namespace. `Player.setPlayerSocket()` handles `playerData` by creating `Avatar` instances for new remote players and updating positions/rotations each frame in `updateOtherPlayers()`.

**Asset loading** (`Utils/assets.js`): exports an array of asset-group objects. Each entry is keyed by scene name (e.g. `westgate`) and contains an `assets` array of `{ name, type, path }` objects. `Resources` loads them all before emitting `"ready"`.

### Backend (`server.js`)

Two Socket.io namespaces:
- `/chat` — broadcast messages between clients.
- `/update` — maintains a `connectedSockets` Map; a `setInterval` loop (20 ms) on each connected socket broadcasts the full player list. Only players with both `name` and `avatarSkin` set are included.

### Vite config

- Root: `frontend/`
- Public dir: `public/` (static assets copied verbatim to `dist/`)
- Output: `dist/`
- `VITE_SERVER_URL` env var overrides the socket connection URL (defaults to `window.location.href`).
- Node modules are split into separate chunks by package name.

### Adding a new world / scene

1. Add asset entries to `frontend/Experience/Utils/assets.js`.
2. Create a world class (e.g. `World/MyWorld.js`) similar to `GrassWorld.js`.
3. Instantiate it from `World.js` after `resources` emits `"ready"`.
4. Add collidable meshes to `this.octree` via `octree.fromGraphNode(mesh)` after calling `mesh.updateMatrixWorld(true)`.
