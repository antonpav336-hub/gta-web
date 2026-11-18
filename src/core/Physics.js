import * as CANNON from 'cannon-es';

/**
 * Physics — мир cannon-es, материалы, фиксированный шаг и лучи.
 * Группы столкновений: GROUND, STATIC, PLAYER, VEHICLE, DYNAMIC.
 */
export const GROUP = {
  GROUND: 1,
  STATIC: 2,
  PLAYER: 4,
  VEHICLE: 8,
  DYNAMIC: 16,
};

export class Physics {
  constructor() {
    this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    this.world.allowSleep = true;
    this.world.defaultContactMaterial.friction = 0.25;
    this.world.solver.iterations = 8;

    this.mat = {
      ground: new CANNON.Material('ground'),
      player: new CANNON.Material('player'),
      wheel: new CANNON.Material('wheel'),
      body: new CANNON.Material('body'),
      vehicle: new CANNON.Material('vehicle'),
    };
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.mat.player, this.mat.ground, { friction: 0.0, restitution: 0.0 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.mat.wheel, this.mat.ground, { friction: 0.9, restitution: 0.0 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.mat.body, this.mat.ground, { friction: 0.4, restitution: 0.05 }));
    // Машины скользят по земле без зацепов о плоскость, а сцепление считается в Vehicle.drive()
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.mat.vehicle, this.mat.ground, { friction: 0.0, restitution: 0.02 }));
    this.world.addContactMaterial(new CANNON.ContactMaterial(
      this.mat.vehicle, this.mat.vehicle, { friction: 0.05, restitution: 0.2 }));

    this.fixedStep = 1 / 60;
    this.maxSubSteps = 3;
    this.maxDt = 0.1;

    this._rayResult = new CANNON.RaycastResult();
    this._from = new CANNON.Vec3();
    this._to = new CANNON.Vec3();
  }

  addGround() {
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.mat.ground,
      collisionFilterGroup: GROUP.GROUND,
    });
    body.addShape(new CANNON.Plane());
    body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(body);
    return body;
  }

  addStaticBox(x, y, z, w, h, d) {
    const body = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.mat.ground,
      collisionFilterGroup: GROUP.STATIC,
    });
    body.addShape(new CANNON.Box(new CANNON.Vec3(w / 2, h / 2, d / 2)));
    body.position.set(x, y, z);
    this.world.addBody(body);
    return body;
  }

  step(dt) {
    this.world.step(this.fixedStep, Math.min(dt, this.maxDt), this.maxSubSteps);
  }

  raycast(fx, fy, fz, tx, ty, tz, mask = GROUP.GROUND | GROUP.STATIC) {
    this._from.set(fx, fy, fz);
    this._to.set(tx, ty, tz);
    this._rayResult.reset();
    this.world.raycastClosest(this._from, this._to,
      { collisionFilterMask: mask, skipBackfaces: true }, this._rayResult);
    return this._rayResult;
  }
}
