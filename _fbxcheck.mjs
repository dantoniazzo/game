import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import fs from "fs";

const loader = new FBXLoader();
function inspect(file){
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  let group;
  try { group = loader.parse(ab, ""); }
  catch(e){ console.log(file, "PARSE FAIL:", e.message); return; }
  const clip = group.animations && group.animations[0];
  console.log("\n### " + file.split("/").pop());
  console.log("anim name:", clip && clip.name, "| dur:", clip && clip.duration.toFixed(2), "| tracks:", clip && clip.tracks.length);
  // hips bone bind Y
  let hips=null; group.traverse(o=>{ if(!hips && o.isBone && /Hips$/i.test(o.name)) hips=o; });
  console.log("hips bone:", hips && hips.name, "bindY:", hips && hips.position.y.toFixed(3));
  // hips position track range
  if (clip){
    const t = clip.tracks.find(tr=>/Hips\.position$/i.test(tr.name));
    if (t){
      const ys=[]; for(let i=1;i<t.values.length;i+=3) ys.push(t.values[i]);
      console.log("Hips.position track:", t.name, "Ymin:",Math.min(...ys).toFixed(2),"Ymax:",Math.max(...ys).toFixed(2));
    } else console.log("no Hips.position track");
    console.log("sample track names:", clip.tracks.slice(0,3).map(x=>x.name));
  }
}
for (const f of process.argv.slice(2)) inspect(f);
