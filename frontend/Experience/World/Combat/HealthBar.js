import * as THREE from "three";

// A small billboarded health bar (canvas → sprite) shown above a player's head.
// One per remote avatar; the local player uses the DOM HUD instead.
export default class HealthBar {
    constructor() {
        this._canvas = document.createElement("canvas");
        this._canvas.width = 128;
        this._canvas.height = 20;
        this._ctx = this._canvas.getContext("2d");

        this._texture = new THREE.CanvasTexture(this._canvas);
        this._texture.minFilter = THREE.LinearFilter;

        const material = new THREE.SpriteMaterial({
            map: this._texture,
            transparent: true,
        });
        this.sprite = new THREE.Sprite(material);
        this.sprite.scale.set(1.1, 0.17, 1);

        this._last = -1;
        this.set(1);
    }

    // pct in [0, 1]
    set(pct) {
        pct = Math.max(0, Math.min(1, pct));
        if (Math.abs(pct - this._last) < 0.005) return; // skip tiny redraws
        this._last = pct;

        const c = this._ctx;
        const w = this._canvas.width;
        const h = this._canvas.height;
        c.clearRect(0, 0, w, h);

        c.fillStyle = "rgba(0,0,0,0.55)";
        roundRect(c, 0, 0, w, h, 6);
        c.fill();

        const color = pct > 0.5 ? "#3ad07a" : pct > 0.25 ? "#f0a93a" : "#e2453a";
        const pad = 2;
        const fillW = (w - pad * 2) * pct;
        if (fillW > 0) {
            c.fillStyle = color;
            roundRect(c, pad, pad, fillW, h - pad * 2, 4);
            c.fill();
        }

        this._texture.needsUpdate = true;
    }

    dispose() {
        this.sprite.material.map?.dispose();
        this.sprite.material.dispose();
    }
}

function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}
