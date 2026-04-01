import Experience from "./Experience.js";

export default class Preloader {
    constructor() {
        this.experience = new Experience();
        this.resources = this.experience.resources;
        this.socket = this.experience.socket;

        this.ready = false;
        this.nameEntered = false;

        this.createElement();

        this.resources.on("ready", () => {
            this.onResourcesReady();
        });
    }

    createElement() {
        // Loading overlay
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

        // Diamond loader (from player-react)
        this.loader = document.createElement("span");
        this.loader.className = "diamond-loader";
        this.overlay.appendChild(this.loader);

        // Name input container (hidden initially)
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
            border: "2px solid #de3500",
            borderRadius: "8px",
            outline: "none",
            textAlign: "center",
        });

        this.nameInput.addEventListener("focus", () => {
            this.nameInput.style.borderColor = "#ff5722";
            this.nameInput.style.boxShadow = "0 0 12px rgba(222, 53, 0, 0.4)";
        });
        this.nameInput.addEventListener("blur", () => {
            this.nameInput.style.borderColor = "#de3500";
            this.nameInput.style.boxShadow = "none";
        });

        this.nameInput.addEventListener("keydown", (e) => {
            if (e.code === "Enter") {
                this.onNameSubmit();
            }
        });

        this.nameContainer.appendChild(this.nameInput);
        this.overlay.appendChild(this.nameContainer);

        // Inject diamond loader CSS
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
                background: #de3500;
                animation: diamondLoader 2s linear infinite;
            }
            @keyframes diamondLoader {
                0%, 10% {
                    transform: translate(-64px, -64px) rotate(-45deg);
                }
                90%, 100% {
                    transform: translate(0px, 0px) rotate(-45deg);
                }
            }
        `;
        document.head.appendChild(style);
        document.body.appendChild(this.overlay);
    }

    onResourcesReady() {
        this.ready = true;

        // Hide loader, show name input
        this.loader.style.display = "none";
        this.nameContainer.style.display = "flex";
        this.nameInput.focus();
    }

    onNameSubmit() {
        const name = this.nameInput.value.trim();
        if (!name) return;

        this.nameEntered = true;

        // Send name to server
        this.socket.emit("setName", name);
        this.socket.emit("setAvatar", "brute");

        // Fade out overlay
        this.overlay.style.opacity = "0";
        this.overlay.style.pointerEvents = "none";

        setTimeout(() => {
            this.overlay.remove();
        }, 1000);
    }

    update() {}
}
