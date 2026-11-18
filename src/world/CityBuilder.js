import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/**
 * CityBuilder — загрузка 3D-города (assets/models/city.glb),
 * автоматическая генерация коллизий зданий и карты,
 * улучшенные шейдеры освещения, отражений на окнах и ночной подсветки.
 */
export const CITY = {
  SIZE: 500,
  HALF: 250,
  SPACING: 80,
  ROAD_W: 14,
};

export class CityBuilder {
  constructor(scene, physics, textures) {
    this.scene = scene;
    this.physics = physics;
    this.tex = textures;
    this.buildings = [];
    this.cityGroup = null;

    this.shaderUniforms = {
      uSunDir: { value: new THREE.Vector3(0.55, 0.72, 0.42).normalize() },
      uSunColor: { value: new THREE.Color(0xfff5e0) },
      uSkyTop: { value: new THREE.Color(0x2d68b8) },
      uSkyHorizon: { value: new THREE.Color(0xc5def4) },
      uNightFactor: { value: 0.0 },
      uReflStrength: { value: 1.0 },
    };
  }

  setLightingUniforms(envPreset, reflStrength = 1.0) {
    const u = this.shaderUniforms;
    u.uSunDir.value.copy(envPreset.sunDir);
    u.uSunColor.value.copy(envPreset.sunColor);
    u.uSkyTop.value.copy(envPreset.zenith);
    u.uSkyHorizon.value.copy(envPreset.horizon);
    u.uNightFactor.value = envPreset.nightFactor;
    u.uReflStrength.value = reflStrength;
  }

  /**
   * Создаёт улучшенный материал для окон и стёкол с GLSL-шейдером отражений
   * (Френель + отражение неба/горизонта/солнца + ночное свечение комнат).
   */
  _upgradeWindowMaterial(origMat) {
    const u = this.shaderUniforms;
    const baseCol = origMat && origMat.color ? origMat.color.clone() : new THREE.Color(0x234466);
    const mat = new THREE.MeshPhysicalMaterial({
      color: baseCol,
      map: origMat ? origMat.map : null,
      roughness: 0.05,
      metalness: 0.2,
      clearcoat: 1.0,
      clearcoatRoughness: 0.04,
      reflectivity: 1.0,
      envMapIntensity: 2.3,
    });

    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uSunDir = u.uSunDir;
      shader.uniforms.uSunColor = u.uSunColor;
      shader.uniforms.uSkyTop = u.uSkyTop;
      shader.uniforms.uSkyHorizon = u.uSkyHorizon;
      shader.uniforms.uNightFactor = u.uNightFactor;
      shader.uniforms.uReflStrength = u.uReflStrength;

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          varying vec3 vWorldPosW;
          varying vec3 vWorldNormW;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vec4 wpW = modelMatrix * vec4(transformed, 1.0);
          vWorldPosW = wpW.xyz;
          vWorldNormW = normalize(mat3(modelMatrix) * objectNormal);`
        );

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          uniform vec3 uSunDir;
          uniform vec3 uSunColor;
          uniform vec3 uSkyTop;
          uniform vec3 uSkyHorizon;
          uniform float uNightFactor;
          uniform float uReflStrength;
          varying vec3 vWorldPosW;
          varying vec3 vWorldNormW;

          float winHash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }`
        )
        .replace(
          '#include <dithering_fragment>',
          `if (uReflStrength > 0.01) {
            vec3 N = normalize(vWorldNormW);
            vec3 V = normalize(cameraPosition - vWorldPosW);
            vec3 R = reflect(-V, N);

            float ndv = max(dot(N, V), 0.0);
            float fresnel = mix(0.22, 0.95, pow(1.0 - ndv, 2.8));

            float ry = clamp(R.y, -0.35, 1.0);
            vec3 skyRefl = mix(uSkyHorizon, uSkyTop, pow(max(ry, 0.0), 0.55));
            float cityLine = sin(R.x * 14.0) * 0.06 + cos(R.z * 11.0) * 0.06 + 0.08;
            float inCity = smoothstep(cityLine, cityLine - 0.06, R.y);
            vec3 cityCol = mix(uSkyHorizon * 0.35, vec3(0.10, 0.14, 0.22), 0.65);
            vec3 envRefl = mix(skyRefl, cityCol, inCity * 0.72);

            float sunRefl = pow(max(dot(R, normalize(uSunDir)), 0.0), 64.0);
            envRefl += uSunColor * sunRefl * 1.55;

            // Тёплый свет в окнах вечером и ночью
            vec2 cellId = floor(vWorldPosW.xz * 0.18 + vec2(0.0, floor(vWorldPosW.y * 0.25)));
            float rnd = winHash(cellId);
            vec3 warmLight = mix(vec3(1.0, 0.82, 0.50), vec3(0.65, 0.85, 1.0), step(0.7, rnd));
            float lit = step(0.42, rnd) * uNightFactor;

            gl_FragColor.rgb = mix(gl_FragColor.rgb, envRefl, fresnel * uReflStrength * 0.76);
            gl_FragColor.rgb += warmLight * lit * 0.65;
          }
          #include <dithering_fragment>`
        );
    };
    mat.customProgramCacheKey = () => 'city_glb_window_shader_v1';
    return mat;
  }

  _upgradeGenericMaterial(origMat, isRoad = false) {
    if (!origMat) return origMat;
    if (isRoad) {
      origMat.roughness = 0.48;
      origMat.metalness = 0.12;
      origMat.envMapIntensity = 0.85;
    } else {
      origMat.roughness = Math.max(0.55, origMat.roughness ?? 0.8);
      origMat.envMapIntensity = 0.7;
    }
    origMat.needsUpdate = true;
    return origMat;
  }

  build() {
    // Запасная плоскость земли и границы карты
    const groundGeo = new THREE.PlaneGeometry(2000, 2000);
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x2c3038, roughness: 0.9 });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.08;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.physics.addGround();
    this._borders();
  }

  async loadCity(onProgress = null) {
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        './assets/models/city.glb?v=9',
        resolve,
        (xhr) => {
          if (onProgress && xhr.total > 0) onProgress(xhr.loaded / xhr.total);
        },
        reject
      );
    });

    const root = gltf.scene;
    root.updateMatrixWorld(true);

    // Определяем уровень дороги (самый широкий плоский меш) и выравниваем его на Y = 0
    let bestArea = 0;
    let roadY = 0;
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();

    root.traverse((obj) => {
      if (obj.name && obj.name.toLowerCase().includes('human 2.8')) {
        obj.visible = false;
        return;
      }
      if (!obj.isMesh) return;
      box.setFromObject(obj);
      box.getSize(size);
      if (size.y < 1.2 && size.x * size.z < 100000 && size.x * size.z > bestArea) {
        bestArea = size.x * size.z;
        roadY = box.max.y;
      }
    });

    // Центрируем город по X/Z в (0,0) и выравниваем дорогу на Y = 0
    const rootBox = new THREE.Box3().setFromObject(root);
    rootBox.getCenter(center);
    root.position.set(-center.x, -roadY, -center.z);
    root.updateMatrixWorld(true);

    const winCache = new Map();
    const genCache = new Map();

    root.traverse((obj) => {
      if (!obj.isMesh || !obj.visible) return;
      obj.castShadow = true;
      obj.receiveShadow = true;

      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const upgraded = mats.map((m) => {
        if (!m) return m;
        const mName = (m.name || '').toLowerCase();
        const isWin = mName.includes('window') || mName.includes('glass') || mName.includes('fade_blue');
        if (isWin) {
          if (!winCache.has(m.uuid)) winCache.set(m.uuid, this._upgradeWindowMaterial(m));
          return winCache.get(m.uuid);
        }
        const isRoad = mName.includes('gray.001') || mName.includes('black_space') || mName.includes('road');
        if (!genCache.has(m.uuid)) genCache.set(m.uuid, this._upgradeGenericMaterial(m, isRoad));
        return genCache.get(m.uuid);
      });
      obj.material = Array.isArray(obj.material) ? upgraded : upgraded[0];

      // Коллизии для зданий и крупных объектов (игнорируем дороги/плоскости)
      box.setFromObject(obj);
      box.getSize(size);
      box.getCenter(center);
      if (size.y > 1.4 && size.x < 120 && size.z < 120 && center.y > 0.2) {
        // Чуть сужаем бокс по X/Z, чтобы не цепляться за карнизы
        const cw = Math.max(0.6, size.x * 0.92);
        const cd = Math.max(0.6, size.z * 0.92);
        this.physics.addStaticBox(center.x, center.y, center.z, cw, size.y, cd);
        if (size.x > 3 && size.z > 3) {
          this.buildings.push({
            x: center.x,
            z: center.z,
            w: size.x,
            d: size.z,
            h: size.y,
            style: size.y > 28 ? 'glass' : 'concrete',
          });
        }
      }
    });

    this.cityGroup = root;
    this.scene.add(root);
  }

  _borders() {
    const H = CITY.HALF, L = CITY.SIZE + 20;
    this.physics.addStaticBox(0, 10, -H - 1, L, 20, 2);
    this.physics.addStaticBox(0, 10, H + 1, L, 20, 2);
    this.physics.addStaticBox(-H - 1, 10, 0, 2, 20, L);
    this.physics.addStaticBox(H + 1, 10, 0, 2, 20, L);
  }

  /** Обновляет текстуру мини-карты по загруженным зданиям нового 3D-города. */
  createMinimapCanvas() {
    const S = 1000;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    this.minimapCanvas = c;
    this.refreshMinimapCanvas();
    return c;
  }

  refreshMinimapCanvas() {
    const c = this.minimapCanvas;
    if (!c) return;
    const S = c.width;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#252b36';
    ctx.fillRect(0, 0, S, S);

    // Сетка координат (1000px = 500м -> 2px на 1м)
    const scale = S / CITY.SIZE;
    const half = CITY.HALF;

    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= S; g += 50) {
      ctx.beginPath(); ctx.moveTo(g, 0); ctx.lineTo(g, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, g); ctx.lineTo(S, g); ctx.stroke();
    }

    const col = { glass: '#4c7199', concrete: '#757b85' };
    for (const b of this.buildings) {
      ctx.fillStyle = col[b.style] || '#6b7280';
      const rx = (b.x - b.w / 2 + half) * scale;
      const rz = (b.z - b.d / 2 + half) * scale;
      ctx.fillRect(rx, rz, b.w * scale, b.d * scale);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.lineWidth = 1;
      ctx.strokeRect(rx, rz, b.w * scale, b.d * scale);
    }
  }
}
