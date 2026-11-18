import * as THREE from 'three';
import { CITY } from '../world/CityBuilder.js?v=7';
import { GROUP } from '../core/Physics.js?v=7';
import { Vehicle } from '../entities/Vehicle.js?v=7';

/**
 * TrafficSystem — городской трафик + угон и вождение машин на клавишу E.
 * Машины ездят по правой полосе, объезжают препятствия и выезжают из заторов без застревания.
 */

const ARCHETYPES = ['sedan', 'sedan', 'suv', 'taxi', 'sports'];

export class TrafficSystem {
  constructor(physics, scene, audio, player, engine, peds, weapons) {
    this.physics = physics;
    this.scene = scene;
    this.audio = audio;
    this.player = player;
    this.engine = engine;
    this.peds = peds;
    this.weapons = weapons;

    this.vehicles = [];
    this.aiData = new Map();
    this.maxTraffic = 22;
    this.onCrime = null;

    this._spawnInitial();
  }

  _spawnInitial() {
    const starter = new Vehicle(this.physics, this.scene, 'sports', 4.0, 16, 0, 0xc82828);
    starter.occupant = null;
    this.vehicles.push(starter);

    for (let i = 0; i < this.maxTraffic; i++) {
      const v = this._spawnTrafficCar(i < 4 ? this.player.position : null);
      this.vehicles.push(v);
    }
  }

  _pickRoadSlot(nearPos = null) {
    const H = CITY.HALF - 22;
    let x = 0, z = 0;
    for (let tries = 0; tries < 18; tries++) {
      if (nearPos) {
        const ang = Math.random() * 6.28;
        const dist = 30 + Math.random() * 140;
        x = Math.max(-H, Math.min(H, nearPos.x + Math.cos(ang) * dist));
        z = Math.max(-H, Math.min(H, nearPos.z + Math.sin(ang) * dist));
      } else {
        x = (Math.random() * 2 - 1) * H;
        z = (Math.random() * 2 - 1) * H;
      }
      const hit = this.physics.raycast(x, 25, z, x, 0.3, z, GROUP.STATIC);
      if (!hit.hasHit) break;
    }
    const yaw = [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(Math.random() * 4)];
    return { x, z, yaw, axis: 'free', dir: 1, roadCoord: 0 };
  }

  relocateAllClear() {
    for (const v of this.vehicles) {
      if (v === this.player.inVehicle) continue;
      const slot = this._pickRoadSlot(this.player.position);
      v.body.position.set(slot.x, 0.08, slot.z);
      v.body.velocity.set(0, 0, 0);
      v.body.angularVelocity.set(0, 0, 0);
      v.body.quaternion.setFromEuler(0, slot.yaw, 0);
    }
  }

  _spawnTrafficCar(nearPos = null) {
    const slot = this._pickRoadSlot(nearPos);
    const type = ARCHETYPES[Math.floor(Math.random() * ARCHETYPES.length)];
    const v = new Vehicle(this.physics, this.scene, type, slot.x, slot.z, slot.yaw);
    v.occupant = 'npc';
    this.aiData.set(v, {
      axis: slot.axis,
      dir: slot.dir,
      roadCoord: slot.roadCoord,
      targetSpeed: 12 + Math.random() * 6,
      turnCd: 2.0,
      stuckTimer: 0,
      unstuckTimer: 0,
      unstuckDir: 1,
    });
    return v;
  }

  findNearestVehicle(allVehicles, maxDist = 4.0) {
    const px = this.player.position.x, pz = this.player.position.z;
    let best = null, bestD = maxDist * maxDist;
    for (const v of allVehicles) {
      if (v.destroyed) continue;
      const dx = v.body.position.x - px, dz = v.body.position.z - pz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD) { bestD = d2; best = v; }
    }
    return best;
  }

  handleInteract(allVehicles) {
    if (this.player.inVehicle) {
      const v = this.player.inVehicle;
      v.occupant = null;
      v.braking = false;
      const exitPos = v.getExitPosition();
      this.player.setInVehicle(null, exitPos);
      this.engine.setVehicleMode(false);
      this.audio.carDoor();
      this.audio.updateVehicleEngine(false, 0);
      return true;
    }

    const target = this.findNearestVehicle(allVehicles, 4.0);
    if (!target) return false;

    if (target.occupant === 'npc' || target.occupant === 'police') {
      const wasPolice = target.occupant === 'police' || target.type === 'police';
      const ejectPos = target.getExitPosition();
      const euler = new THREE.Euler().setFromQuaternion(target.mesh.quaternion, 'YXZ');
      this.peds.spawnEjectedDriver(ejectPos.x, ejectPos.z, euler.y);
      this.aiData.delete(target);
      if (this.onCrime) this.onCrime(wasPolice ? 2 : 1);
    }

    target.occupant = 'player';
    target.body.wakeUp();
    this.weapons.select(-1);
    this.player.setInVehicle(target);
    this.engine.setVehicleMode(true);
    this.audio.carDoor();
    return true;
  }

  update(dt, input, nightFactor, extraVehicles = []) {
    const allVehicles = extraVehicles.length ? this.vehicles.concat(extraVehicles) : this.vehicles;

    if (this.player.inVehicle) {
      const v = this.player.inVehicle;
      const throttle = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
      const steer = (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);
      const handbrake = input.isDown('jump');

      if (input.consumeKey('KeyH')) this.audio.carHorn();
      if (input.consumeKey('KeyG') && v.type === 'police') v.sirenOn = !v.sirenOn;

      v.drive(throttle, steer, handbrake, dt);
      this.audio.updateVehicleEngine(true, v.speed / v.spec.maxSpeed);
    }

    const px = this.player.position.x, pz = this.player.position.z;
    for (const v of this.vehicles) {
      if (v.occupant === 'npc' && !v.destroyed) {
        const ai = this.aiData.get(v);
        if (ai) {
          this._updateAI(v, ai, dt, allVehicles);
          const d = Math.hypot(v.body.position.x - px, v.body.position.z - pz);
          if (d > 380 || ai.stuckTimer > 5.0) {
            const slot = this._pickRoadSlot(this.player.position);
            v.body.position.set(slot.x, 0.06, slot.z);
            v.body.velocity.set(0, 0, 0);
            v.body.angularVelocity.set(0, 0, 0);
            v.body.quaternion.setFromEuler(0, slot.yaw, 0);
            ai.axis = slot.axis; ai.dir = slot.dir; ai.roadCoord = slot.roadCoord;
            ai.stuckTimer = 0; ai.unstuckTimer = 0;
          }
        }
      } else if (v !== this.player.inVehicle) {
        v.drive(0, 0, true, dt);
      }

      v.syncMesh(dt, nightFactor);
    }
  }

  _updateAI(v, ai, dt, allVehicles) {
    const pos = v.body.position;
    ai.turnCd = Math.max(0, ai.turnCd - dt);

    // Режим выезда задним ходом, если машина уткнулась в препятствие
    if (ai.unstuckTimer > 0) {
      ai.unstuckTimer -= dt;
      v.drive(-0.65, ai.unstuckDir * 0.9, false, dt);
      return;
    }

    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(v.body.quaternion.x, v.body.quaternion.y, v.body.quaternion.z, v.body.quaternion.w),
      'YXZ'
    );
    const fwdX = -Math.sin(euler.y), fwdZ = -Math.cos(euler.y);
    let steer = 0;

    // Разворот у границ города
    if (Math.abs(pos.x) > CITY.HALF - 22 || Math.abs(pos.z) > CITY.HALF - 22) {
      steer = 0.9;
    } else {
      // Объезд зданий двумя лучами
      const yawL = euler.y + 0.38, yawR = euler.y - 0.38;
      const hitL = this.physics.raycast(pos.x, 1.0, pos.z, pos.x - Math.sin(yawL) * 14, 1.0, pos.z - Math.cos(yawL) * 14, GROUP.STATIC).hasHit;
      const hitR = this.physics.raycast(pos.x, 1.0, pos.z, pos.x - Math.sin(yawR) * 14, 1.0, pos.z - Math.cos(yawR) * 14, GROUP.STATIC).hasHit;
      if (hitL && !hitR) steer = -0.85;
      else if (hitR && !hitL) steer = 0.85;
    }

    // Проверка стен/зданий лучом впереди
    const wallHit = this.physics.raycast(
      pos.x, 1.0, pos.z,
      pos.x + fwdX * 9, 1.0, pos.z + fwdZ * 9,
      GROUP.STATIC
    );
    if (wallHit.hasHit) {
      ai.unstuckTimer = 1.1;
      ai.unstuckDir = Math.random() < 0.5 ? 1 : -1;
      v.drive(-0.6, ai.unstuckDir, false, dt);
      return;
    }

    let blocked = false;
    for (const other of allVehicles) {
      if (other === v) continue;
      const dx = other.body.position.x - pos.x;
      const dz = other.body.position.z - pos.z;
      const proj = dx * fwdX + dz * fwdZ;
      if (proj > 0 && proj < 12) {
        const perp = Math.abs(dx * fwdZ - dz * fwdX);
        if (perp < 2.4) { blocked = true; break; }
      }
    }
    if (!blocked && !this.player.inVehicle) {
      const dx = this.player.position.x - pos.x;
      const dz = this.player.position.z - pos.z;
      const proj = dx * fwdX + dz * fwdZ;
      if (proj > 0 && proj < 10 && Math.abs(dx * fwdZ - dz * fwdX) < 2.1) blocked = true;
    }

    if (!blocked && v.speed < 0.9) {
      ai.stuckTimer += dt;
      if (ai.stuckTimer > 1.4) {
        ai.unstuckTimer = 1.1;
        ai.unstuckDir = Math.random() < 0.5 ? 1 : -1;
      }
    } else if (v.speed > 1.5) {
      ai.stuckTimer = 0;
    }

    const throttle = blocked ? -0.45 : (v.speed < ai.targetSpeed ? 0.72 : 0.08);
    v.drive(throttle, steer, blocked && v.speed > 2, dt);
  }
}
