import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { Engine } from './core/Engine.js?v=10';
import { Physics, GROUP } from './core/Physics.js?v=10';
import { InputManager } from './core/InputManager.js?v=10';
import { AudioManager } from './core/AudioManager.js?v=10';
import { createTextures } from './core/Textures.js?v=10';
import { CityBuilder } from './world/CityBuilder.js?v=10';
import { Player } from './entities/Player.js?v=10';
import { WeaponSystem } from './systems/WeaponSystem.js?v=10';
import { PedestrianSystem } from './systems/PedestrianSystem.js?v=10';
import { PoliceSystem } from './systems/PoliceSystem.js?v=10';
import { TrafficSystem } from './systems/TrafficSystem.js?v=10';
import { HUD } from './ui/HUD.js?v=10';
import { Menus } from './ui/Menus.js?v=10';
import { TouchControls } from './ui/Touch.js?v=10';
import { Extras } from './ui/Extras.js?v=10';

/**
 * main.js — инициализация и главный игровой цикл.
 */
window.__gameStarted = true;

const canvas = document.getElementById('game');
const overlay = document.getElementById('overlay');
const resumeBtn = document.getElementById('resume');

const textures = createTextures();
const engine = new Engine(canvas, textures.sky);
const physics = new Physics();
const input = new InputManager(canvas, overlay, resumeBtn);
const audio = new AudioManager();

// ---------- Мир ----------
const city = new CityBuilder(engine.scene, physics, textures);
city.build();
const minimapCanvas = city.createMinimapCanvas();

// ---------- Игрок, оружие, пешеходы, полиция, трафик ----------
const player = new Player(physics, engine.scene, audio);
const weapons = new WeaponSystem(engine, physics, audio, player);
const peds = new PedestrianSystem(engine.scene, audio, player, physics);
const police = new PoliceSystem(physics, engine.scene, audio, player);
const traffic = new TrafficSystem(physics, engine.scene, audio, player, engine, peds, weapons);

const allVehicles = () => traffic.vehicles.concat(police.cruisers);

weapons.peds = peds;
weapons.police = police;
peds.onCrime = (sev) => police.addWanted(sev);
traffic.onCrime = (sev) => police.addWanted(sev);

// 3D GPS-маяк для метки на карте
const waypointBeacon = new THREE.Mesh(
  new THREE.CylinderGeometry(0.45, 0.45, 90, 12, 1, true),
  new THREE.MeshBasicMaterial({
    color: 0xf2c744, transparent: true, opacity: 0.35,
    side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
  })
);
waypointBeacon.visible = false;
engine.scene.add(waypointBeacon);

// ---------- Динамические ящики ----------
const CRATES = 36;
const crateMesh = new THREE.InstancedMesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ map: textures.crate, roughness: 0.85 }),
  CRATES
);
crateMesh.castShadow = true;
crateMesh.receiveShadow = true;
crateMesh.frustumCulled = false;
engine.scene.add(crateMesh);

const crateBodies = [];
for (let i = 0; i < CRATES; i++) {
  const body = new CANNON.Body({
    mass: 15,
    material: physics.mat.body,
    collisionFilterGroup: GROUP.DYNAMIC,
    allowSleep: true,
    sleepSpeedLimit: 0.2,
    sleepTimeLimit: 1,
  });
  body.addShape(new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)));
  const layer = Math.floor(i / 9), idx = i % 9;
  body.position.set(16 + (idx % 3) * 1.05, 0.52 + layer * 1.02, -6 + Math.floor(idx / 3) * 1.05);
  physics.world.addBody(body);
  crateBodies.push(body);
}
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
function syncCrates() {
  for (let i = 0; i < CRATES; i++) {
    const b = crateBodies[i];
    _p.set(b.position.x, b.position.y, b.position.z);
    _q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    _m4.compose(_p, _q, _one);
    crateMesh.setMatrixAt(i, _m4);
  }
  crateMesh.instanceMatrix.needsUpdate = true;
}
syncCrates();

engine.cameraCollide = (fx, fy, fz, tx, ty, tz) => {
  const r = physics.raycast(fx, fy, fz, tx, ty, tz, GROUP.STATIC);
  return r.hasHit ? r.distance : -1;
};

// ---------- UI ----------
const gameApi = {
  player,
  weapons,
  wanted: () => police.wanted,
  allVehicles,
  nearestCar: () => traffic.findNearestVehicle(allVehicles(), 4.0),
};
const hud = new HUD(gameApi, minimapCanvas);
const menus = new Menus({ engine, audio, input, city, hud, game: gameApi });

const touch = input.touch ? new TouchControls(input) : null;
const extras = new Extras({ input, player, weapons, hud, physics, audio });

// ---------- Асинхронная загрузка 3D города и НПС ----------
resumeBtn.disabled = true;
resumeBtn.textContent = 'ЗАГРУЗКА ГОРОДА И НПС...';
let cityPct = 0, npcPct = 0;
const updateLoadText = () => {
  const pct = Math.min(99, Math.round(cityPct * 85 + npcPct * 15));
  resumeBtn.textContent = `ЗАГРУЗКА 3D-МИРА... ${pct}%`;
};

Promise.all([
  city.loadCity((p) => { cityPct = p; updateLoadText(); }),
  peds.loadModels((p) => { npcPct = p; updateLoadText(); }).catch((e) => console.warn('NPC GLB не загрузился, играем без них:', e)),
]).then(() => {
  city.refreshMinimapCanvas();
  traffic.relocateAllClear();
  // Ставим игрока на свободную дорогу рядом с центром
  for (let r = 0; r < 80; r += 4) {
    let found = false;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const tx = Math.cos(ang) * r, tz = Math.sin(ang) * r;
      if (!physics.raycast(tx, 25, tz, tx, 0.3, tz, GROUP.STATIC).hasHit) {
        player.body.position.set(tx, 0.2, tz);
        player.position.set(tx, 0.2, tz);
        found = true;
        break;
      }
    }
    if (found) break;
  }
  menus.drawFullMap();
  resumeBtn.disabled = false;
  resumeBtn.textContent = 'НАЧАТЬ ИГРУ';
}).catch((err) => {
  console.error('Ошибка загрузки GLB:', err);
  alert('Город не загрузился: ' + (err && (err.message || err.target?.status || err)) + '\nПроверь, что файл лежит в assets/models/city.glb');
  resumeBtn.disabled = false;
  resumeBtn.textContent = 'НАЧАТЬ ИГРУ (БЕЗ 3D-МОДЕЛЕЙ)';
});

const camState = { yaw: 0, pitch: 0.2 };
const look = { x: 0, y: 0 };
let paused = true;
let hasStartedOnce = false;
let wastedTimer = 0;
let cinematicTime = 0;

input.onLockChange = (locked) => {
  paused = !locked;
  if (touch) touch.setActive(locked);
  if (!locked) extras.renderShop();
  if (locked) {
    hasStartedOnce = true;
    audio.init();
  } else {
    audio.updateVehicleEngine(false, 0);
    audio.updatePoliceSiren(false, 0, 999);
    if (hasStartedOnce) menus.setStartMode(false);
  }
  clock.getDelta();
};
resumeBtn.addEventListener('click', () => audio.init());

// ---------- Игровой цикл ----------
const clock = new THREE.Clock();
let fpsAcc = 0, fpsFrames = 0, fps = 0, debugText = '';

function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (paused) {
    hud.updateWeaponWheel(input, true);
    if (!hasStartedOnce) {
      cinematicTime += dt;
      engine.updateCinematicCamera(cinematicTime, dt);
      // Лёгкое движение трафика на фоне стартового меню
      physics.step(dt);
      traffic.update(dt, input, engine.env.nightFactor, police.cruisers);
    }
  } else {
    if (player.dead) {
      wastedTimer += dt;
      audio.updateVehicleEngine(false, 0);
      if (wastedTimer > 3.2) {
        wastedTimer = 0;
        police.clearWanted();
        player.respawn();
        engine.setVehicleMode(false);
      }
    } else {
      const wheelOpen = hud.updateWeaponWheel(input, paused);
      const simDt = wheelOpen ? dt * 0.22 : dt;

      if (!wheelOpen) {
        input.getLook(look, weapons.aiming ? 0.6 : 1);
        camState.yaw -= look.x;
        camState.pitch = Math.max(-0.25, Math.min(1.2, camState.pitch + look.y));

        if (input.consume('interact')) {
          traffic.handleInteract(allVehicles());
        }
      }

      weapons.vehicles = allVehicles();
      const faceCam = wheelOpen ? false : weapons.update(input, simDt, camState);
      camState.pitch = Math.max(-0.25, Math.min(1.2, camState.pitch));

      player.update(input, camState.yaw, simDt, faceCam);
      traffic.update(simDt, input, engine.env.nightFactor, police.cruisers);
      police.update(simDt, engine.env.nightFactor);
      peds.update(simDt, allVehicles());
      extras.update(simDt);

      physics.step(simDt);
      player.syncMesh();
      syncCrates();

      // Обновляем 3D-маяк GPS
      if (hud.waypoint) {
        waypointBeacon.visible = true;
        waypointBeacon.position.set(hud.waypoint.x, 45, hud.waypoint.z);
        if (Math.hypot(player.position.x - hud.waypoint.x, player.position.z - hud.waypoint.z) < 8) {
          hud.waypoint = null;
          waypointBeacon.visible = false;
        }
      } else {
        waypointBeacon.visible = false;
      }

      const speedBoost = player.inVehicle ? Math.min(14, player.inVehicle.speed * 0.4) : 0;
      const fovBoost = player.rolling > 0 ? 8 : (player.sprinting ? 9 : speedBoost);
      engine.updateCamera(player.position, camState.yaw, camState.pitch, dt, fovBoost);
      engine.followShadow(player.position);
    }
  }

  engine.render();
  hud.frame(dt, camState.yaw, debugText);
  input.endFrame();

  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 0.5) {
    fps = Math.round(fpsFrames / fpsAcc);
    fpsAcc = 0; fpsFrames = 0;
    const p = player.position, r = engine.renderer.info.render;
    debugText =
      `FPS ${fps}  draws ${r.calls}  tris ${r.triangles}\n` +
      `pos ${p.x.toFixed(0)} ${p.y.toFixed(1)} ${p.z.toFixed(0)}  v ${player.speed.toFixed(1)}`;
  }
}
frame();
