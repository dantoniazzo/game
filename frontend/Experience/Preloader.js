import Experience from "./Experience.js";
import { ACCENT, ACCENT_LIGHT, ACCENT_GLOW } from "./Utils/constants.js";

export default class Preloader {
    constructor() {
        this.experience = new Experience();
        this.resources = this.experience.resources;
        this.socket = this.experience.socket;
        this.camera = this.experience.camera;

        this.createOverlay();

        this.resources.on("ready", () => {
            this.onResourcesReady();
        });
    }

    createOverlay() {
        this.overlay = document.createElement("div");
        Object.assign(this.overlay.style, {
            position: "fixed",
            inset: "0",
            zIndex: "200",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "black",
            transition: "opacity 1s ease",
            opacity: "1",
        });

        // Diamond loader
        this.loader = document.createElement("span");
        this.loader.className = "diamond-loader";
        this.overlay.appendChild(this.loader);

        // Name input container
        this.nameContainer = document.createElement("div");
        Object.assign(this.nameContainer.style, {
            display: "none",
            flexDirection: "column",
            alignItems: "center",
            gap: "16px",
        });

        this.nameInput = document.createElement("input");
        this.nameInput.type = "text";
        this.nameInput.placeholder = "Enter your name";
        this.nameInput.maxLength = 25;
        Object.assign(this.nameInput.style, {
            width: "320px",
            padding: "14px 20px",
            fontSize: "18px",
            fontFamily: "sans-serif",
            color: "white",
            backgroundColor: "transparent",
            border: `2px solid ${ACCENT}`,
            borderRadius: "8px",
            outline: "none",
            textAlign: "center",
        });

        this.nameInput.addEventListener("focus", () => {
            this.nameInput.style.borderColor = ACCENT_LIGHT;
            this.nameInput.style.boxShadow = `0 0 12px ${ACCENT_GLOW}`;
        });
        this.nameInput.addEventListener("blur", () => {
            this.nameInput.style.borderColor = ACCENT;
            this.nameInput.style.boxShadow = "none";
        });
        this.nameInput.addEventListener("keydown", (e) => {
            if (e.code === "Enter") this.onNameSubmit();
        });

        this.nameContainer.appendChild(this.nameInput);
        this.overlay.appendChild(this.nameContainer);

        // CSS
        const style = document.createElement("style");
        style.textContent = `
            .diamond-loader {
                position: relative;
                width: 64px;
                height: 64px;
                background-color: rgba(0, 0, 0, 0.5);
                transform: rotate(45deg);
                overflow: hidden;
            }
            .diamond-loader::after {
                content: "";
                position: absolute;
                inset: 8px;
                margin: auto;
                background: #222b32;
            }
            .diamond-loader::before {
                content: "";
                position: absolute;
                inset: -15px;
                margin: auto;
                background: ${ACCENT};
                animation: diamondLoader 2s linear infinite;
            }
            @keyframes diamondLoader {
                0%, 10% { transform: translate(-64px, -64px) rotate(-45deg); }
                90%, 100% { transform: translate(0px, 0px) rotate(-45deg); }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(this.overlay);
    }

    onResourcesReady() {
        this.loader.style.display = "none";
        this.nameContainer.style.display = "flex";
        this.nameInput.focus();
    }

    onNameSubmit() {
        const name = this.nameInput.value.trim();
        if (!name) return;

        this.socket.emit("setName", name);
        this.socket.emit("setAvatar", "mike");

        // Fade out and remove
        this.overlay.style.opacity = "0";
        this.overlay.style.pointerEvents = "none";

        this.camera.pointerLockEnabled = true;

        setTimeout(() => this.overlay.remove(), 1000);
    }

    update() {}
}
