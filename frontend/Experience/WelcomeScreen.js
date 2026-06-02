import Experience from "./Experience.js";

/**
 * WelcomeScreen — the GTA VI–style main menu / entry screen.
 *
 * Replaces the old name-input Preloader as the game's entry point. Renders a
 * full-screen neon-purple sunset (palm-tree silhouettes + a gradient "VI"
 * logo) and a classic console-style menu:
 *
 *   START GAME   → jump straight in with a default name
 *   SETTINGS     → "coming soon" panel
 *   ONLINE       → prompts for a username, then starts
 *   SOCIAL CLUB  → "coming soon" panel
 *   QUIT GAME    → "coming soon" panel
 *
 * Navigation: ↑/↓ or W/S to move, Enter/Space to select, mouse hover + click,
 * Esc to close an open panel/modal. The menu stays in a LOADING state until
 * `resources` emit "ready"; starting the game reuses the same handoff the old
 * Preloader did (emit setName/setAvatar + enable pointer lock, then fade out).
 */

const MENU = [
    { id: "start", label: "Start Game" },
    { id: "settings", label: "Settings" },
    { id: "online", label: "Online" },
    { id: "social", label: "Social Club" },
    { id: "quit", label: "Quit Game" },
];

const DEFAULT_SKIN = "mike";

export default class WelcomeScreen {
    constructor() {
        this.experience = new Experience();
        this.resources = this.experience.resources;
        this.socket = this.experience.socket;
        this.camera = this.experience.camera;

        this.selected = 0;
        this.state = "loading"; // "loading" | "menu"
        this.overlayOpen = null; // null | "card"
        this._started = false;

        this.loadFonts();
        this.build();
        this.bindKeys();

        this.resources.on("ready", () => this.onReady());
    }

    // ─── fonts ────────────────────────────────────────────────────────────────

    loadFonts() {
        if (!document.querySelector('link[data-gta-font]')) {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.dataset.gtaFont = "true";
            link.href =
                "https://fonts.googleapis.com/css2?family=Anton&display=swap";
            document.head.appendChild(link);
        }
    }

    // ─── markup ─────────────────────────────────────────────────────────────--

    build() {
        this.root = document.createElement("div");
        this.root.className = "gta-screen";
        this.root.innerHTML = `
            <div class="gta-bg"></div>
            <div class="gta-glow"></div>
            <div class="gta-palm gta-palm--left">${this.palmSvg()}</div>
            <div class="gta-palm gta-palm--right">${this.palmSvg()}</div>
            <div class="gta-vignette"></div>
            <div class="gta-grain"></div>

            <div class="gta-content">
                <div class="gta-logo">
                    ${this.logoSvg()}
                    <div class="gta-logo__wordmark">grand theft auto</div>
                </div>

                <nav class="gta-menu" aria-label="Main menu"></nav>

                <div class="gta-loading">
                    <span class="gta-loading__text">Loading</span>
                    <span class="gta-dots"><i></i><i></i><i></i></span>
                </div>

                <div class="gta-hint">
                    <span><b>&#8593; &#8595;</b> Navigate</span>
                    <span><b>&#9166;</b> Select</span>
                </div>
            </div>

            <div class="gta-footer">
                Fan-made tribute build &middot; not affiliated with Rockstar Games
            </div>

            <div class="gta-overlay" hidden>
                <div class="gta-card"></div>
            </div>
        `;
        document.body.appendChild(this.root);

        // Menu items
        this.menuEl = this.root.querySelector(".gta-menu");
        this.itemEls = MENU.map((item, i) => {
            const el = document.createElement("div");
            el.className = "gta-item";
            el.dataset.index = String(i);
            el.setAttribute("role", "button");
            el.innerHTML = `
                <span class="gta-item__chev">&#9656;</span>
                <span class="gta-item__label">${item.label}</span>
            `;
            el.addEventListener("mouseenter", () => this.setSelected(i));
            el.addEventListener("click", () => {
                this.setSelected(i);
                this.activate(i);
            });
            this.menuEl.appendChild(el);
            return el;
        });

        // Overlay (card) refs
        this.overlayEl = this.root.querySelector(".gta-overlay");
        this.cardEl = this.root.querySelector(".gta-card");
        this.overlayEl.addEventListener("click", (e) => {
            if (e.target === this.overlayEl) this.closeOverlay();
        });

        this.setSelected(0);
    }

    // ─── interaction ───────────────────────────────────────────────────────--

    bindKeys() {
        this._onKeyDown = (e) => {
            if (this.state !== "menu") return;

            if (this.overlayOpen) {
                if (e.key === "Escape") {
                    e.preventDefault();
                    this.closeOverlay();
                }
                return; // let inputs / card buttons handle everything else
            }

            switch (e.key) {
                case "ArrowUp":
                case "w":
                case "W":
                    e.preventDefault();
                    this.move(-1);
                    break;
                case "ArrowDown":
                case "s":
                case "S":
                    e.preventDefault();
                    this.move(1);
                    break;
                case "Enter":
                case " ":
                    e.preventDefault();
                    this.activate(this.selected);
                    break;
            }
        };
        document.addEventListener("keydown", this._onKeyDown);
    }

    move(dir) {
        const next = (this.selected + dir + MENU.length) % MENU.length;
        this.setSelected(next);
    }

    setSelected(i) {
        this.selected = i;
        this.itemEls.forEach((el, idx) =>
            el.classList.toggle("is-selected", idx === i)
        );
    }

    activate(i) {
        if (this.state !== "menu") return;
        const id = MENU[i].id;
        switch (id) {
            case "start":
                this.startGame(this.randomName());
                break;
            case "online":
                this.openOnline();
                break;
            case "settings":
                this.openPanel(
                    "Settings",
                    "Graphics, audio and control options are still being tuned for the city. Coming soon."
                );
                break;
            case "social":
                this.openPanel(
                    "Social Club",
                    "Join crews, track your stats and unlock rewards across the map. Coming soon."
                );
                break;
            case "quit":
                this.openPanel(
                    "Quit Game",
                    "There's no leaving the city just yet — close the browser tab to bail out for now."
                );
                break;
        }
    }

    // ─── online / panels (shared card) ─────────────────────────────────────--

    openOnline() {
        this.cardEl.innerHTML = `
            <div class="gta-card__kicker">Go Online</div>
            <h2 class="gta-card__title">Enter Your Username</h2>
            <p class="gta-card__sub">This is how other players will see you in the city.</p>
            <input class="gta-input" type="text" maxlength="20"
                   placeholder="Username" autocomplete="off" spellcheck="false" />
            <div class="gta-card__actions">
                <button class="gta-btn gta-btn--ghost" data-cancel>Back</button>
                <button class="gta-btn" data-confirm>Enter Lobby</button>
            </div>
        `;
        const input = this.cardEl.querySelector(".gta-input");
        const confirm = this.cardEl.querySelector("[data-confirm]");
        const submit = () => {
            const name = input.value.trim().substring(0, 20);
            if (!name) {
                this.cardEl.classList.remove("gta-card--shake");
                // reflow to retrigger the animation
                void this.cardEl.offsetWidth;
                this.cardEl.classList.add("gta-card--shake");
                input.focus();
                return;
            }
            this.startGame(name);
        };
        confirm.addEventListener("click", submit);
        this.cardEl
            .querySelector("[data-cancel]")
            .addEventListener("click", () => this.closeOverlay());
        input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") submit();
        });

        this.showOverlay();
        setTimeout(() => input.focus(), 60);
    }

    openPanel(title, body) {
        this.cardEl.innerHTML = `
            <div class="gta-card__kicker">Menu</div>
            <h2 class="gta-card__title">${title}</h2>
            <p class="gta-card__sub">${body}</p>
            <div class="gta-card__badge">Coming&nbsp;Soon</div>
            <div class="gta-card__actions">
                <button class="gta-btn" data-cancel>Back</button>
            </div>
        `;
        this.cardEl
            .querySelector("[data-cancel]")
            .addEventListener("click", () => this.closeOverlay());
        this.showOverlay();
    }

    showOverlay() {
        this.overlayOpen = "card";
        this.overlayEl.hidden = false;
        // next frame → trigger the CSS transition
        requestAnimationFrame(() =>
            this.overlayEl.classList.add("is-open")
        );
    }

    closeOverlay() {
        this.overlayOpen = null;
        this.overlayEl.classList.remove("is-open");
        setTimeout(() => {
            if (!this.overlayOpen) this.overlayEl.hidden = true;
        }, 240);
    }

    // ─── lifecycle ─────────────────────────────────────────────────────────--

    onReady() {
        this.state = "menu";
        this.root.classList.add("is-ready");
    }

    randomName() {
        return `Player${Math.floor(1000 + Math.random() * 9000)}`;
    }

    startGame(name) {
        if (this._started) return;
        this._started = true;

        this.socket.emit("setName", name);
        this.socket.emit("setAvatar", DEFAULT_SKIN);

        // Hand control to the game (desktop: pointer lock on next canvas click;
        // mobile ignores this flag and uses OrbitControls).
        this.camera.pointerLockEnabled = true;

        this.root.classList.add("is-leaving");
        document.removeEventListener("keydown", this._onKeyDown);
        setTimeout(() => this.root.remove(), 1000);
    }

    // Called every frame by Experience.update(); CSS drives the visuals so this
    // is currently a no-op (kept as a hook for future menu animation).
    update() {}

    // ─── inline SVG art ────────────────────────────────────────────────────--

    logoSvg() {
        return `
            <svg class="gta-logo__vi" viewBox="0 0 560 300" aria-hidden="true">
                <defs>
                    <linearGradient id="gtaViGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="#62b4ff"/>
                        <stop offset="40%" stop-color="#bd4ee0"/>
                        <stop offset="68%" stop-color="#ff3d8b"/>
                        <stop offset="100%" stop-color="#ff9c3d"/>
                    </linearGradient>
                </defs>
                <text x="50%" y="238" text-anchor="middle"
                      class="gta-logo__vi-text" fill="url(#gtaViGrad)">VI</text>
            </svg>
        `;
    }

    palmSvg() {
        // One frond (points right + droops); the crown reuses it at varied
        // angles/scales, then the whole palm is mirrored via CSS for the
        // opposite side.
        return `
            <svg class="gta-palm__svg" viewBox="0 0 340 540" aria-hidden="true">
                <defs>
                    <path id="gtaFrond" d="M0,0 C 78,-32 168,-36 274,-4
                        C 188,6 100,18 10,28 C 3,19 0,10 0,0 Z"/>
                </defs>
                <path class="gta-palm__trunk" d="M104,540
                    C 122,408 144,300 180,212
                    C 189,189 201,170 214,158 L 238,168
                    C 222,182 209,201 202,224
                    C 172,312 156,420 156,540 Z"/>
                <g transform="translate(222,162)">
                    <use href="#gtaFrond" transform="rotate(-112) scale(0.9)"/>
                    <use href="#gtaFrond" transform="rotate(-78)"/>
                    <use href="#gtaFrond" transform="rotate(-44)"/>
                    <use href="#gtaFrond" transform="rotate(-14) scale(1.05)"/>
                    <use href="#gtaFrond" transform="rotate(20)"/>
                    <use href="#gtaFrond" transform="rotate(54)"/>
                    <use href="#gtaFrond" transform="rotate(94) scale(0.95)"/>
                    <use href="#gtaFrond" transform="rotate(136) scale(0.82)"/>
                    <use href="#gtaFrond" transform="rotate(178) scale(0.66)"/>
                    <circle cx="6" cy="10" r="9"/>
                    <circle cx="-14" cy="16" r="8"/>
                    <circle cx="16" cy="22" r="7"/>
                </g>
            </svg>
        `;
    }
}
