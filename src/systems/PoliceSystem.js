import * as THREE from 'three';
import { CITY } from '../world/CityBuilder.js?v=7';
import { GROUP } from '../core/Physics.js?v=7';
import { Vehicle } from '../entities/Vehicle.js?v=7';

/**
 * PoliceSystem — система розыска (1–5 звёзд), патрульные машины с объездом препятствий
 * и вооружённые офицеры (мгновенное убийство при попадании в голову).
 */
export class PoliceSystem {
  constructor(physics, scene, audio, player) {
    this.physics = physics;
    this.scene = scene;
    this.audio = audio;
    this.player = player;

    this.wanted = 0;
    this.evadeTimer = 0;
    this.cruisers = [];
    this.officers = [];
    this._time = 0;
    this._spawnCd = 0;
  }

  addWanted(stars = 1) {
    this.wanted = Math.min(5, Math.max(this.wanted, 0) + stars);
    this.evadeTimer = 18 + this.wanted * 5;
  }

  clearWanted() {
    this.wanted = 0;
    this.evadeTimer = 0;
    this.audio.updatePoliceSiren(false, 0, 999);
    for (const c of this.cruisers) {
      if (c !== this.player.inVehicle) c.sirenOn = false;
    }
  }

  _spawnCruiser() {
    const px = this.player.position.x, pz = this.player.position.z;
    const { HALF, SPACING } = CITY;
    const ang = Math.random() * Math.PI * 2;
    const dist = 75 + Math.random() * 45;
    let x = Math.max(-HALF + 25, Math.min(HALF - 25, px + Math.cos(ang) * dist));
    let z = Math.max(-HALF + 25, Math.min(HALF - 25, pz + Math.sin(ang) * dist));

    const rx = Math.round((x + HALF) / SPACING) * SPACING - HALF;
    const rz = Math.round((z + HALF) / SPACING) * SPACING - HALF;
    if (Math.abs(x - rx) < Math.abs(z - rz)) x = rx + 3.8;
    else z = rz + 3.8;

    const yaw = Math.atan2(-(px - x), -(pz - z));
    const car = new Vehicle(this.physics, this.scene, 'police', x, z, yaw);
    car.occupant = 'police';
    car.sirenOn = true;
    car._stuckTimer = 0;
    car._unstuckTimer = 0;
    car._unstuckDir = 1;
    this.cruisers.push(car);

    this._spawnOfficer(x + 2, z + 2, car);
  }

  _spawnOfficer(x, z, car = null) {
    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
    const uni = mat(0x16243d), pants = mat(0x101829), skin = mat(0xe0b48f), cap = mat(0x0f1726), gun = mat(0x1a1c20);
    const box = (w, h, d, m, bx, by, bz) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(bx, by, bz);
      mesh.castShadow = true;
      return mesh;
    };

    const mesh = new THREE.Group();
    const legL = new THREE.Group(); legL.position.set(-0.1, 0.8, 0);
    legL.add(box(0.18, 0.75, 0.2, pants, 0, -0.375, 0));
    const legR = new THREE.Group(); legR.position.set(0.1, 0.8, 0);
    legR.add(box(0.18, 0.75, 0.2, pants, 0, -0.375, 0));

    const armR = new THREE.Group(); armR.position.set(0.3, 1.38, 0);
    armR.add(box(0.13, 0.48, 0.14, uni, 0, -0.24, 0));
    armR.add(box(0.05, 0.07, 0.24, gun, 0, -0.45, -0.14));

    mesh.add(
      legL, legR, armR,
      box(0.46, 0.6, 0.25, uni, 0, 1.12, 0),
      box(0.22, 0.24, 0.22, skin, 0, 1.54, 0),
      box(0.26, 0.08, 0.28, cap, 0, 1.69, -0.02)
    );
    mesh.position.set(x, 0, z);
    this.scene.add(mesh);

    this.officers.push({
      mesh, legL, legR, armR, car,
      x, z, yaw: 0, hp: 70, dead: false, deadTimer: 0,
      shootCd: 1.0 + Math.random(), phase: 0, active: false,
    });
  }

  checkBulletHit(origin, dir, maxDist) {
    let best = null, bestD = maxDist, isHeadshot = false;
    for (const o of this.officers) {
      if (o.dead || !o.active) continue;

      // 1. Голова (мгновенное убийство)
      const hdx = o.x - origin.x, hdy = 1.54 - origin.y, hdz = o.z - origin.z;
      const hProj = hdx * dir.x + hdy * dir.y + hdz * dir.z;
      if (hProj > 0 && hProj < bestD) {
        const hx = origin.x + dir.x * hProj - o.x;
        const hy = origin.y + dir.y * hProj - 1.54;
        const hz = origin.z + dir.z * hProj - o.z;
        if (hx * hx + hy * hy + hz * hz < 0.22 * 0.22) {
          bestD = hProj; best = o; isHeadshot = true;
          continue;
        }
      }

      // 2. Корпус
      const dx = o.x - origin.x, dy = 0.78 - origin.y, dz = o.z - origin.z;
      const proj = dx * dir.x + dy * dir.y + dz * dir.z;
      if (proj < 0 || proj > bestD) continue;
      const cx = origin.x + dir.x * proj - o.x;
      const cy = origin.y + dir.y * proj - 0.78;
      const cz = origin.z + dir.z * proj - o.z;
      if (cx * cx + cz * cz < 0.28 * 0.28 && Math.abs(cy) < 0.65) {
        bestD = proj; best = o; isHeadshot = false;
      }
    }
    if (best) {
      best.hp -= isHeadshot ? 999 : 30;
      this.addWanted(1);
      if (best.hp <= 0) {
        best.dead = true;
        best.deadTimer = 14;
        best.mesh.position.y = 0.2;
        best.mesh.rotation.x = -Math.PI / 2;
        this.audio.pedScream();
        this.player.money += isHeadshot ? 250 : 150;
        this.audio.cashPickup();
      }
      return { officer: best, dist: bestD, headshot: isHeadshot };
    }
    return null;
  }

  update(dt, nightFactor) {
    this._time += dt;
    const px = this.player.position.x, pz = this.player.position.z;

    if (this.wanted > 0) {
      const targetCruisers = Math.min(4, this.wanted);
      this._spawnCd -= dt;
      if (this.cruisers.length < targetCruisers && this._spawnCd <= 0) {
        this._spawnCruiser();
        this._spawnCd = 3.5;
      }
      this.evadeTimer -= dt;
      if (this.evadeTimer <= 0) {
        this.wanted = Math.max(0, this.wanted - 1);
        this.evadeTimer = this.wanted > 0 ? 15 : 0;
      }
    }

    let closestSirenDist = 999;
    let anySiren = false;

    for (let i = this.cruisers.length - 1; i >= 0; i--) {
      const c = this.cruisers[i];
      if (c === this.player.inVehicle) {
        if (c.sirenOn) { anySiren = true; closestSirenDist = 0; }
        c.syncMesh(dt, nightFactor);
        continue;
      }

      const pos = c.body.position;
      const dx = px - pos.x, dz = pz - pos.z;
      const dist = Math.hypot(dx, dz);

      if (c.sirenOn && !c.destroyed) {
        anySiren = true;
        if (dist < closestSirenDist) closestSirenDist = dist;
      }

      if (this.wanted > 0 && c.occupant === 'police' && !c.destroyed) {
        c.sirenOn = true;
        if (dist < 45) this.evadeTimer = Math.max(this.evadeTimer, 14);

        if (c._unstuckTimer > 0) {
          c._unstuckTimer -= dt;
          c.drive(-0.7, c._unstuckDir, false, dt);
        } else {
          const targetYaw = Math.atan2(-dx, -dz);
          const euler = new THREE.Euler().setFromQuaternion(
            new THREE.Quaternion(c.body.quaternion.x, c.body.quaternion.y, c.body.quaternion.z, c.body.quaternion.w),
            'YXZ'
          );
          let diff = Math.atan2(Math.sin(targetYaw - euler.y), Math.cos(targetYaw - euler.y));

          // Объезд зданий двумя лучами-усами
          const yawL = euler.y + 0.38, yawR = euler.y - 0.38;
          const hitL = this.physics.raycast(pos.x, 1.0, pos.z, pos.x - Math.sin(yawL) * 14, 1.0, pos.z - Math.cos(yawL) * 14, GROUP.STATIC).hasHit;
          const hitR = this.physics.raycast(pos.x, 1.0, pos.z, pos.x - Math.sin(yawR) * 14, 1.0, pos.z - Math.cos(yawR) * 14, GROUP.STATIC).hasHit;
          if (hitL && !hitR) diff = -0.9;
          else if (hitR && !hitL) diff = 0.9;
          else if (hitL && hitR) {
            c._unstuckTimer = 1.1;
            c._unstuckDir = Math.random() < 0.5 ? 1 : -1;
          }

          const steer = Math.max(-1, Math.min(1, diff * 2.1));
          const throttle = dist > 16 ? 0.85 : (dist > 10 ? 0.25 : -0.5);
          c.drive(throttle, steer, dist <= 12, dt);

          if (dist > 16 && c.speed < 1.0) {
            c._stuckTimer = (c._stuckTimer || 0) + dt;
            if (c._stuckTimer > 1.3) {
              c._unstuckTimer = 1.1;
              c._unstuckDir = Math.random() < 0.5 ? 1 : -1;
              c._stuckTimer = 0;
            }
          } else {
            c._stuckTimer = 0;
          }
        }

        if (dist > 280) {
          c.dispose();
          this.cruisers.splice(i, 1);
          continue;
        }
      } else {
        c.sirenOn = false;
        c.drive(0, 0, true, dt);
        if (dist > 220 && this.wanted === 0) {
          c.dispose();
          this.cruisers.splice(i, 1);
          continue;
        }
      }
      c.syncMesh(dt, nightFactor);
    }

    this.audio.updatePoliceSiren(anySiren, this._time, closestSirenDist);

    for (let i = this.officers.length - 1; i >= 0; i--) {
      const o = this.officers[i];
      if (o.dead) {
        o.deadTimer -= dt;
        if (o.deadTimer <= 0) {
          this.scene.remove(o.mesh);
          this.officers.splice(i, 1);
        }
        continue;
      }

      if (this.wanted === 0) {
        o.active = false;
        o.mesh.visible = false;
        continue;
      }

      if (!o.active) {
        if (o.car && (o.car.occupant !== 'police' || o.car.destroyed ||
          Math.hypot(o.car.body.position.x - px, o.car.body.position.z - pz) < 24)) {
          o.active = true;
          o.x = o.car.body.position.x + 2.2;
          o.z = o.car.body.position.z + 1.5;
          o.mesh.visible = true;
        } else {
          o.mesh.visible = false;
          continue;
        }
      }

      const dx = px - o.x, dz = pz - o.z;
      const dist = Math.hypot(dx, dz);
      o.yaw = Math.atan2(-dx, -dz);

      if (dist > 14 && dist < 80) {
        const spd = 4.6;
        o.x -= Math.sin(o.yaw) * spd * dt;
        o.z -= Math.cos(o.yaw) * spd * dt;
        o.phase += spd * dt * 2.2;
        const sw = Math.sin(o.phase) * 0.7;
        o.legL.rotation.x = sw;
        o.legR.rotation.x = -sw;
      } else {
        o.legL.rotation.x = 0;
        o.legR.rotation.x = 0;
      }

      o.armR.rotation.set(1.45, 0, 0);
      o.mesh.position.set(o.x, 0, o.z);
      o.mesh.rotation.set(0, o.yaw, 0);

      o.shootCd -= dt;
      if (o.shootCd <= 0 && dist < 48 && !this.player.dead) {
        o.shootCd = 0.85 + Math.random() * 0.65;
        this.audio.shoot({ dur: 0.12, f0: 3200, f1: 500, gain: 0.25, thump: 160, thumpDur: 0.07 });
        const accuracy = this.player.inVehicle ? 0.25 : 0.45;
        if (Math.random() < accuracy) {
          this.player.takeDamage(this.player.inVehicle ? 4 : 8);
        }
      }
    }
  }
}
