import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP } from '../core/Physics.js?v=10';

/**
 * Vehicle — реалистичный автомобиль с физикой cannon-es, clearcoat-покраской,
 * отражающими стёклами, крутящимися колёсами, фарами/стопами и мигалкой полиции.
 */

export const VEHICLE_TYPES = {
  sedan:  { name: 'Седан',       w: 1.9, h: 0.65, l: 4.3, cabH: 0.56, cabL: 2.2, maxSpeed: 28, accel: 16, grip: 8.5, mass: 1350 },
  sports: { name: 'Спорткар',    w: 2.0, h: 0.54, l: 4.4, cabH: 0.46, cabL: 1.9, maxSpeed: 38, accel: 24, grip: 10.5, mass: 1200 },
  suv:    { name: 'Внедорожник', w: 2.1, h: 0.78, l: 4.6, cabH: 0.66, cabL: 2.8, maxSpeed: 25, accel: 14, grip: 7.5, mass: 1850 },
  taxi:   { name: 'Такси',       w: 1.9, h: 0.65, l: 4.3, cabH: 0.56, cabL: 2.2, maxSpeed: 27, accel: 16, grip: 8.5, mass: 1350 },
  police: { name: 'Полиция',     w: 1.96, h: 0.66, l: 4.5, cabH: 0.56, cabL: 2.3, maxSpeed: 34, accel: 21, grip: 9.8, mass: 1450 },
};

const PAINT_COLORS = [
  0xb82929, 0x224c8a, 0x2c3038, 0xd8dce3, 0x3b6b4c, 0x707782, 0xc77d24, 0x4b2c5e, 0x1a1c20,
];

const _glassMat = new THREE.MeshPhysicalMaterial({
  color: 0x101822,
  metalness: 0.15,
  roughness: 0.05,
  clearcoat: 1.0,
  clearcoatRoughness: 0.05,
  envMapIntensity: 1.8,
});
const _tireMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.85, metalness: 0.05 });
const _rimMat = new THREE.MeshStandardMaterial({ color: 0xc2c8d1, roughness: 0.25, metalness: 0.85 });
const _bumperMat = new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 0.55, metalness: 0.3 });

export class Vehicle {
  constructor(physics, scene, type = 'sedan', x = 0, z = 0, yaw = 0, color = null) {
    this.physics = physics;
    this.scene = scene;
    this.type = type;
    this.spec = VEHICLE_TYPES[type] || VEHICLE_TYPES.sedan;

    this.occupant = null;
    this.sirenOn = false;
    this.health = 100;
    this.destroyed = false;
    this.speed = 0;
    this.forwardSpeed = 0;
    this.steerAngle = 0;
    this.braking = false;
    this._wheelSpin = 0;
    this._sirenPhase = Math.random() * 6.28;

    const s = this.spec;
    this.body = new CANNON.Body({
      mass: s.mass,
      material: physics.mat.vehicle,
      linearDamping: 0.03,
      angularDamping: 0.85,
      collisionFilterGroup: GROUP.VEHICLE,
      collisionFilterMask: GROUP.GROUND | GROUP.STATIC | GROUP.VEHICLE | GROUP.PLAYER | GROUP.DYNAMIC,
      allowSleep: false,
    });
    const totalH = s.h + s.cabH * 0.65;
    // Чуть скруглённый/уменьшенный по краям бокс, чтобы не цеплялся за углы зданий и землю
    this.body.addShape(
      new CANNON.Box(new CANNON.Vec3(s.w * 0.47, totalH * 0.48, s.l * 0.47)),
      new CANNON.Vec3(0, 0.44 + totalH * 0.48, 0)
    );
    this.body.position.set(x, 0.04, z);
    this.body.quaternion.setFromEuler(0, yaw, 0);
    physics.world.addBody(this.body);

    const paintHex = type === 'taxi' ? 0xe8b923
      : type === 'police' ? 0x161920
      : (color ?? PAINT_COLORS[Math.floor(Math.random() * PAINT_COLORS.length)]);

    this._buildMesh(paintHex);
    this.syncMesh();
  }

  _buildMesh(paintHex) {
    const s = this.spec;
    this.mesh = new THREE.Group();
    this.bodyGroup = new THREE.Group();
    this.mesh.add(this.bodyGroup);

    const paintMat = new THREE.MeshPhysicalMaterial({
      color: paintHex,
      metalness: 0.42,
      roughness: 0.22,
      clearcoat: 1.0,
      clearcoatRoughness: 0.07,
      envMapIntensity: 1.4,
    });

    this.paintMat = paintMat;
    const wheelR = this.type === 'suv' ? 0.40 : 0.34;
    const bodyY = wheelR * 0.7 + s.h / 2;

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.l), paintMat);
    chassis.position.set(0, bodyY, 0);
    chassis.castShadow = true;
    chassis.receiveShadow = true;
    this.bodyGroup.add(chassis);

    if (this.type === 'police') {
      const whiteMat = new THREE.MeshPhysicalMaterial({
        color: 0xf2f4f7, metalness: 0.2, roughness: 0.2, clearcoat: 1.0,
      });
      const doors = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.02, s.h * 0.85, s.l * 0.42), whiteMat);
      doors.position.set(0, bodyY, 0.05);
      this.bodyGroup.add(doors);
    }

    const fBumper = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.04, 0.18, 0.16), _bumperMat);
    fBumper.position.set(0, wheelR * 0.65, -s.l / 2 - 0.03);
    const rBumper = fBumper.clone();
    rBumper.position.z = s.l / 2 + 0.03;
    this.bodyGroup.add(fBumper, rBumper);

    const cabY = bodyY + s.h / 2 + s.cabH / 2 - 0.02;
    const cabZ = this.type === 'suv' ? 0.2 : 0.15;
    const cab = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.86, s.cabH, s.cabL), paintMat);
    cab.position.set(0, cabY, cabZ);
    cab.castShadow = true;
    this.bodyGroup.add(cab);

    const glassSide = new THREE.Mesh(
      new THREE.BoxGeometry(s.w * 0.87, s.cabH * 0.74, s.cabL * 0.88),
      _glassMat
    );
    glassSide.position.set(0, cabY + 0.02, cabZ);
    const glassFront = new THREE.Mesh(
      new THREE.BoxGeometry(s.w * 0.80, s.cabH * 0.74, s.cabL + 0.03),
      _glassMat
    );
    glassFront.position.set(0, cabY + 0.02, cabZ);
    this.bodyGroup.add(glassSide, glassFront);

    if (this.type === 'sports') {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.9, 0.07, 0.28), _bumperMat);
      wing.position.set(0, bodyY + s.h / 2 + 0.18, s.l / 2 - 0.22);
      this.bodyGroup.add(wing);
    }

    if (this.type === 'taxi') {
      const sign = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, 0.16, 0.25),
        new THREE.MeshStandardMaterial({ color: 0xffe478, emissive: 0xffb830, emissiveIntensity: 0.7 })
      );
      sign.position.set(0, cabY + s.cabH / 2 + 0.08, cabZ - 0.2);
      this.bodyGroup.add(sign);
    }

    if (this.type === 'police') {
      const barY = cabY + s.cabH / 2 + 0.07;
      this._redMat = new THREE.MeshStandardMaterial({ color: 0xff2222, emissive: 0xff1111, emissiveIntensity: 0.2 });
      this._blueMat = new THREE.MeshStandardMaterial({ color: 0x2266ff, emissive: 0x1155ff, emissiveIntensity: 0.2 });
      const redBar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.24), this._redMat);
      redBar.position.set(-0.26, barY, cabZ);
      const blueBar = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.12, 0.24), this._blueMat);
      blueBar.position.set(0.26, barY, cabZ);
      this.bodyGroup.add(redBar, blueBar);

      this.sirenLight = new THREE.PointLight(0xff2244, 0, 18, 2);
      this.sirenLight.position.set(0, barY + 0.35, cabZ);
      this.bodyGroup.add(this.sirenLight);
    }

    this._headMat = new THREE.MeshStandardMaterial({ color: 0xfff8e0, emissive: 0xfff0c0, emissiveIntensity: 0.3 });
    this._tailMat = new THREE.MeshStandardMaterial({ color: 0xaa1111, emissive: 0xff1a1a, emissiveIntensity: 0.2 });
    for (const sx of [-1, 1]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.14, 0.06), this._headMat);
      hl.position.set(sx * (s.w * 0.33), bodyY + 0.06, -s.l / 2 - 0.01);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.14, 0.06), this._tailMat);
      tl.position.set(sx * (s.w * 0.33), bodyY + 0.08, s.l / 2 + 0.01);
      this.bodyGroup.add(hl, tl);
    }

    const wheelGeo = new THREE.CylinderGeometry(wheelR, wheelR, 0.24, 14);
    wheelGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(wheelR * 0.56, wheelR * 0.56, 0.255, 8);
    rimGeo.rotateZ(Math.PI / 2);

    this.wheels = [];
    this.frontSteers = [];
    const wx = s.w / 2 - 0.06;
    const wz = s.l * 0.33;
    const coords = [
      [-wx, wheelR, -wz, true], [wx, wheelR, -wz, true],
      [-wx, wheelR,  wz, false], [wx, wheelR,  wz, false],
    ];
    for (const [x, y, z, isFront] of coords) {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      const wMesh = new THREE.Group();
      const tire = new THREE.Mesh(wheelGeo, _tireMat);
      tire.castShadow = true;
      const rim = new THREE.Mesh(rimGeo, _rimMat);
      wMesh.add(tire, rim);
      pivot.add(wMesh);
      this.mesh.add(pivot);
      this.wheels.push(wMesh);
      if (isFront) this.frontSteers.push(pivot);
    }

    this.scene.add(this.mesh);
  }

  drive(throttle, steer, handbrake, dt) {
    if (this.destroyed) { throttle = 0; handbrake = true; }
    const b = this.body;
    const s = this.spec;

    // Не даём машине проваливаться или подпрыгивать выше крыши на ровной дороге
    if (b.position.y < 0.01) b.position.y = 0.02;
    if (b.position.y > 0.25 && Math.abs(b.velocity.y) < 1) b.velocity.y = -2;

    const fwd = new CANNON.Vec3(0, 0, -1);
    const right = new CANNON.Vec3(1, 0, 0);
    b.quaternion.vmult(fwd, fwd);
    b.quaternion.vmult(right, right);

    const vx = b.velocity.x, vz = b.velocity.z;
    const fwdSpeed = vx * fwd.x + vz * fwd.z;
    const latSpeed = vx * right.x + vz * right.z;
    this.forwardSpeed = fwdSpeed;
    this.speed = Math.hypot(vx, vz);

    let driveDelta = 0;
    this.braking = false;
    if (throttle > 0.05) {
      if (fwdSpeed < -1) { this.braking = true; driveDelta = s.accel * 1.8 * dt; }
      else if (fwdSpeed < s.maxSpeed) driveDelta = throttle * s.accel * dt;
    } else if (throttle < -0.05) {
      if (fwdSpeed > 1) { this.braking = true; driveDelta = -s.accel * 2.0 * dt; }
      else if (fwdSpeed > -s.maxSpeed * 0.45) driveDelta = throttle * s.accel * 0.75 * dt;
    } else {
      driveDelta = -fwdSpeed * 0.55 * dt;
    }

    if (handbrake) {
      this.braking = true;
      driveDelta = -fwdSpeed * 3.2 * dt;
    }

    const grip = handbrake ? 2.4 : s.grip;
    const latDelta = -latSpeed * Math.min(1, grip * dt);

    b.velocity.x += fwd.x * driveDelta + right.x * latDelta;
    b.velocity.z += fwd.z * driveDelta + right.z * latDelta;

    this.steerAngle += (steer * 0.55 - this.steerAngle) * Math.min(1, 10 * dt);
    const speedFactor = Math.min(1, Math.abs(fwdSpeed) / 4.5);
    const dirSign = fwdSpeed >= -0.2 ? 1 : -1;
    const yawRate = steer * 2.45 * speedFactor * dirSign;

    const euler = new THREE.Euler().setFromQuaternion(
      new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w),
      'YXZ'
    );
    euler.y += yawRate * dt;
    euler.x *= 0.85;
    euler.z *= 0.85;
    const q = new THREE.Quaternion().setFromEuler(euler);
    b.quaternion.set(q.x, q.y, q.z, q.w);

    b.angularVelocity.x *= 0.6;
    b.angularVelocity.z *= 0.6;
  }

  getExitPosition() {
    const off = new CANNON.Vec3(-this.spec.w / 2 - 0.95, 0.1, 0);
    const worldOff = this.body.quaternion.vmult(off);
    return new THREE.Vector3(
      this.body.position.x + worldOff.x,
      Math.max(0.1, this.body.position.y + 0.1),
      this.body.position.z + worldOff.z
    );
  }

  damage(amount) {
    if (this.destroyed) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.destroyed = true;
      this.sirenOn = false;
      this.bodyGroup.children.forEach((c) => {
        if (c.material && c.material.color) c.material.color.multiplyScalar(0.28);
      });
    }
  }

  syncMesh(dt = 0.016, nightFactor = 0) {
    const b = this.body;
    this.mesh.position.set(b.position.x, b.position.y, b.position.z);
    this.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);

    this._wheelSpin -= this.forwardSpeed * dt * 2.8;
    for (const w of this.wheels) w.rotation.x = this._wheelSpin;
    for (const p of this.frontSteers) p.rotation.y = this.steerAngle * 0.65;

    if (this._headMat) {
      const lightsOn = this.occupant !== null || nightFactor > 0.3;
      this._headMat.emissiveIntensity = (lightsOn && !this.destroyed) ? (0.8 + nightFactor * 1.4) : 0.05;
    }
    if (this._tailMat) {
      this._tailMat.emissiveIntensity = this.braking ? 2.4 : (this.occupant ? 0.55 : 0.1);
    }

    if (this.type === 'police' && this.sirenLight) {
      if (this.sirenOn && !this.destroyed) {
        this._sirenPhase += dt * 16;
        const redOn = Math.sin(this._sirenPhase) > 0;
        this._redMat.emissiveIntensity = redOn ? 3.5 : 0.15;
        this._blueMat.emissiveIntensity = redOn ? 0.15 : 3.5;
        this.sirenLight.color.setHex(redOn ? 0xff2222 : 0x2266ff);
        this.sirenLight.intensity = 10;
      } else {
        this._redMat.emissiveIntensity = 0.1;
        this._blueMat.emissiveIntensity = 0.1;
        this.sirenLight.intensity = 0;
      }
    }
  }

  dispose() {
    this.physics.world.removeBody(this.body);
    this.scene.remove(this.mesh);
  }
}
