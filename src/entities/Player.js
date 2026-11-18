import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GROUP } from '../core/Physics.js?v=7';

/**
 * Player — пешеход: ходьба, бег, прыжок, кувырок + посадка в авто и получение урона.
 */
export class Player {
  constructor(physics, scene, audio) {
    this.physics = physics;
    this.audio = audio;

    this.walkSpeed = 4.2;
    this.runSpeed = 8.0;
    this.rollSpeed = 11;
    this.rollTime = 0.55;
    this.rollCooldown = 0.9;
    this.jumpSpeed = 6.2;
    this.accel = 40;
    this.airControl = 0.35;
    this.radius = 0.4;

    this.health = 100;
    this.armor = 50;
    this.money = 5000;
    this.inVehicle = null;
    this.dead = false;

    const r = this.radius;
    this.body = new CANNON.Body({
      mass: 70,
      material: physics.mat.player,
      fixedRotation: true,
      allowSleep: false,
      linearDamping: 0.01,
      collisionFilterGroup: GROUP.PLAYER,
      collisionFilterMask: GROUP.GROUND | GROUP.STATIC | GROUP.VEHICLE | GROUP.DYNAMIC,
    });
    this.body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, r, 0));
    this.body.addShape(new CANNON.Sphere(r), new CANNON.Vec3(0, 1.8 - r, 0));
    this.body.position.set(11, 0.05, 11);
    this.body.updateMassProperties();
    physics.world.addBody(this.body);

    this._buildModel(scene);

    this.position = new THREE.Vector3(11, 0.05, 11);
    this.heading = 0;
    this.grounded = false;
    this._wasGrounded = false;
    this._lastVy = 0;
    this.sprinting = false;
    this.rolling = 0;
    this.rollCd = 0;
    this.speed = 0;
    this.armed = false;
    this._stride = 0;
    this._phase = 0;

    this._move = { x: 0, y: 0 };
    this._rollDirX = 0;
    this._rollDirZ = 0;
  }

  _buildModel(scene) {
    const mat = (c, rough = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    const skin = mat(0xe0b48f), shirt = mat(0x2f6fd6), jeans = mat(0x2a2f3c), shoe = mat(0x15161a), hair = mat(0x2a1d14);

    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };

    this.mesh = new THREE.Group();
    this.pivot = new THREE.Group();
    this.pivot.position.y = 0.9;
    const model = new THREE.Group();
    model.position.y = -0.9;
    this.pivot.add(model);
    this.mesh.add(this.pivot);

    const mkLeg = (x) => {
      const leg = new THREE.Group();
      leg.position.set(x, 0.85, 0);
      leg.add(box(0.2, 0.75, 0.22, jeans, 0, -0.375, 0));
      leg.add(box(0.22, 0.12, 0.3, shoe, 0, -0.81, -0.03));
      model.add(leg);
      return leg;
    };
    this.legL = mkLeg(-0.12);
    this.legR = mkLeg(0.12);

    model.add(box(0.5, 0.62, 0.28, shirt, 0, 1.16, 0));
    model.add(box(0.24, 0.26, 0.24, skin, 0, 1.6, 0));
    model.add(box(0.26, 0.1, 0.26, hair, 0, 1.75, 0.01));

    const mkArm = (x) => {
      const arm = new THREE.Group();
      arm.position.set(x, 1.42, 0);
      arm.add(box(0.14, 0.52, 0.16, shirt, 0, -0.26, 0));
      arm.add(box(0.13, 0.12, 0.14, skin, 0, -0.56, 0));
      model.add(arm);
      return arm;
    };
    this.armL = mkArm(-0.34);
    this.armR = mkArm(0.34);

    this.weaponHolder = new THREE.Group();
    this.weaponHolder.position.set(0.3, 1.38, -0.5);
    model.add(this.weaponHolder);

    scene.add(this.mesh);
  }

  setInVehicle(vehicle, exitPos = null) {
    this.inVehicle = vehicle;
    if (vehicle) {
      this.mesh.visible = false;
      this.body.collisionFilterMask = 0;
      this.body.type = CANNON.Body.KINEMATIC;
      this.body.velocity.set(0, 0, 0);
      this.speed = 0;
    } else {
      this.mesh.visible = true;
      this.body.type = CANNON.Body.DYNAMIC;
      this.body.collisionFilterMask = GROUP.GROUND | GROUP.STATIC | GROUP.VEHICLE | GROUP.DYNAMIC;
      if (exitPos) {
        this.body.position.set(exitPos.x, exitPos.y, exitPos.z);
        this.position.set(exitPos.x, exitPos.y, exitPos.z);
      }
      this.body.velocity.set(0, 0, 0);
      this.body.wakeUp();
    }
  }

  takeDamage(amount) {
    if (this.dead) return;
    if (this.armor > 0) {
      const absorb = Math.min(this.armor, amount * 0.65);
      this.armor -= absorb;
      amount -= absorb;
    }
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) {
      this.dead = true;
    }
  }

  respawn() {
    this.dead = false;
    this.health = 100;
    this.armor = 50;
    this.money = Math.max(0, this.money - 250);
    if (this.inVehicle) this.setInVehicle(null);
    this.body.position.set(11, 0.1, 11);
    this.body.velocity.set(0, 0, 0);
    this.position.set(11, 0.1, 11);
    this.mesh.visible = true;
  }

  update(input, camYaw, dt, faceCam) {
    if (this.inVehicle) {
      this.position.copy(this.inVehicle.mesh.position);
      this.body.position.set(this.position.x, -20, this.position.z);
      this.speed = this.inVehicle.speed;
      return;
    }
    if (this.dead) return;

    const body = this.body;
    const mv = input.getMove(this._move);

    const p = body.position;
    const res = this.physics.raycast(p.x, p.y + this.radius, p.z, p.x, p.y - 0.12, p.z);
    this.grounded = res.hasHit;

    if (this.grounded && !this._wasGrounded && this._lastVy < -3) this.audio.land(-this._lastVy);
    this._wasGrounded = this.grounded;
    this._lastVy = body.velocity.y;

    const s = Math.sin(camYaw), c = Math.cos(camYaw);
    const wx = -s * mv.y + c * mv.x;
    const wz = -c * mv.y - s * mv.x;
    const hasInput = (mv.x !== 0 || mv.y !== 0);

    this.sprinting = input.isDown('sprint') && mv.y > 0 && !faceCam;
    const targetSpeed = this.sprinting ? this.runSpeed : (faceCam ? this.walkSpeed * 0.85 : this.walkSpeed);

    this.rollCd = Math.max(0, this.rollCd - dt);
    if (input.consume('roll') && this.grounded && this.rolling <= 0 && this.rollCd <= 0) {
      this.rolling = this.rollTime;
      this.rollCd = this.rollCooldown;
      if (hasInput) { this._rollDirX = wx; this._rollDirZ = wz; }
      else { this._rollDirX = -Math.sin(this.heading); this._rollDirZ = -Math.cos(this.heading); }
      this.audio.roll();
    }

    let vx = body.velocity.x, vz = body.velocity.z;

    if (this.rolling > 0) {
      this.rolling -= dt;
      vx = this._rollDirX * this.rollSpeed;
      vz = this._rollDirZ * this.rollSpeed;
      this.heading = Math.atan2(-this._rollDirX, -this._rollDirZ);
    } else {
      const control = this.grounded ? 1 : this.airControl;
      const dx = wx * targetSpeed - vx, dz = wz * targetSpeed - vz;
      const dist = Math.hypot(dx, dz);
      if (dist > 1e-4) {
        const step = Math.min(dist, this.accel * control * dt);
        vx += (dx / dist) * step;
        vz += (dz / dist) * step;
      }
      let want = this.heading;
      let rate = 14;
      if (faceCam) { want = camYaw; rate = 20; }
      else if (hasInput) want = Math.atan2(-wx, -wz);
      if (faceCam || hasInput) {
        let diff = want - this.heading;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.heading += diff * (1 - Math.exp(-rate * dt));
      }
    }
    body.velocity.x = vx;
    body.velocity.z = vz;

    if (input.consume('jump') && this.grounded && this.rolling <= 0) {
      body.velocity.y = this.jumpSpeed;
      this.audio.jump();
    }

    this.speed = Math.hypot(vx, vz);

    if (this.grounded && this.rolling <= 0 && this.speed > 1) {
      this._stride += this.speed * dt;
      const len = this.sprinting ? 2.5 : 1.9;
      if (this._stride >= len) { this._stride = 0; this.audio.footstep(this.sprinting); }
    }
    this._phase += this.speed * dt * 1.7;
  }

  syncMesh() {
    if (this.inVehicle) {
      this.position.copy(this.inVehicle.mesh.position);
      return;
    }
    const p = this.body.position;
    this.position.set(p.x, p.y, p.z);
    this.mesh.position.set(p.x, p.y, p.z);
    this.mesh.rotation.y = this.heading;

    this.pivot.rotation.x = this.rolling > 0 ? -(1 - this.rolling / this.rollTime) * Math.PI * 2 : 0;

    const amp = Math.min(this.speed / this.runSpeed, 1) * 0.95 * (this.grounded ? 1 : 0.3);
    const sw = Math.sin(this._phase) * amp;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;

    if (this.armed) {
      this.armR.rotation.set(1.5 + sw * 0.04, 0, 0);
      this.armL.rotation.set(1.35, 0, 0.35);
    } else {
      this.armL.rotation.set(-sw, 0, 0);
      this.armR.rotation.set(sw, 0, 0);
    }
  }
}
