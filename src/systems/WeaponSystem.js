import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP } from '../core/Physics.js?v=10';
import { ObjectPool } from '../core/ObjectPool.js?v=10';

export const WEAPONS = [
  {
    id: 'pistol', name: 'Пистолет', mag: 12, reserve: 96, rate: 0.22, auto: false,
    dmg: 25, pellets: 1, spread: 0.012, recoil: 0.014, heat: 0.25, range: 150, force: 6,
    reload: 1.2, shake: 0.14,
    sound: { dur: 0.14, f0: 3800, f1: 500, gain: 0.55, thump: 190, thumpDur: 0.09 },
  },
  {
    id: 'smg', name: 'Пистолет-пулемёт', mag: 30, reserve: 180, rate: 0.075, auto: true,
    dmg: 14, pellets: 1, spread: 0.024, recoil: 0.008, heat: 0.12, range: 120, force: 4,
    reload: 1.7, shake: 0.1,
    sound: { dur: 0.1, f0: 4200, f1: 700, gain: 0.5, thump: 220, thumpDur: 0.06 },
  },
  {
    id: 'shotgun', name: 'Дробовик', mag: 6, reserve: 36, rate: 0.85, auto: false,
    dmg: 12, pellets: 9, spread: 0.055, recoil: 0.07, heat: 0.0, range: 60, force: 5,
    reload: 2.4, shake: 0.5,
    sound: { dur: 0.32, f0: 2600, f1: 250, gain: 0.85, thump: 130, thumpDur: 0.2 },
  },
  {
    id: 'rifle', name: 'Штурмовая винтовка', mag: 30, reserve: 150, rate: 0.1, auto: true,
    dmg: 22, pellets: 1, spread: 0.016, recoil: 0.012, heat: 0.14, range: 300, force: 8,
    reload: 2.0, shake: 0.18,
    sound: { dur: 0.2, f0: 3200, f1: 350, gain: 0.7, thump: 150, thumpDur: 0.12 },
  },
];

const MODELS = {
  pistol: { muzzle: -0.26, parts: [
    [0.045, 0.06, 0.24, 0, 0.03, -0.12, 0x222428],
    [0.04, 0.11, 0.055, 0, -0.045, -0.02, 0x15161a],
  ] },
  smg: { muzzle: -0.52, parts: [
    [0.06, 0.09, 0.36, 0, 0, -0.18, 0x23262b],
    [0.03, 0.03, 0.14, 0, 0.01, -0.43, 0x111214],
    [0.04, 0.17, 0.05, 0, -0.12, -0.13, 0x15161a],
    [0.04, 0.1, 0.05, 0, -0.07, -0.02, 0x15161a],
  ] },
  shotgun: { muzzle: -0.78, parts: [
    [0.04, 0.04, 0.72, 0, 0.03, -0.38, 0x1a1c20],
    [0.07, 0.06, 0.22, 0, -0.025, -0.4, 0x6b4426],
    [0.055, 0.1, 0.32, 0, -0.02, 0.12, 0x6b4426],
    [0.05, 0.07, 0.18, 0, 0.0, -0.1, 0x2a2c31],
  ] },
  rifle: { muzzle: -0.95, parts: [
    [0.06, 0.1, 0.55, 0, 0, -0.27, 0x2b2e33],
    [0.03, 0.03, 0.32, 0, 0.02, -0.72, 0x111214],
    [0.045, 0.045, 0.2, 0, 0.085, -0.22, 0x0e0f11],
    [0.04, 0.17, 0.06, 0, -0.12, -0.2, 0x15161a],
    [0.055, 0.11, 0.3, 0, -0.015, 0.14, 0x2b2e33],
  ] },
};

export class WeaponSystem {
  constructor(engine, physics, audio, player) {
    this.engine = engine;
    this.physics = physics;
    this.audio = audio;
    this.player = player;

    this.peds = null;
    this.police = null;
    this.vehicles = null;

    this.current = -1;
    this.owned = WEAPONS.map((w, i) => i === 0);
    this.ammo = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve }));
    this.cooldown = 0;
    this.reloading = 0;
    this.aiming = false;
    this.heat = 0;
    this.sinceShot = 99;
    this.hitTimer = 0;
    this.headshotTimer = 0;
    this.crosshairSpread = 0;

    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._origin = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._mid = new THREE.Vector3();
    this._imp = new CANNON.Vec3();
    this._rel = new CANNON.Vec3();

    this._buildModels();
    this._buildEffects();
  }

  _buildModels() {
    this.models = WEAPONS.map((w) => {
      const def = MODELS[w.id];
      const g = new THREE.Group();
      for (const [sw, sh, sd, x, y, z, color] of def.parts) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(sw, sh, sd),
          new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.55 })
        );
        m.position.set(x, y, z);
        m.castShadow = true;
        g.add(m);
      }
      const muzzle = new THREE.Object3D();
      muzzle.position.set(0, 0.02, def.muzzle);
      g.add(muzzle);
      g.userData.muzzle = muzzle;
      g.visible = false;
      this.player.weaponHolder.add(g);
      return g;
    });
  }

  _buildEffects() {
    const scene = this.engine.scene;
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xffd48a, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    this.flash = new THREE.Group();
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
    const p2 = p1.clone(); p2.rotation.z = Math.PI / 4;
    const p3 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat); p3.rotation.y = Math.PI / 2;
    this.flash.add(p1, p2, p3);
    this.flash.visible = false;
    scene.add(this.flash);
    this.flashTimer = 0;

    this.flashLight = new THREE.PointLight(0xffb060, 0, 14, 2);
    scene.add(this.flashLight);

    const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
    const tracerMat = new THREE.MeshBasicMaterial({
      color: 0xffe9a8, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.tracers = new ObjectPool(
      () => { const m = new THREE.Mesh(tracerGeo, tracerMat); m.frustumCulled = false; scene.add(m); m.userData.life = 0; return m; },
      32,
      (m) => { m.visible = true; m.userData.life = 0.07; },
      (m) => { m.visible = false; }
    );

    const sparkGeo = new THREE.BoxGeometry(0.045, 0.045, 0.045);
    const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffc066 });
    this.sparks = new ObjectPool(
      () => { const m = new THREE.Mesh(sparkGeo, sparkMat); m.userData.vel = new THREE.Vector3(); m.userData.life = 0; scene.add(m); return m; },
      80,
      (m) => { m.visible = true; m.userData.life = 0.35 + Math.random() * 0.2; },
      (m) => { m.visible = false; }
    );
  }

  select(i) {
    if (i === this.current) return;
    if (i < -1 || i >= WEAPONS.length) return;
    if (i >= 0 && !this.owned[i]) return;
    this.current = i;
    this.reloading = 0;
    this.cooldown = 0.25;
    this.models.forEach((m, k) => { m.visible = (k === i); });
    this.player.armed = i >= 0;
    if (i >= 0) this.audio.switchWeapon();
  }

  _cycle(dir) {
    const n = WEAPONS.length + 1;
    let c = this.current;
    for (let k = 0; k < n; k++) {
      c = ((c + 1 + dir) % n + n) % n - 1;
      if (c < 0 || this.owned[c]) { this.select(c); return; }
    }
  }

  get def() { return this.current >= 0 ? WEAPONS[this.current] : null; }
  get mag() { return this.current >= 0 ? this.ammo[this.current].mag : 0; }
  get reserve() { return this.current >= 0 ? this.ammo[this.current].reserve : 0; }

  _startReload() {
    const d = this.def;
    if (!d || this.reloading > 0) return;
    const a = this.ammo[this.current];
    if (a.mag >= d.mag || a.reserve <= 0) return;
    this.reloading = d.reload;
    this.audio.reload(d.reload);
  }

  _finishReload() {
    const d = this.def, a = this.ammo[this.current];
    const take = Math.min(d.mag - a.mag, a.reserve);
    a.mag += take; a.reserve -= take;
  }

  update(input, dt, camState) {
    if (this.player.inVehicle) {
      this.aiming = false;
      this.engine.setAim(false);
      this._updateEffects(dt);
      return false;
    }

    for (let i = 0; i < WEAPONS.length; i++) if (input.consumeKey('Digit' + (i + 1))) this.select(i);
    if (input.consumeKey('Digit0')) this.select(-1);
    const wheel = input.consumeWheel();
    if (wheel !== 0) this._cycle(wheel);

    const d = this.def;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sinceShot += dt;
    this.heat = Math.max(0, this.heat - dt * 2.2);
    this.hitTimer = Math.max(0, this.hitTimer - dt);
    this.headshotTimer = Math.max(0, this.headshotTimer - dt);

    this.aiming = !!d && input.mouse.right;
    this.engine.setAim(this.aiming);

    if (d) {
      if (input.consume('reload')) this._startReload();

      if (this.reloading > 0) {
        this.reloading -= dt;
        if (this.reloading <= 0) { this.reloading = 0; this._finishReload(); }
      }

      const wantFire = d.auto ? input.mouse.left : input.consumeFirePress();
      if (wantFire && this.cooldown <= 0 && this.reloading <= 0) {
        const a = this.ammo[this.current];
        if (a.mag > 0) {
          a.mag--;
          this._fire(d, camState);
          this.cooldown = d.rate;
          this.sinceShot = 0;
          if (a.mag === 0 && a.reserve > 0) this._startReload();
        } else {
          this.audio.dryClick();
          this.cooldown = 0.3;
          this._startReload();
        }
      }
    }

    const move = Math.min(this.player.speed / 8, 1);
    const target = d ? (this.aiming ? 0.25 : 0.6) + move * 0.25 + this.heat * 0.5 : 0;
    this.crosshairSpread += (target - this.crosshairSpread) * (1 - Math.exp(-14 * dt));

    this._updateEffects(dt);

    return !!d && (this.aiming || input.mouse.left || this.sinceShot < 1.5);
  }

  _fire(d, camState) {
    const cam = this.engine.camera;
    cam.getWorldDirection(this._fwd);
    this._right.setFromMatrixColumn(cam.matrixWorld, 0);
    this._up.setFromMatrixColumn(cam.matrixWorld, 1);

    const p = this.player.position;
    const toPlayer = (p.x - cam.position.x) * this._fwd.x + (p.y + 1.4 - cam.position.y) * this._fwd.y + (p.z - cam.position.z) * this._fwd.z;
    const off = Math.max(0.5, toPlayer);
    this._origin.copy(cam.position).addScaledVector(this._fwd, off);

    const model = this.models[this.current];
    model.userData.muzzle.getWorldPosition(this._muzzle);

    const move = Math.min(this.player.speed / 8, 1);
    const spread = d.spread * (this.aiming ? 0.4 : 1) * (1 + this.heat * 1.5 + move * 0.8);

    if (this.peds) this.peds.alertNearby(p.x, p.z, 45);

    let impactSound = false;
    for (let i = 0; i < d.pellets; i++) {
      this._dir.copy(this._fwd)
        .addScaledVector(this._right, (Math.random() - 0.5) * 2 * spread)
        .addScaledVector(this._up, (Math.random() - 0.5) * 2 * spread)
        .normalize();

      const o = this._origin, dir = this._dir, R = d.range;
      const res = this.physics.raycast(
        o.x, o.y, o.z, o.x + dir.x * R, o.y + dir.y * R, o.z + dir.z * R,
        GROUP.GROUND | GROUP.STATIC | GROUP.DYNAMIC | GROUP.VEHICLE
      );

      let maxD = res.hasHit ? res.distance : R;
      const pedHit = this.peds ? this.peds.checkBulletHit(o, dir, maxD) : null;
      const copHit = this.police ? this.police.checkBulletHit(o, dir, pedHit ? pedHit.dist : maxD) : null;

      if (copHit) {
        this._end.copy(o).addScaledVector(dir, copHit.dist);
        this.hitTimer = 0.22;
        if (copHit.headshot) this.headshotTimer = 0.55;
        this.audio.hitMarker();
      } else if (pedHit) {
        this._end.copy(o).addScaledVector(dir, pedHit.dist);
        this.hitTimer = 0.22;
        if (pedHit.headshot) this.headshotTimer = 0.55;
        this.audio.hitMarker();
      } else if (res.hasHit) {
        const hp = res.hitPointWorld;
        this._end.set(hp.x, hp.y, hp.z);
        const body = res.body;
        const dynamic = body && body.collisionFilterGroup === GROUP.DYNAMIC;
        const isVeh = body && body.collisionFilterGroup === GROUP.VEHICLE;

        if (dynamic) {
          this._imp.set(dir.x * d.force, dir.y * d.force, dir.z * d.force);
          this._rel.set(hp.x - body.position.x, hp.y - body.position.y, hp.z - body.position.z);
          body.wakeUp();
          body.applyImpulse(this._imp, this._rel);
          this.hitTimer = 0.18;
          this.audio.hitMarker();
        } else if (isVeh && this.vehicles) {
          const hitCar = this.vehicles.find((v) => v.body === body);
          if (hitCar) {
            hitCar.damage(d.dmg * 0.45);
            this.hitTimer = 0.15;
            this.audio.hitMarker();
          }
        }
        this._spawnSparks(hp, res.hitNormalWorld, dynamic ? 3 : 5);
        if (!impactSound) { this.audio.impact(dynamic ? 'wood' : 'concrete'); impactSound = true; }
      } else {
        this._end.copy(o).addScaledVector(dir, Math.min(R, 120));
      }
      this._spawnTracer(this._muzzle, this._end);
    }

    this.audio.shoot(d.sound);
    this.flash.position.copy(this._muzzle);
    this.flash.scale.setScalar(0.7 + Math.random() * 0.7);
    this.flash.rotation.z = Math.random() * 6.28;
    this.flash.visible = true;
    this.flashTimer = 0.045;
    this.flashLight.position.copy(this._muzzle);
    this.flashLight.intensity = 6;

    const k = this.aiming ? 0.6 : 1;
    camState.pitch -= d.recoil * k * (0.8 + Math.random() * 0.4);
    camState.yaw += (Math.random() - 0.5) * d.recoil * 0.6;
    this.engine.addShake(d.shake * k);
    this.heat = Math.min(1, this.heat + d.heat);
  }

  _spawnTracer(from, to) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.8) return;
    const t = this.tracers.acquire();
    this._mid.set(from.x + dx / 2, from.y + dy / 2, from.z + dz / 2);
    t.position.copy(this._mid);
    t.scale.set(1, 1, len);
    t.lookAt(to);
  }

  _spawnSparks(point, normal, n) {
    for (let i = 0; i < n; i++) {
      const s = this.sparks.acquire();
      s.position.set(point.x, point.y, point.z);
      s.userData.vel.set(
        normal.x * 3 + (Math.random() - 0.5) * 3,
        normal.y * 3 + Math.random() * 2.5,
        normal.z * 3 + (Math.random() - 0.5) * 3
      );
    }
  }

  _updateEffects(dt) {
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      if (this.flashTimer <= 0) { this.flash.visible = false; this.flashLight.intensity = 0; }
    }

    const tr = this.tracers.active;
    for (let i = tr.length - 1; i >= 0; i--) {
      const t = tr[i];
      t.userData.life -= dt;
      if (t.userData.life <= 0) this.tracers.release(t);
    }

    const sp = this.sparks.active;
    for (let i = sp.length - 1; i >= 0; i--) {
      const s = sp[i], v = s.userData.vel;
      s.userData.life -= dt;
      if (s.userData.life <= 0) { this.sparks.release(s); continue; }
      v.y -= 9.8 * dt;
      s.position.x += v.x * dt; s.position.y += v.y * dt; s.position.z += v.z * dt;
      if (s.position.y < 0.02) { s.position.y = 0.02; v.set(0, 0, 0); }
    }
  }
}
