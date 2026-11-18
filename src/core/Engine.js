import * as THREE from 'three';
import { Environment } from './Environment.js?v=10';

/**
 * Engine — рендерер, сцена, туман, свет, окружение (шейдер неба + PMREM отражения)
 * и камера через плечо / за машиной (Spring Arm).
 */
export class Engine {
  constructor(canvas, skyTexture) {
    this.canvas = canvas;

    this.quality = {
      pixelRatioMax: 2,
      shadowMapSize: 2048,
      shadowRadius: 90,
      viewDistance: 700,
      reflections: 1.0,
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioMax));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.fogColor = new THREE.Color(0xc9ddf0);
    this.scene.background = skyTexture || this.fogColor;
    this.scene.fog = new THREE.Fog(this.fogColor, this.quality.viewDistance * 0.4, this.quality.viewDistance);

    this.camera = new THREE.PerspectiveCamera(
      65, window.innerWidth / window.innerHeight, 0.1, this.quality.viewDistance + 120
    );
    this.baseFov = 65;
    this.camera.position.set(0, 4, 8);

    // Spring Arm: пешком / прицел / за рулём
    this.arm = {
      distance: 4.6, shoulder: 0.65,
      aimDistance: 2.3, aimShoulder: 0.85,
      vehDistance: 7.4, vehHeight: 2.35, vehLookHeight: 1.25,
      height: 1.55, lookHeight: 1.5,
      follow: 14, fovLerp: 6,
      aimFovDelta: 22,
      trauma: 0,
    };
    this.aimK = 0;
    this._aimTarget = 0;
    this.vehicleMode = false;

    this.cameraCollide = null;
    this._desired = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();

    this._setupLights();
    this.env = new Environment(this.renderer, this.scene);
    this.env.setTimeOfDay('day', this);

    window.addEventListener('resize', () => this.resize());
  }

  _setupLights() {
    this.hemi = new THREE.HemisphereLight(0xbfdcff, 0x55493f, 0.95);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.8);
    this.sunDir = new THREE.Vector3(0.55, 0.72, 0.42).normalize();
    this.sun.castShadow = true;
    this._configShadow();
    this.scene.add(this.sun, this.sun.target);
  }

  _configShadow() {
    const r = this.quality.shadowRadius;
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r;
    cam.near = 1; cam.far = 400;
    cam.updateProjectionMatrix();
    this.sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.05;
  }

  setTimeOfDay(mode) {
    this.env.setTimeOfDay(mode, this);
  }

  setReflectionQuality(level) {
    // 0 = выкл, 0.5 = средние, 1.0 = высокие
    this.quality.reflections = level;
    this.scene.environmentIntensity = level;
  }

  setShadowQuality(size) {
    if (size === 0) { this.sun.castShadow = false; return; }
    this.sun.castShadow = true;
    this.quality.shadowMapSize = size;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this._configShadow();
  }

  setViewDistance(d) {
    this.quality.viewDistance = d;
    this.scene.fog.near = d * 0.4;
    this.scene.fog.far = d;
    this.camera.far = d + 120;
    this.camera.updateProjectionMatrix();
  }

  followShadow(t) {
    const texel = (this.quality.shadowRadius * 2) / this.quality.shadowMapSize;
    const x = Math.round(t.x / texel) * texel;
    const y = Math.round(t.y / texel) * texel;
    const z = Math.round(t.z / texel) * texel;
    this.sun.target.position.set(x, y, z);
    this.sun.position.set(x + this.sunDir.x * 150, y + this.sunDir.y * 150, z + this.sunDir.z * 150);
  }

  setAim(on) { this._aimTarget = on ? 1 : 0; }
  setVehicleMode(on) { this.vehicleMode = on; if (on) this._aimTarget = 0; }

  updateCamera(target, yaw, pitch, dt, fovBoost = 0) {
    const a = this.arm;
    this.aimK += (this._aimTarget - this.aimK) * (1 - Math.exp(-10 * dt));
    const k = this.aimK;

    const dist = this.vehicleMode ? a.vehDistance : (a.distance + (a.aimDistance - a.distance) * k);
    const sh = this.vehicleMode ? 0 : (a.shoulder + (a.aimShoulder - a.shoulder) * k);
    const h = this.vehicleMode ? a.vehHeight : a.height;
    const lh = this.vehicleMode ? a.vehLookHeight : a.lookHeight;

    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    const rx = cy, rz = -sy;

    const hx = target.x + rx * sh, hy = target.y + h, hz = target.z + rz * sh;
    let dx = sy * cp * dist, dy = sp * dist, dz = cy * cp * dist;

    if (this.cameraCollide) {
      const hit = this.cameraCollide(hx, hy, hz, hx + dx, hy + dy, hz + dz);
      if (hit >= 0) {
        const len = Math.hypot(dx, dy, dz);
        const f = Math.max(0.15, (hit - 0.4) / len);
        dx *= f; dy *= f; dz *= f;
      }
    }
    this._desired.set(hx + dx, Math.max(0.4, hy + dy), hz + dz);

    const followRate = this.vehicleMode ? 10 : a.follow;
    const lerpK = 1 - Math.exp(-followRate * dt);
    this.camera.position.lerp(this._desired, lerpK);

    if (a.trauma > 0) {
      const s = a.trauma * a.trauma * 0.22;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.position.z += (Math.random() - 0.5) * s;
      a.trauma = Math.max(0, a.trauma - dt * 1.8);
    }

    this._lookAt.set(target.x + rx * sh, target.y + lh, target.z + rz * sh);
    this.camera.lookAt(this._lookAt);

    const targetFov = this.baseFov + fovBoost - a.aimFovDelta * k;
    if (Math.abs(this.camera.fov - targetFov) > 0.01) {
      this.camera.fov += (targetFov - this.camera.fov) * (1 - Math.exp(-a.fovLerp * dt));
      this.camera.updateProjectionMatrix();
    }

    this.env.update(dt, this.camera.position);
  }

  /** Кинематографическая орбитальная камера для стартового меню. */
  updateCinematicCamera(t, dt) {
    const r = 135;
    const ang = t * 0.12;
    const cx = Math.cos(ang) * r;
    const cz = Math.sin(ang) * r;
    const cy = 38 + Math.sin(t * 0.25) * 10;
    this.camera.position.set(cx, cy, cz);
    this._lookAt.set(Math.cos(ang + 0.6) * 35, 16, Math.sin(ang + 0.6) * 35);
    this.camera.lookAt(this._lookAt);
    this.followShadow(this._lookAt);
    this.env.update(dt, this.camera.position);
  }

  addShake(amount) { this.arm.trauma = Math.min(1, this.arm.trauma + amount); }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioMax));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render() { this.renderer.render(this.scene, this.camera); }
}
