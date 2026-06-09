import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import fs from "fs";
const loader = new FBXLoader();
function motion(file){
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset+buf.byteLength);
  const g = loader.parse(ab, "");
  const c = g.animations[0];
  // total angular variation across arm/spine quaternion tracks
  let energy = 0, armTracks = 0;
  for (const t of c.tracks){
    if (!/Arm|ForeArm|Hand|Spine/i.test(t.name) || !t.name.endsWith(".quaternion")) continue;
    armTracks++;
    const v = t.values;
    for (let i=4;i<v.length;i+=4){
      // dot between consecutive quats → angular delta
      let d = v[i]*v[i-4]+v[i+1]*v[i-3]+v[i+2]*v[i-2]+v[i+3]*v[i-1];
      energy += (1 - Math.min(1, Math.abs(d)));
    }
  }
  console.log(file.split("/").pop().padEnd(26), "dur:", c.duration.toFixed(2), "tracks:", c.tracks.length, "upperMotion:", energy.toFixed(3));
}
motion("public/models/shooter-pack/firing rifle.fbx");
motion("public/models/shooter-pack/rifle aiming idle.fbx");
motion("public/models/shooter-pack/walking.fbx");
