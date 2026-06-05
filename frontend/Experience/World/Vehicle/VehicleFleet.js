import * as THREE from 'three';
import Vehicle from './Vehicle.js';

const _carPos = new THREE.Vector3();

// ─── VehicleFleet ───────────────────────────────────────────────────────────
//
// Owns all the cars and the single shared Rapier step. Multiple Vehicle bodies
// live in one Rapier world, so the world must be stepped exactly once per frame
// — here — after every car has done its pre-step work (local/idle apply forces,
// remote cars snap to their network transform). Then visuals are read back.
//
// Net model: each client simulates the car it drives ("local"), treats cars
// other players drive as kinematic obstacles fed from the network ("remote"),
// and lets unowned cars rest in place ("idle"). So two driven cars deflect off
// each other (each is solid on the other's screen); momentum isn't shared and
// an unowned car shoved by the local player only moves locally.

export default class VehicleFleet {
    constructor({ rapierWorld, scene, chassisGLTF, wheelGLTF, spawns }) {
        this.rapierWorld = rapierWorld;

        this.cars = spawns.map((s, i) => new Vehicle({
            rapierWorld,
            scene,
            chassisGLTF,
            wheelGLTF,
            spawnPosition: s.position,
            color: s.color ?? null,
            id: i,
        }));

        this._createPrompts();
    }

    // ─── shared enter/exit prompts (one set, not one per car) ──────────────────

    _createPrompts() {
        const base = {
            position: 'fixed',
            left: '50%',
            transform: 'translateX(-50%)',
            color: 'white',
            fontFamily: 'sans-serif',
            backgroundColor: 'rgba(0,0,0,0.55)',
            borderRadius: '6px',
            display: 'none',
            pointerEvents: 'none',
            zIndex: '100',
        };

        this.enterPromptEl = document.createElement('div');
        this.enterPromptEl.textContent = 'Press F to enter vehicle';
        Object.assign(this.enterPromptEl.style, base, {
            bottom: '30%', fontSize: '16px', padding: '8px 20px',
        });
        document.body.appendChild(this.enterPromptEl);

        this.exitPromptEl = document.createElement('div');
        this.exitPromptEl.textContent = 'Press F to exit vehicle';
        Object.assign(this.exitPromptEl.style, base, {
            top: '12%', fontSize: '14px', padding: '6px 16px',
        });
        document.body.appendChild(this.exitPromptEl);
    }

    showEnterPrompt(visible) {
        this.enterPromptEl.style.display = visible ? 'block' : 'none';
    }

    showExitPrompt(visible) {
        this.exitPromptEl.style.display = visible ? 'block' : 'none';
    }

    // ─── queries ───────────────────────────────────────────────────────────────

    // Nearest car within maxDist of a point → { car, index, dist } or null.
    getNearest(point, maxDist = 6) {
        let best = null;
        let bestDist = maxDist;
        for (let i = 0; i < this.cars.length; i++) {
            const t = this.cars[i].chassisBody.translation();
            const d = _carPos.set(t.x, t.y, t.z).distanceTo(point);
            if (d < bestDist) {
                bestDist = d;
                best = { car: this.cars[i], index: i, dist: d };
            }
        }
        return best;
    }

    isRemoteOccupied(index) {
        const car = this.cars[index];
        return !!car && car.remoteDriverId != null;
    }

    resolvePlayerCollision(capsule) {
        for (const car of this.cars) car.resolvePlayerCollision(capsule);
    }

    // ─── remote-driver bookkeeping (called from Player on network updates) ─────

    // Driver bookkeeping only — Player._applyCarAuthority() sets each car's
    // actual mode from (who drives it / who the host is).
    occupyCar(index, playerId) {
        const car = this.cars[index];
        if (car) car.remoteDriverId = playerId;
    }

    releaseCar(index, playerId = null) {
        const car = this.cars[index];
        if (car && (playerId == null || car.remoteDriverId === playerId)) {
            car.remoteDriverId = null;
        }
    }

    setRemoteState(index, posObj, quatObj) {
        this.cars[index]?.setNetworkState(posObj, quatObj);
    }

    // ─── per-frame: pre-step → single step → post-step ─────────────────────────

    update(dt) {
        const step = Math.min(dt, 0.05);

        for (const car of this.cars) {
            if (car.mode === 'remote') car.applyNetworkSync();
            else car.applyControls(step);
        }

        this.rapierWorld.timestep = step;
        this.rapierWorld.step();

        for (const car of this.cars) {
            if (car.mode !== 'remote') car.syncVisuals(step);
        }
    }
}
