/**
 * Compress character GLBs: resize + convert textures to WebP and Draco-compress
 * geometry. The character models are texture-heavy (e.g. mike.glb is ~56 MB,
 * almost all of it 4K PNGs), so the big win is the texture pass; Draco trims the
 * geometry on top. The loader already decodes both (Loaders.js wires DRACOLoader
 * at /draco/, and three.js handles EXT_texture_webp natively) so no code changes
 * are needed — compressed files drop straight in.
 *
 * Usage:
 *   npm run compress-models                 # compresses the defaults below
 *   npm run compress-models -- ninja.glb    # compress specific file(s)
 *
 * Rewrites each target in place (originals are git-tracked, so `git checkout` to
 * revert). Re-run after adding a new Mixamo character (see CHARACTERS.md).
 */
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import {
    dedup,
    prune,
    textureCompress,
    draco,
} from "@gltf-transform/functions";
import draco3d from "draco3dgltf";
import sharp from "sharp";
import { existsSync, renameSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MODELS = path.join(ROOT, "public", "models");

const TEXTURE_SIZE = 2048; // max texture dimension in px (lower = smaller files)

// Texture-heavy character models that ship as raw PNGs. The asian_*_animated
// rigs are already Draco + small JPEGs, so they're left out by default.
const DEFAULT_TARGETS = ["mike.glb", "monster.glb", "brute.glb"];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
});

const args = process.argv.slice(2);
const targets = (args.length ? args : DEFAULT_TARGETS).map((f) =>
    f.endsWith(".glb") ? f : `${f}.glb`
);

const mb = (b) => (b / 1048576).toFixed(1);
let totalBefore = 0;
let totalAfter = 0;

for (const file of targets) {
    const src = path.join(MODELS, file);
    if (!existsSync(src)) {
        console.warn(`skip (missing): ${file}`);
        continue;
    }

    const before = statSync(src).size;
    totalBefore += before;
    process.stdout.write(`→ ${file} (${mb(before)} MB) … `);

    const doc = await io.read(src);
    await doc.transform(
        dedup(),
        textureCompress({
            encoder: sharp,
            targetFormat: "webp",
            resize: [TEXTURE_SIZE, TEXTURE_SIZE],
        }),
        prune(),
        draco()
    );

    const tmp = src.replace(/\.glb$/, ".tmp.glb");
    await io.write(tmp, doc);
    renameSync(tmp, src);

    const after = statSync(src).size;
    totalAfter += after;
    console.log(`${mb(after)} MB  (-${Math.round((1 - after / before) * 100)}%)`);
}

if (totalBefore) {
    console.log(
        `\nTotal: ${mb(totalBefore)} MB → ${mb(totalAfter)} MB  (-${Math.round(
            (1 - totalAfter / totalBefore) * 100
        )}%)`
    );
}
