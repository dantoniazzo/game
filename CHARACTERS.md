# Adding playable characters (Mixamo)

Characters are driven by a single roster file —
`frontend/Experience/Utils/characters.js`. Adding one is a one-line change once
the model is in `public/models/`.

## TL;DR

1. Get a `.glb` with the right animations (see below) and drop it in
   `public/models/`, e.g. `public/models/ninja.glb`.
2. Add a line to `frontend/Experience/Utils/characters.js`:

   ```js
   { id: "ninja", label: "Ninja" },
   ```

   (`id` must match the filename without `.glb`. If the filename differs, add
   `file: "whatever.glb"`.)
3. Compress it (recommended — Mixamo GLBs ship huge PNG textures):

   ```bash
   npm run compress-models -- ninja.glb
   ```

4. `npm run dev` — the character now appears in the Welcome Screen's
   **Character** cycle selector.

## Which animations are needed

The player animation state machine uses five clips:

| Canonical clip | Required? | Notes |
| --- | --- | --- |
| `idle` | yes | standing pose |
| `walk` | yes | use an **In Place** walk so the model doesn't drift |
| `run` | yes | use an **In Place** run |
| `jump` | yes | standing jump |
| `running-jump` | optional | falls back to `jump` if absent |

Clip names are matched **case-insensitively and fuzzily**, so Mixamo's default
names (`Idle`, `Walking`, `Running`, `Jump`) work with no renaming. The matcher
lives in `Avatar.js > _resolveClips()`:

- anything containing `idle`/`stand` → `idle`
- `walk` → `walk`
- `run`/`jog`/`sprint` (without `jump`) → `run`
- `jump` (without `run`) → `jump`
- contains both `run` and `jump` → `running-jump`

Extra clips Mixamo includes (`Dancing`, `Waving`, `T-Pose`, `mixamo.com`) are
harmless and ignored.

## Getting one GLB with all the animations

Mixamo exports **one animation per download**, so the reliable way to get a
single multi-animation `.glb` is to combine them in Blender once.

### 1. Download from [mixamo.com](https://www.mixamo.com)

1. Pick a character (or upload your own FBX/`.zip`).
2. Download the **character + first animation** (e.g. *Idle*):
   - Format: **FBX Binary (.fbx)**
   - Skin: **With Skin**
   - FPS: 30, Keyframe reduction: none
3. For each remaining animation (*Walking*, *Running*, *Jump*, optionally
   *Jump* while running / *Running Jump*): download with Skin = **Without
   Skin** (animation only). Prefer **In Place** variants for walk/run.

### 2. Combine in Blender (free)

1. **Import** the With-Skin FBX (`File ▸ Import ▸ FBX`) — this brings in the
   mesh + the *Idle* action.
2. **Import** each Without-Skin FBX — each adds another Action onto the same
   armature.
3. Open the **Action Editor** (Dope Sheet). For each action, click **Push
   Down** to stash it onto an NLA track (or rename them `idle`/`walk`/`run`/
   `jump`/`running-jump` — optional, since names are fuzzy-matched).
4. **Export** `File ▸ Export ▸ glTF 2.0 (.glb)`:
   - Format: **glTF Binary (.glb)**
   - Include: **Selected Objects** (select the armature + mesh first)
   - Animation: **on**, with **Group by NLA Track** (or "Export all actions")
     and **Always Sample Animations** enabled.

### 3. Wire it up

Drop the exported `.glb` into `public/models/` and add the roster line (TL;DR
step 2). Done.

## Compressing models

Mixamo characters export with large, uncompressed PNG textures (the stock
`mike.glb` was ~56 MB — 54 MB of it textures). `npm run compress-models`
(`scripts/compress-models.mjs`) resizes textures to ≤2048 px, converts them to
WebP, and Draco-compresses the geometry — typically an 85–97% size cut with no
visible quality loss. The loader (`Loaders.js` + three.js) decodes both formats
automatically, so nothing else changes.

```bash
npm run compress-models                 # default set (mike, monster, brute)
npm run compress-models -- ninja.glb    # a specific file you just added
```

Files are rewritten in place; originals are git-tracked, so `git checkout`
reverts. Lower `TEXTURE_SIZE` in the script for even smaller files.

## Troubleshooting

- **Character floats or sinks into the ground** — it was likely exported at a
  different scale. Re-export from Mixamo with default settings; the avatar is
  rendered at scale `1.3` with a fixed vertical offset (`Avatar.js`,
  `Player.updateAvatarPosition`).
- **Only one animation plays** — your `.glb` only contains one clip. Every
  canonical clip falls back to whatever exists, so bundle all of them in
  Blender (above) for full movement.
- **T-pose while moving** — the locomotion clips weren't found. Make sure the
  clip names contain `walk`/`run`/`jump`, or that the actions were actually
  exported (check the Blender NLA / "Export all actions").
- Bone naming does **not** need to match other characters — each model plays
  its own embedded clips, so mixing Mixamo rigs (`mixamorig:` vs `mixamorig12:`)
  is fine.
