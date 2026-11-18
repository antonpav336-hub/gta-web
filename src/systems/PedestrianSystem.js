import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { CITY } from '../world/CityBuilder.js?v=8';
import { GROUP } from '../core/Physics.js?v=8';

/**
 * PedestrianSystem — пешеходы города с 3D моделями из Citizen NPC Pack (npcs.glb).
 * Ходят с объездом зданий, паникуют от выстрелов, мгновенно умирают от хэдшота.
 */

const SHIRTS = [0xd64545, 0x3b82f6, 0x10b981, 0xf59e0b, 0x8b5cf6, 0xec4899, 0xe5e7eb, 0x374151];
const PANTS = [0x1f2937, 0x2c3e50, 0x4b5563, 0x3f2e21, 0x111827];
const SKINS = [0xe8be9e, 0xd4a373, 0xa97c50, 0x6f4e37, 0xf3d2b3];

export class PedestrianSystem {
  constructor(scene, audio, player, physics = null) {
    this.scene = scene;
    this.audio = audio;
    this.player = player;
    this.physics = physics;
    this.peds = [];
    this.maxPeds = 38;
    this.onCrime = null;
    this.npcTemplates = [];

    this._init();
  }

  _init() {
    for (let i = 0; i < this.maxPeds; i++) {
      const p = this._createFallbackPed();
      this._placeRandom(p);
      this.peds.push(p);
    }
  }

  async loadModels(onProgress = null) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        './assets/models/npcs.glb?v=8',
        resolve,
        (xhr) => {
          if (onProgress && xhr.total > 0) onProgress(xhr.loaded / xhr.total);
        },
        reject
      );
    });

    const root = gltf.scene;
    root.updateMatrixWorld(true);

    const templates = [];
    root.traverse((obj) => {
      if (obj.name && obj.name.startsWith('Citizen ') && obj.children.length > 0) {
        // Клонируем и нормализуем рост до 1.75м, ноги на Y=0
        const clone = obj.clone(true);
        clone.position.set(0, 0, 0);
        clone.rotation.set(0, 0, 0);
        clone.scale.set(1, 1, 1);
        clone.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(clone);
        const size = new THREE.Vector3();
        const center = new THREE.Vector3();
        box.getSize(size);
        box.getCenter(center);

        if (size.y > 0.01) {
          const s = 1.75 / size.y;
          const wrap = new THREE.Group();
          clone.scale.setScalar(s);
          clone.position.set(-center.x * s, -box.min.y * s, -center.z * s);
          // В Blender/FBX персонажи часто смотрят в +Z, поворачиваем к -Z
          clone.rotation.y = Math.PI;
          clone.traverse((m) => {
            if (m.isMesh) {
              m.castShadow = true;
              m.receiveShadow = true;
              if (m.material) m.material.envMapIntensity = 0.75;
            }
          });
          wrap.add(clone);
          templates.push(wrap);
        }
      }
    });

    if (!templates.length) return;
    this.npcTemplates = templates;

    // Заменяем временных бокс-пешеходов на новые 3D-модели
    for (let i = 0; i < this.peds.length; i++) {
      const p = this.peds[i];
      this.scene.remove(p.mesh);
      const model = templates[i % templates.length].clone(true);
      p.mesh = model;
      p.isGlb = true;
      p.legL = p.legR = p.armL = p.armR = null;
      this.scene.add(p.mesh);
      this._placeRandom(p);
    }
  }

  _createFallbackPed() {
    const shirtHex = SHIRTS[Math.floor(Math.random() * SHIRTS.length)];
    const pantsHex = PANTS[Math.floor(Math.random() * PANTS.length)];
    const skinHex = SKINS[Math.floor(Math.random() * SKINS.length)];

    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
    const shirt = mat(shirtHex), pants = mat(pantsHex), skin = mat(skinHex);
    const shoe = mat(0x15161a), hair = mat(0x1f1712);

    const box = (w, h, d, m, x, y, z) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };

    const mesh = new THREE.Group();
    const legL = new THREE.Group(); legL.position.set(-0.1, 0.8, 0);
    legL.add(box(0.17, 0.7, 0.19, pants, 0, -0.35, 0));
    legL.add(box(0.18, 0.1, 0.25, shoe, 0, -0.75, -0.02));
    const legR = new THREE.Group(); legR.position.set(0.1, 0.8, 0);
    legR.add(box(0.17, 0.7, 0.19, pants, 0, -0.35, 0));
    legR.add(box(0.18, 0.1, 0.25, shoe, 0, -0.75, -0.02));

    const armL = new THREE.Group(); armL.position.set(-0.3, 1.38, 0);
    armL.add(box(0.12, 0.48, 0.14, shirt, 0, -0.24, 0));
    const armR = new THREE.Group(); armR.position.set(0.3, 1.38, 0);
    armR.add(box(0.12, 0.48, 0.14, shirt, 0, -0.24, 0));

    mesh.add(
      legL, legR, armL, armR,
      box(0.44, 0.58, 0.24, shirt, 0, 1.12, 0),
      box(0.22, 0.24, 0.22, skin, 0, 1.54, 0),
      box(0.24, 0.08, 0.24, hair, 0, 1.68, 0)
    );
    this.scene.add(mesh);

    return {
      mesh, legL, legR, armL, armR, isGlb: false,
      x: 0, z: 0, yaw: 0,
      speed: 1.5 + Math.random() * 0.7,
      phase: Math.random() * 6.28,
      panicTimer: 0,
      stunTimer: 0,
      dead: false,
      deadTimer: 0,
      hp: 50,
    };
  }

  _placeRandom(p, nearPos = null) {
    const H = CITY.HALF - 20;
    let x = 0, z = 0;
    for (let tries = 0; tries < 10; tries++) {
      if (nearPos) {
        const ang = Math.random() * 6.28;
        const dist = 25 + Math.random() * 110;
        x = Math.max(-H, Math.min(H, nearPos.x + Math.cos(ang) * dist));
        z = Math.max(-H, Math.min(H, nearPos.z + Math.sin(ang) * dist));
      } else {
        x = (Math.random() * 2 - 1) * H;
        z = (Math.random() * 2 - 1) * H;
      }
      if (!this.physics) break;
      const hit = this.physics.raycast(x, 12, z, x, 0.2, z, GROUP.STATIC);
      if (!hit.hasHit) break;
    }

    p.x = x;
    p.z = z;
    p.yaw = Math.random() * Math.PI * 2;
    p.dead = false;
    p.hp = 50;
    p.panicTimer = 0;
    p.stunTimer = 0;
    p.mesh.rotation.set(0, p.yaw, 0);
    p.mesh.position.set(p.x, 0, p.z);
  }

  spawnEjectedDriver(x, z, carYaw) {
    let target = this.peds.find((p) => p.dead);
    if (!target) {
      let bestD = -1;
      for (const p of this.peds) {
        const d = (p.x - x) ** 2 + (p.z - z) ** 2;
        if (d > bestD) { bestD = d; target = p; }
      }
    }
    if (!target) return;
    target.x = x;
    target.z = z;
    target.yaw = carYaw + Math.PI / 2;
    target.dead = false;
    target.hp = 50;
    target.stunTimer = 1.1;
    target.panicTimer = 8.0;
    target.mesh.position.set(x, 0.25, z);
    target.mesh.rotation.set(-Math.PI / 2.2, target.yaw, 0);
    this.audio.pedScream();
  }

  alertNearby(x, z, radius = 45) {
    const r2 = radius * radius;
    for (const p of this.peds) {
      if (p.dead) continue;
      const dx = p.x - x, dz = p.z - z;
      if (dx * dx + dz * dz < r2) {
        p.panicTimer = 6 + Math.random() * 4;
        p.yaw = Math.atan2(-dx, -dz);
      }
    }
  }

  checkBulletHit(origin, dir, maxDist) {
    let bestPed = null;
    let bestDist = maxDist;
    let isHeadshot = false;

    for (const p of this.peds) {
      if (p.dead) continue;

      const hdx = p.x - origin.x, hdy = 1.54 - origin.y, hdz = p.z - origin.z;
      const hProj = hdx * dir.x + hdy * dir.y + hdz * dir.z;
      if (hProj > 0 && hProj < bestDist) {
        const hx = origin.x + dir.x * hProj - p.x;
        const hy = origin.y + dir.y * hProj - 1.54;
        const hz = origin.z + dir.z * hProj - p.z;
        if (hx * hx + hy * hy + hz * hz < 0.22 * 0.22) {
          bestDist = hProj;
          bestPed = p;
          isHeadshot = true;
          continue;
        }
      }

      const dx = p.x - origin.x, dy = 0.78 - origin.y, dz = p.z - origin.z;
      const proj = dx * dir.x + dy * dir.y + dz * dir.z;
      if (proj < 0 || proj > bestDist) continue;
      const cx = origin.x + dir.x * proj - p.x;
      const cy = origin.y + dir.y * proj - 0.78;
      const cz = origin.z + dir.z * proj - p.z;
      if (cx * cx + cz * cz < 0.27 * 0.27 && Math.abs(cy) < 0.65) {
        bestDist = proj;
        bestPed = p;
        isHeadshot = false;
      }
    }

    if (bestPed) {
      bestPed.hp -= isHeadshot ? 999 : 25;
      bestPed.panicTimer = 8;
      if (bestPed.hp <= 0) this._killPed(bestPed);
      return { ped: bestPed, dist: bestDist, headshot: isHeadshot };
    }
    return null;
  }

  _killPed(p) {
    if (p.dead) return;
    p.dead = true;
    p.deadTimer = 14;
    p.mesh.position.y = 0.2;
    p.mesh.rotation.x = -Math.PI / 2;
    this.audio.pedScream();
    const cash = 40 + Math.floor(Math.random() * 140);
    this.player.money += cash;
    this.audio.cashPickup();
    if (this.onCrime) this.onCrime(1);
  }

  update(dt, vehicles) {
    const px = this.player.position.x, pz = this.player.position.z;

    for (const p of this.peds) {
      const distPlayer = Math.hypot(p.x - px, p.z - pz);

      if (p.dead) {
        p.deadTimer -= dt;
        if (p.deadTimer <= 0 || distPlayer > 220) {
          this._placeRandom(p, this.player.position);
        }
        continue;
      }

      if (distPlayer > 220) {
        this._placeRandom(p, this.player.position);
        continue;
      }

      if (p.stunTimer > 0) {
        p.stunTimer -= dt;
        if (p.stunTimer <= 0) {
          p.mesh.position.y = 0;
          p.mesh.rotation.set(0, p.yaw, 0);
        }
        continue;
      }

      for (const v of vehicles) {
        if (v.speed < 4.5) continue;
        const vx = v.body.position.x, vz = v.body.position.z;
        const dx = p.x - vx, dz = p.z - vz;
        if (dx * dx + dz * dz < 4.5) {
          this._killPed(p);
          break;
        }
      }
      if (p.dead) continue;

      if (p.panicTimer > 0) p.panicTimer -= dt;
      const spd = p.panicTimer > 0 ? 4.8 : p.speed;
      const nx = p.x - Math.sin(p.yaw) * spd * dt;
      const nz = p.z - Math.cos(p.yaw) * spd * dt;

      // Объезд зданий, чтобы НПС не проходили сквозь стены
      let blocked = Math.abs(nx) > CITY.HALF - 10 || Math.abs(nz) > CITY.HALF - 10;
      if (!blocked && this.physics) {
        blocked = this.physics.raycast(p.x, 0.9, p.z, nx - Math.sin(p.yaw) * 0.8, 0.9, nz - Math.cos(p.yaw) * 0.8, GROUP.STATIC).hasHit;
      }
      if (blocked) {
        p.yaw += Math.PI * 0.65 + (Math.random() - 0.5) * 0.6;
      } else {
        p.x = nx;
        p.z = nz;
      }

      p.phase += spd * dt * 2.4;
      if (p.isGlb) {
        const bob = Math.abs(Math.sin(p.phase)) * 0.055;
        const sway = Math.sin(p.phase) * 0.04;
        p.mesh.position.set(p.x, bob, p.z);
        p.mesh.rotation.set(0, p.yaw, sway);
      } else {
        const sw = Math.sin(p.phase) * 0.65;
        p.legL.rotation.x = sw;
        p.legR.rotation.x = -sw;
        p.armL.rotation.x = -sw * 0.8;
        p.armR.rotation.x = sw * 0.8;
        p.mesh.position.set(p.x, 0, p.z);
        p.mesh.rotation.set(0, p.yaw, 0);
      }
    }
  }
}
