import * as THREE from 'three';

const LS = 'lsw_fx_v1';
// Уровни качества для автонастройки (0 = максимум)
const LEVELS = [
  { pr: 2, shadow: 2048, view: 700, bloom: true, rain: 1.0 },
  { pr: 1.5, shadow: 1024, view: 600, bloom: true, rain: 0.8 },
  { pr: 1.25, shadow: 1024, view: 500, bloom: false, rain: 0.6 },
  { pr: 1, shadow: 0, view: 400, bloom: false, rain: 0.4 },
];
// Смена суток: [от, до, длительность], null = пауза на режиме
const CYCLE = [['day', 'day', 150], ['day', 'sunset', 40], ['sunset', 'sunset', 30], ['sunset', 'night', 40],
  ['night', 'night', 100], ['night', 'sunset', 40], ['sunset', 'day', 40]];

const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _p = new THREE.Vector3();

function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/** Effects — автокачество, погода, смена суток, следы шин и дым, фары, bloom, покачивание деревьев. */
export class Effects {
  constructor({ engine, menus, city, audio, input, allVehicles }) {
    Object.assign(this, { engine, menus, city, audio, input, allVehicles });
    this.s = { weather: 'auto', auto: true, bloom: !input.touch };
    try { Object.assign(this.s, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { /* ignore */ }

    this.baseLevel = input.touch ? 2 : 0;
    this.level = this.baseLevel; this.lvT = 0; this.fr = 0; this.okRuns = 0; this.age = 0;
    this.rain = 0; this.fog = 0; this.target = 'clear'; this.autoT = 90 + Math.random() * 90;
    this.cycleI = 0; this.cycleT = 0; this.blendT = 0; this.timeSeen = null;
    this.windU = { value: 0 };
    this.beams = new WeakMap();
    this.rainFactor = 1; this.bloomAllowed = true;

    this._buildUI();
    this._buildRain();
    this._buildSkid();
    this._applyLevel(this.level);
    this._initBloom();

    this.tint = document.createElement('div');
    this.tint.style.cssText = 'position:fixed;inset:0;pointer-events:none;background:#28324a;opacity:0;';
    engine.canvas.insertAdjacentElement('afterend', this.tint);
  }

  _save() { try { localStorage.setItem(LS, JSON.stringify(this.s)); } catch (e) { /* ignore */ } }

  // ---------- Меню ----------
  _buildUI() {
    const panel = document.getElementById('tab-settings'); if (!panel) return;
    const timeSel = document.getElementById('setTime');
    if (timeSel && !timeSel.querySelector('option[value="auto"]')) timeSel.appendChild(new Option('Авто (смена суток)', 'auto'));
    const add = (label, opts, value, fn) => {
      const row = document.createElement('div'); row.className = 'row';
      const l = document.createElement('label'); l.textContent = label;
      const sel = document.createElement('select');
      opts.forEach(([v, t]) => sel.appendChild(new Option(t, v)));
      sel.value = value; sel.addEventListener('change', () => { fn(sel.value); this._save(); });
      row.append(l, sel); panel.appendChild(row);
    };
    add('Погода', [['auto', 'Авто'], ['clear', 'Ясно'], ['rain', 'Дождь'], ['fog', 'Туман']], this.s.weather, (v) => { this.s.weather = v; });
    add('Авто-качество (FPS)', [['1', 'Вкл'], ['0', 'Выкл']], this.s.auto ? '1' : '0', (v) => { this.s.auto = v === '1'; });
    add('Свечение (bloom)', [['1', 'Вкл'], ['0', 'Выкл']], this.s.bloom ? '1' : '0', (v) => { this.s.bloom = v === '1'; this._applyBloom(); });
  }

  // ---------- Автокачество ----------
  _applyLevel(i) {
    const L = LEVELS[i], e = this.engine;
    this.level = i;
    e.quality.pixelRatioMax = L.pr; e.resize();
    e.setShadowQuality(L.shadow);
    e.setViewDistance(L.view);
    this.bloomAllowed = L.bloom; this.rainFactor = L.rain;
    this._applyBloom();
    if (this.rainLines) this.rainLines.geometry.setDrawRange(0, Math.floor(this.rainN * L.rain) * 2);
  }

  _autoQuality(dt) {
    this.age += dt;
    if (!this.s.auto || this.age < 5) return;
    this.lvT += dt; this.fr++;
    if (this.lvT < 2) return;
    const fps = this.fr / this.lvT; this.lvT = 0; this.fr = 0;
    if (fps < 26 && this.level < LEVELS.length - 1) { this.okRuns = 0; this._applyLevel(this.level + 1); }
    else if (fps > 57) {
      if (++this.okRuns >= 4 && this.level > (this.input.touch ? 1 : 0)) { this.okRuns = 0; this._applyLevel(this.level - 1); }
    } else this.okRuns = 0;
  }

  // ---------- Bloom ----------
  async _initBloom() {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
        import('three/examples/jsm/postprocessing/OutputPass.js'),
      ]);
      const e = this.engine, r = e.renderer, size = r.getSize(new THREE.Vector2());
      const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
      const c = new EffectComposer(r, rt);
      c.setPixelRatio(r.getPixelRatio()); c.setSize(size.x, size.y);
      c.addPass(new RenderPass(e.scene, e.camera));
      c.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.6, 0.92));
      c.addPass(new OutputPass());
      e.composer = c;
      this._applyBloom();
    } catch (err) { console.warn('Bloom недоступен:', err); }
  }
  _applyBloom() { this.engine.bloomOn = !!(this.s.bloom && this.bloomAllowed && this.engine.composer); }

  // ---------- Погода ----------
  _buildRain() {
    const N = this.rainN = 1400;
    this.drops = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this._resetDrop(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.rainLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xb7c9e6, transparent: true, opacity: 0, depthWrite: false }));
    this.rainLines.frustumCulled = false; this.rainLines.visible = false;
    this.engine.scene.add(this.rainLines);
  }
  _resetDrop(i, any) {
    const d = this.drops;
    d[i * 3] = (Math.random() - 0.5) * 60; d[i * 3 + 1] = any ? -8 + Math.random() * 30 : 22; d[i * 3 + 2] = (Math.random() - 0.5) * 60;
  }

  _updateWeather(dt) {
    if (this.s.weather === 'auto') {
      this.autoT -= dt;
      if (this.autoT <= 0) {
        this.autoT = 120 + Math.random() * 180;
        const r = Math.random();
        this.target = this.target === 'clear' ? (r < 0.55 ? 'rain' : r < 0.75 ? 'fog' : 'clear') : 'clear';
      }
    } else this.target = this.s.weather;
    const k = 1 - Math.exp(-dt / 4);
    this.rain += ((this.target === 'rain' ? 1 : 0) - this.rain) * k;
    this.fog += ((this.target === 'fog' ? 1 : 0) - this.fog) * k;

    const e = this.engine, vd = e.quality.viewDistance;
    const f = 1 - 0.5 * this.rain - 0.78 * this.fog;
    e.scene.fog.far = vd * f;
    e.scene.fog.near = vd * (this.fog > 0.02 ? 0.08 : 0.4) * f;
    const gray = this.fog > this.rain ? 0xb8bec4 : 0x7d8691;
    e.scene.fog.color.copy(e.fogColor).lerp(new THREE.Color(gray), Math.max(this.rain * 0.75, this.fog * 0.8));
    this.tint.style.opacity = String(this.rain * 0.3 + this.fog * 0.08);
    this.audio.setRain(this.rain);

    // капли
    const rl = this.rainLines; rl.visible = this.rain > 0.03;
    if (rl.visible) {
      rl.material.opacity = 0.4 * this.rain;
      const cp = e.camera.position, pos = rl.geometry.attributes.position.array, d = this.drops, wind = 3;
      for (let i = 0; i < this.rainN; i++) {
        d[i * 3 + 1] -= 28 * dt; d[i * 3] += wind * dt;
        if (d[i * 3 + 1] < -8) this._resetDrop(i, false);
        const x = cp.x + d[i * 3], y = cp.y + d[i * 3 + 1], z = cp.z + d[i * 3 + 2];
        pos[i * 6] = x; pos[i * 6 + 1] = y; pos[i * 6 + 2] = z;
        pos[i * 6 + 3] = x - wind * 0.03; pos[i * 6 + 4] = y + 0.9; pos[i * 6 + 5] = z;
      }
      rl.geometry.attributes.position.needsUpdate = true;
    }
    // мокрый асфальт
    if (this._wet) for (const w of this._wet) w.m.roughness = w.r0 * (1 - 0.75 * this.rain);
  }

  _collectCityMaterials() {
    const root = this.city.cityGroup; if (!root || this._collected) return;
    this._collected = true; this._wet = [];
    const seen = new Set();
    root.traverse((o) => {
      if (!o.isMesh) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) {
        if (!m || seen.has(m)) continue; seen.add(m);
        const n = (m.name || '').toLowerCase();
        if (m.roughness !== undefined && /gray\.001|black_space|road/.test(n)) this._wet.push({ m, r0: m.roughness });
        if (/veget/.test(n) && !m.userData.sway) this._sway(m);
      }
    });
  }

  _sway(m) {
    m.userData.sway = true;
    const prev = m.onBeforeCompile, U = this.windU;
    m.onBeforeCompile = (shader, renderer) => {
      if (prev) prev(shader, renderer);
      shader.uniforms.uWind = U;
      shader.vertexShader = 'uniform float uWind;\n' + shader.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 wp_ = modelMatrix * vec4(transformed, 1.0);
         float sc_ = max(length(modelMatrix[0].xyz), 0.0001);
         float h_ = clamp(wp_.y - 2.0, 0.0, 12.0);
         float s_ = sin(uWind * 1.7 + wp_.x * 0.35 + wp_.z * 0.3) * 0.035 * h_;
         transformed.x += s_ / sc_; transformed.z += s_ * 0.6 / sc_;`);
    };
    m.customProgramCacheKey = () => 'sway';
    m.needsUpdate = true;
  }

  // ---------- Смена суток ----------
  _updateTime(dt) {
    const ui = this.menus.ui && this.menus.ui.time; if (!ui) return;
    if (ui.value !== 'auto') { this.timeSeen = ui.value; return; }
    if (this.timeSeen !== 'auto') { this.timeSeen = 'auto'; this.cycleI = 0; this.cycleT = 0; this.blendT = 0; }
    const [a, b, dur] = CYCLE[this.cycleI], e = this.engine;
    this.cycleT += dt;
    const refl = this.menus.ui.refl ? parseFloat(this.menus.ui.refl.value) : 1;
    if (a !== b) {
      this.blendT -= dt;
      if (this.blendT <= 0) {
        this.blendT = 0.25;
        const p = e.env.blend(a, b, Math.min(1, this.cycleT / dur), e);
        this.city.setLightingUniforms(p, isNaN(refl) ? 1 : refl);
      }
    }
    if (this.cycleT >= dur) {
      const p = e.env.setTimeOfDay(b, e);   // полная перестройка отражений только в конце перехода
      this.city.setLightingUniforms(p, isNaN(refl) ? 1 : refl);
      this.cycleT = 0; this.cycleI = (this.cycleI + 1) % CYCLE.length;
    }
  }

  // ---------- Следы, дым, фары ----------
  _buildSkid() {
    const markMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const geo = new THREE.PlaneGeometry(0.28, 0.8);
    this.marks = []; this.markI = 0;
    for (let i = 0; i < 140; i++) {
      const m = new THREE.Mesh(geo, markMat); m.rotation.order = 'YXZ'; m.rotation.x = -Math.PI / 2; m.visible = false; m.userData.life = 0;
      this.engine.scene.add(m); this.marks.push(m);
    }
    const tex = puffTexture();
    this.puffs = []; this.puffI = 0;
    for (let i = 0; i < 45; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: 0xcfcfcf, transparent: true, opacity: 0, depthWrite: false }));
      s.visible = false; s.userData = { life: 0, vx: 0, vz: 0 };
      this.engine.scene.add(s); this.puffs.push(s);
    }
    this.beamGeo = new THREE.ConeGeometry(1.7, 9, 14, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 4.5 + 2.1);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xfff2c0, transparent: true, opacity: 0.11, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }

  _mark(x, z, yaw) {
    const m = this.marks[this.markI = (this.markI + 1) % this.marks.length];
    m.position.set(x, 0.04, z); m.rotation.y = yaw; m.scale.set(1, 1, 1); m.visible = true; m.userData.life = 14;
  }
  _puff(x, y, z) {
    const s = this.puffs[this.puffI = (this.puffI + 1) % this.puffs.length];
    s.position.set(x, 0.3, z); s.visible = true;
    s.userData.life = 1.3; s.userData.vx = (Math.random() - 0.5) * 0.8; s.userData.vz = (Math.random() - 0.5) * 0.8;
  }

  _vehicleFx(dt) {
    const cam = this.engine.camera.position, env = this.engine.env;
    const night = env.nightFactor > 0.3 || this.rain > 0.5;
    for (const v of this.allVehicles()) {
      if (!v || !v.mesh || !v.body) continue;
      const bp = v.body.position, d2 = (bp.x - cam.x) ** 2 + (bp.z - cam.z) ** 2;
      let b = this.beams.get(v);
      if (!b && d2 < 150 * 150 && !v.destroyed) { b = new THREE.Mesh(this.beamGeo, this.beamMat); b.position.y = 0.75; v.mesh.add(b); this.beams.set(v, b); }
      if (b) b.visible = night && !v.destroyed && !!v.occupant && d2 < 150 * 150;
      if (d2 > 80 * 80 || v.destroyed) continue;

      const vel = v.body.velocity, q = v.mesh.quaternion;
      _f.set(0, 0, 1).applyQuaternion(q); _r.set(1, 0, 0).applyQuaternion(q);
      const lat = vel.x * _r.x + vel.z * _r.z, sp = Math.hypot(vel.x, vel.z);
      const slip = (Math.abs(lat) > 3 && sp > 5) || (v.braking && sp > 13);
      if (!slip || bp.y > 1.3) continue;
      v._fxT = (v._fxT || 0) - dt; if (v._fxT > 0) continue;
      v._fxT = 0.045;
      const yaw = Math.atan2(_f.x, _f.z);
      for (const w of v.wheels || []) {
        w.getWorldPosition(_p);
        if ((_p.x - bp.x) * _f.x + (_p.z - bp.z) * _f.z > 0) continue;   // только задние колёса
        this._mark(_p.x, _p.z, yaw); this._puff(_p.x, _p.y, _p.z);
      }
    }
    for (const m of this.marks) {
      if (!m.visible) continue;
      m.userData.life -= dt;
      if (m.userData.life <= 0) m.visible = false; else if (m.userData.life < 2) m.scale.x = m.userData.life / 2;
    }
    for (const s of this.puffs) {
      if (!s.visible) continue;
      const u = s.userData; u.life -= dt;
      if (u.life <= 0) { s.visible = false; continue; }
      s.position.x += u.vx * dt; s.position.y += 0.9 * dt; s.position.z += u.vz * dt;
      s.scale.setScalar(0.7 + (1.3 - u.life) * 1.6);
      s.material.opacity = 0.4 * u.life / 1.3;
    }
  }

  update(dt) {
    try {
      this.windU.value += dt;
      this._collectCityMaterials();
      this._autoQuality(dt);
      this._updateTime(dt);
      this._updateWeather(dt);
      this._vehicleFx(dt);
    } catch (e) { if (!this._warned) { this._warned = true; console.warn('Effects:', e); } }
  }
}
