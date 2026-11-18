import * as THREE from 'three';

/**
 * Environment — процедурное атмосферное небо (GLSL шейдер с облаками и солнцем)
 * + генерация PMREM-карты окружения для реалистичных PBR-отражений на окнах и авто.
 * Поддерживает режимы времени суток: 'day', 'sunset', 'night'.
 */

const PRESETS = {
  day: {
    zenith: new THREE.Color(0x2d68b8),
    horizon: new THREE.Color(0xc5def4),
    ground: new THREE.Color(0x5a626e),
    sunColor: new THREE.Color(0xfff5e0),
    sunDir: new THREE.Vector3(0.55, 0.72, 0.42).normalize(),
    sunIntensity: 2.8,
    hemiSky: 0xbfdcff,
    hemiGround: 0x55493f,
    hemiIntensity: 0.95,
    fogColor: new THREE.Color(0xc9ddf0),
    cloudColor: new THREE.Color(0xffffff),
    cloudOpacity: 0.55,
    stars: 0.0,
    nightFactor: 0.0,
    exposure: 1.05,
  },
  sunset: {
    zenith: new THREE.Color(0x1f2d5a),
    horizon: new THREE.Color(0xf28c5a),
    ground: new THREE.Color(0x3a2e38),
    sunColor: new THREE.Color(0xff9b54),
    sunDir: new THREE.Vector3(-0.75, 0.22, -0.62).normalize(),
    sunIntensity: 2.5,
    hemiSky: 0xffb385,
    hemiGround: 0x3b2d38,
    hemiIntensity: 0.75,
    fogColor: new THREE.Color(0xd88868),
    cloudColor: new THREE.Color(0xffbfa0),
    cloudOpacity: 0.65,
    stars: 0.15,
    nightFactor: 0.45,
    exposure: 1.0,
  },
  night: {
    zenith: new THREE.Color(0x050914),
    horizon: new THREE.Color(0x17243b),
    ground: new THREE.Color(0x0c1018),
    sunColor: new THREE.Color(0x9bb8ff),
    sunDir: new THREE.Vector3(0.4, 0.65, -0.5).normalize(),
    sunIntensity: 0.65,
    hemiSky: 0x354d75,
    hemiGround: 0x161820,
    hemiIntensity: 0.55,
    fogColor: new THREE.Color(0x121b2c),
    cloudColor: new THREE.Color(0x2d3f5e),
    cloudOpacity: 0.35,
    stars: 1.0,
    nightFactor: 1.0,
    exposure: 0.95,
  },
};

const SKY_VERT = /* glsl */`
  varying vec3 vWorldDir;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldDir = position;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const SKY_FRAG = /* glsl */`
  uniform vec3 uZenith;
  uniform vec3 uHorizon;
  uniform vec3 uGround;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uCloudColor;
  uniform float uCloudOpacity;
  uniform float uStars;
  uniform float uTime;

  varying vec3 vWorldDir;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 4; i++) {
      v += a * noise(p);
      p = p * 2.05 + vec2(13.1, 7.7);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec3 dir = normalize(vWorldDir);
    float h = dir.y;

    // Градиент неба и земли
    vec3 col;
    if (h >= 0.0) {
      float t = pow(clamp(h, 0.0, 1.0), 0.55);
      col = mix(uHorizon, uZenith, t);
    } else {
      float t = pow(clamp(-h, 0.0, 1.0), 0.45);
      col = mix(uHorizon, uGround, t);
    }

    // Солнце / луна и атмосферное свечение
    float sunDot = max(dot(dir, normalize(uSunDir)), 0.0);
    float sunGlow = pow(sunDot, 12.0) * 0.45 + pow(sunDot, 180.0) * 1.1;
    float sunDisc = smoothstep(0.9992, 0.9997, sunDot);
    col += uSunColor * (sunGlow + sunDisc * 3.0);

    // Облака в верхней полусфере
    if (h > 0.02) {
      vec2 uv = dir.xz / (h + 0.18) * 1.3 + vec2(uTime * 0.008, uTime * 0.004);
      float c = fbm(uv);
      float cloud = smoothstep(0.48, 0.78, c) * smoothstep(0.02, 0.18, h);
      col = mix(col, uCloudColor, cloud * uCloudOpacity);
    }

    // Звёзды ночью
    if (uStars > 0.01 && h > 0.05) {
      vec2 suv = floor(dir.xz / (h + 0.5) * 240.0);
      float s = hash(suv);
      if (s > 0.9965) {
        float twinkle = 0.65 + 0.35 * sin(uTime * 2.5 + s * 100.0);
        col += vec3(0.85, 0.92, 1.0) * uStars * twinkle * smoothstep(0.05, 0.3, h);
      }
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

export class Environment {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;
    this.mode = 'day';
    this.nightFactor = 0;

    this.uniforms = {
      uZenith: { value: PRESETS.day.zenith.clone() },
      uHorizon: { value: PRESETS.day.horizon.clone() },
      uGround: { value: PRESETS.day.ground.clone() },
      uSunDir: { value: PRESETS.day.sunDir.clone() },
      uSunColor: { value: PRESETS.day.sunColor.clone() },
      uCloudColor: { value: PRESETS.day.cloudColor.clone() },
      uCloudOpacity: { value: PRESETS.day.cloudOpacity },
      uStars: { value: 0 },
      uTime: { value: 0 },
    };

    const skyGeo = new THREE.SphereGeometry(1400, 32, 20);
    const skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.skyMesh = new THREE.Mesh(skyGeo, skyMat);
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this._envScene = new THREE.Scene();
    this._envSky = new THREE.Mesh(
      new THREE.SphereGeometry(50, 24, 16),
      skyMat.clone()
    );
    this._envSky.material.uniforms = this.uniforms;
    this._envScene.add(this._envSky);

    // Силуэт небоскрёбов в envMap, чтобы в стёклах отражался не только небосвод, но и город!
    const silMat = new THREE.MeshBasicMaterial({ color: 0x1c2533, side: THREE.BackSide });
    const silGeo = new THREE.CylinderGeometry(42, 42, 16, 36, 1, true);
    const silMesh = new THREE.Mesh(silGeo, silMat);
    silMesh.position.y = -4;
    this._envScene.add(silMesh);
    this._silMat = silMat;

    this.envRT = null;
    this.setTimeOfDay('day');
  }

  setTimeOfDay(mode, engine = null) {
    const p = PRESETS[mode] || PRESETS.day;
    this.mode = mode;
    this.nightFactor = p.nightFactor;

    this.uniforms.uZenith.value.copy(p.zenith);
    this.uniforms.uHorizon.value.copy(p.horizon);
    this.uniforms.uGround.value.copy(p.ground);
    this.uniforms.uSunDir.value.copy(p.sunDir);
    this.uniforms.uSunColor.value.copy(p.sunColor);
    this.uniforms.uCloudColor.value.copy(p.cloudColor);
    this.uniforms.uCloudOpacity.value = p.cloudOpacity;
    this.uniforms.uStars.value = p.stars;

    this._silMat.color.copy(p.ground).lerp(p.horizon, 0.25);

    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(this._envScene, 0.02);
    this.scene.environment = this.envRT.texture;

    if (engine) {
      engine.sunDir.copy(p.sunDir);
      engine.sun.color.copy(p.sunColor);
      engine.sun.intensity = p.sunIntensity;
      engine.hemi.color.setHex(p.hemiSky);
      engine.hemi.groundColor.setHex(p.hemiGround);
      engine.hemi.intensity = p.hemiIntensity;
      engine.fogColor.copy(p.fogColor);
      engine.scene.fog.color.copy(p.fogColor);
      engine.renderer.toneMappingExposure = p.exposure;
    }
    return p;
  }

  /** Плавный переход между режимами без перестройки PMREM (для смены суток). */
  blend(a, b, t, engine = null) {
    const A = PRESETS[a] || PRESETS.day, B = PRESETS[b] || PRESETS.day;
    const L = (x, y) => x + (y - x) * t;
    const C = (x, y) => x.clone().lerp(y, t);
    const H = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
    const p = {
      zenith: C(A.zenith, B.zenith), horizon: C(A.horizon, B.horizon), ground: C(A.ground, B.ground),
      sunColor: C(A.sunColor, B.sunColor), sunDir: A.sunDir.clone().lerp(B.sunDir, t).normalize(),
      sunIntensity: L(A.sunIntensity, B.sunIntensity),
      hemiSky: H(A.hemiSky, B.hemiSky), hemiGround: H(A.hemiGround, B.hemiGround), hemiIntensity: L(A.hemiIntensity, B.hemiIntensity),
      fogColor: C(A.fogColor, B.fogColor), cloudColor: C(A.cloudColor, B.cloudColor), cloudOpacity: L(A.cloudOpacity, B.cloudOpacity),
      stars: L(A.stars, B.stars), nightFactor: L(A.nightFactor, B.nightFactor), exposure: L(A.exposure, B.exposure),
    };
    this.nightFactor = p.nightFactor;
    const u = this.uniforms;
    u.uZenith.value.copy(p.zenith); u.uHorizon.value.copy(p.horizon); u.uGround.value.copy(p.ground);
    u.uSunDir.value.copy(p.sunDir); u.uSunColor.value.copy(p.sunColor);
    u.uCloudColor.value.copy(p.cloudColor); u.uCloudOpacity.value = p.cloudOpacity; u.uStars.value = p.stars;
    this._silMat.color.copy(p.ground).lerp(p.horizon, 0.25);
    if (engine) {
      engine.sunDir.copy(p.sunDir);
      engine.sun.color.copy(p.sunColor);
      engine.sun.intensity = p.sunIntensity;
      engine.hemi.color.copy(p.hemiSky);
      engine.hemi.groundColor.copy(p.hemiGround);
      engine.hemi.intensity = p.hemiIntensity;
      engine.fogColor.copy(p.fogColor);
      engine.scene.fog.color.copy(p.fogColor);
      engine.renderer.toneMappingExposure = p.exposure;
    }
    return p;
  }

  update(dt, camPos) {
    this.uniforms.uTime.value += dt;
    if (camPos) this.skyMesh.position.copy(camPos);
  }
}
