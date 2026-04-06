import * as THREE from "three";
import Experience from "../Experience.js";
import { ACCENT } from "../Utils/constants.js";

const _dir = new THREE.Vector3();

export default class Compass {
    constructor() {
        this.experience = new Experience();
        this.camera = this.experience.camera;

        this.createElement();
    }

    createElement() {
        this.container = document.createElement("div");
        Object.assign(this.container.style, {
            position: "fixed",
            top: "20px",
            right: "20px",
            width: "70px",
            height: "70px",
            zIndex: "100",
            pointerEvents: "none",
        });

        this.ring = document.createElement("div");
        Object.assign(this.ring.style, {
            width: "100%",
            height: "100%",
            borderRadius: "50%",
            border: "2px solid rgba(255,255,255,0.3)",
            position: "relative",
        });

        const directions = [
            { label: "N", deg: 0, color: ACCENT },
            { label: "E", deg: 90, color: "rgba(255,255,255,0.6)" },
            { label: "S", deg: 180, color: "rgba(255,255,255,0.6)" },
            { label: "W", deg: 270, color: "rgba(255,255,255,0.6)" },
        ];

        this.labels = [];
        const radius = 35; // half of 70px container

        for (const dir of directions) {
            const rad = (dir.deg * Math.PI) / 180;
            const x = radius + Math.sin(rad) * (radius - 10);
            const y = radius - Math.cos(rad) * (radius - 10);

            const text = document.createElement("span");
            text.textContent = dir.label;
            Object.assign(text.style, {
                position: "absolute",
                left: `${x}px`,
                top: `${y}px`,
                transform: "translate(-50%, -50%)",
                color: dir.color,
                fontSize: "11px",
                fontWeight: "bold",
                fontFamily: "sans-serif",
                textShadow: "0 0 4px rgba(0,0,0,0.8)",
            });

            this.labels.push({ el: text, baseDeg: dir.deg, radius: radius - 10 });
            this.ring.appendChild(text);
        }

        // Center dot
        const dot = document.createElement("div");
        Object.assign(dot.style, {
            position: "absolute",
            top: "50%",
            left: "50%",
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: "white",
            transform: "translate(-50%, -50%)",
            boxShadow: "0 0 4px rgba(0,0,0,0.5)",
        });
        this.ring.appendChild(dot);

        // Fixed triangle indicator at top
        const indicator = document.createElement("div");
        Object.assign(indicator.style, {
            position: "absolute",
            top: "-6px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "0",
            height: "0",
            borderLeft: "5px solid transparent",
            borderRight: "5px solid transparent",
            borderTop: "6px solid white",
            zIndex: "1",
        });

        this.container.appendChild(this.ring);
        this.container.appendChild(indicator);
        document.body.appendChild(this.container);
    }

    update() {
        let angle = 0;

        if (!this.camera.isMobile && this.camera.angles) {
            angle = this.camera.angles.horizontal;
        } else {
            this.camera.perspectiveCamera.getWorldDirection(_dir);
            angle = Math.atan2(_dir.x, _dir.z);
        }

        const center = 35;

        for (const { el, baseDeg, radius } of this.labels) {
            const rad = (baseDeg * Math.PI) / 180 + angle;
            const x = center + Math.sin(rad) * radius;
            const y = center - Math.cos(rad) * radius;
            el.style.left = `${x}px`;
            el.style.top = `${y}px`;
        }
    }
}
