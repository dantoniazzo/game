import * as THREE from "three";

// Visible bullets. The local player's bullets are authoritative for damage:
// when one's path crosses a remote player it emits "playerHit" (server relays it
// to that player, who lowers their own synced health). Bullets fired by others
// arrive as cosmetic-only tracers via "playerShoot".

const DAMAGE = 25; // 4 shots to down a 100-HP player
const SPEED = 70; // units / second
const LIFETIME = 2.5; // seconds
const HIT_RADIUS = 0.7; // player hit sphere radius

const _seg = new THREE.Vector3();
const _toC = new THREE.Vector3();
const _closest = new THREE.Vector3();

export default class Projectiles {
    constructor({ scene, socket, collectTargets }) {
        this.scene = scene;
        this.socket = socket;
        this.collectTargets = collectTargets || (() => []);
        this.bullets = [];

        this._geo = new THREE.SphereGeometry(0.09, 8, 8);
        this._matLocal = new THREE.MeshBasicMaterial({ color: 0xfff1a8 });
        this._matRemote = new THREE.MeshBasicMaterial({ color: 0xffd24a });
    }

    // Fire the local player's (damaging) bullet and tell others to draw a tracer.
    fireLocal(origin, dir) {
        this._spawn(origin, dir, true);
        this.socket?.emit("shoot", {
            ox: origin.x, oy: origin.y, oz: origin.z,
            dx: dir.x, dy: dir.y, dz: dir.z,
        });
    }

    // Cosmetic bullet from another player (no damage on this client).
    spawnRemote(origin, dir) {
        this._spawn(origin, dir, false);
    }

    _spawn(origin, dir, isLocal) {
        const mesh = new THREE.Mesh(
            this._geo,
            isLocal ? this._matLocal : this._matRemote
        );
        mesh.position.copy(origin);
        this.scene.add(mesh);
        this.bullets.push({
            mesh,
            prev: origin.clone(),
            vel: dir.clone().normalize().multiplyScalar(SPEED),
            life: LIFETIME,
            local: isLocal,
        });
    }

    update(dt) {
        for (let i = this.bullets.length - 1; i >= 0; i--) {
            const b = this.bullets[i];
            b.prev.copy(b.mesh.position);
            b.mesh.position.addScaledVector(b.vel, dt);
            b.life -= dt;

            let remove = b.life <= 0 || b.mesh.position.y < -2;

            // Only the local player's bullets deal damage.
            if (!remove && b.local) {
                const hitId = this._segmentHit(b.prev, b.mesh.position);
                if (hitId) {
                    this.socket?.emit("playerHit", {
                        targetId: hitId,
                        damage: DAMAGE,
                    });
                    remove = true;
                }
            }

            if (remove) {
                this.scene.remove(b.mesh);
                this.bullets.splice(i, 1);
            }
        }
    }

    // Segment a→b vs each target sphere; returns the first hit player id or null.
    _segmentHit(a, b) {
        const targets = this.collectTargets();
        if (targets.length === 0) return null;

        _seg.subVectors(b, a);
        const segLenSq = _seg.lengthSq();

        for (const t of targets) {
            _toC.subVectors(t.center, a);
            let u = segLenSq > 0 ? _toC.dot(_seg) / segLenSq : 0;
            u = Math.max(0, Math.min(1, u));
            _closest.copy(a).addScaledVector(_seg, u);
            if (_closest.distanceToSquared(t.center) <= HIT_RADIUS * HIT_RADIUS) {
                return t.id;
            }
        }
        return null;
    }

    dispose() {
        for (const b of this.bullets) this.scene.remove(b.mesh);
        this.bullets = [];
    }
}
