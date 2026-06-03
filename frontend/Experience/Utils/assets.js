import characters from "./characters.js";

// Selectable player models come from the character roster (characters.js), so
// adding a character is a one-line change there — no edits needed here.
const characterAssets = characters.map((c) => ({
    name: c.id,
    type: "glbModel",
    path: `/models/${c.file || `${c.id}.glb`}`,
}));

export default [
    {
        westgate: {
            assets: [
                ...characterAssets,
                {
                    name: "cloudTexture",
                    type: "imageTexture",
                    path: "textures/cloud.jpg",
                },
                {
                    name: "grassBladeAlpha",
                    type: "imageTexture",
                    path: "textures/grass-blade-alpha.jpg",
                },
                {
                    name: "parkGround",
                    type: "imageTexture",
                    path: "textures/baked/grass.jpg",
                },
                {
                    name: "vehicleChassis",
                    type: "glbModel",
                    path: "/models/chassis-draco.glb",
                },
                {
                    name: "vehicleWheel",
                    type: "glbModel",
                    path: "/models/wheel-draco.glb",
                },
            ],
        },
    },
];
