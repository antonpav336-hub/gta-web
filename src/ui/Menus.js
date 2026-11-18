import { CITY } from '../world/CityBuilder.js?v=7';
/**
 * Menus — улучшенное стартовое меню, меню паузы с вкладками (Карта / Настройки / Управление),
 * интерактивная карта города на Esc с GPS-меткой и настройками графики/отражений/времени суток.
 */
export class Menus {
  constructor({ engine, audio, input, city, hud, game }) {
    this.engine = engine;
    this.audio = audio;
    this.input = input;
    this.city = city;
    this.hud = hud;
    this.game = game;

    this.started = false;
    const $ = (id) => document.getElementById(id);

    this.ui = {
      volume: $('setVolume'), outVolume: $('outVolume'),
      sens: $('setSens'), outSens: $('outSens'),
      shadow: $('setShadow'),
      refl: $('setRefl'),
      time: $('setTime'),
      view: $('setView'), outView: $('outView'),
      pr: $('setPR'),
      title: $('menuTitle'),
      sub: $('menuSub'),
      resume: $('resume'),
      tabsRow: $('menuTabs'),
      fullMap: $('fullMap'),
      clearWp: $('clearWaypoint'),
      mapCoords: $('mapCoords'),
    };

    this.mapZoom = 1;
    this.activeTab = 'settings';

    const saved = this._load();
    if (saved) {
      for (const k in saved) if (this.ui[k]) this.ui[k].value = saved[k];
    }

    const apply = () => {
      const u = this.ui;
      this.audio.setVolume(u.volume.value / 100);
      u.outVolume.textContent = u.volume.value;
      this.input.sensitivity = u.sens.value * 0.0001;
      u.outSens.textContent = u.sens.value;
      this.engine.setShadowQuality(parseInt(u.shadow.value, 10));
      this.engine.setViewDistance(parseInt(u.view.value, 10));
      u.outView.textContent = u.view.value;
      this.engine.quality.pixelRatioMax = parseFloat(u.pr.value);
      this.engine.resize();

      const reflVal = parseFloat(u.refl.value);
      this.engine.setReflectionQuality(reflVal);
      const preset = this.engine.env.setTimeOfDay(u.time.value, this.engine);
      this.city.setLightingUniforms(preset, reflVal);

      this._save();
    };

    for (const k of ['volume', 'sens', 'shadow', 'refl', 'time', 'view', 'pr']) {
      this.ui[k].addEventListener('input', apply);
      this.ui[k].addEventListener('change', apply);
    }
    apply();

    this._setupTabs();
    this._setupFullMap();
    this.setStartMode(true);
  }

  setStartMode(isStart) {
    this.started = !isStart;
    if (isStart) {
      this.ui.title.textContent = 'LOS SANTOS WEB';
      this.ui.sub.textContent = 'Реалистичный город • Трафик • Полиция • Угон авто';
      this.ui.resume.textContent = 'НАЧАТЬ ИГРУ';
      this.switchTab('settings');
    } else {
      this.ui.title.textContent = 'ПАУЗА И КАРТА';
      this.ui.sub.textContent = 'Нажмите ESC или «Продолжить», чтобы вернуться в игру';
      this.ui.resume.textContent = 'ПРОДОЛЖИТЬ';
      this.switchTab('map');
      this.drawFullMap();
    }
  }

  _setupTabs() {
    const btns = document.querySelectorAll('.tab-btn');
    btns.forEach((b) => {
      b.addEventListener('click', () => this.switchTab(b.dataset.tab));
    });
  }

  switchTab(tab) {
    this.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.id === 'tab-' + tab);
    });
    if (tab === 'map') this.drawFullMap();
  }

  _setupFullMap() {
    const c = this.ui.fullMap;
    if (!c) return;
    c.addEventListener('click', (e) => {
      const rect = c.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      const wx = Math.round((nx - 0.5) * CITY.SIZE);
      const wz = Math.round((ny - 0.5) * CITY.SIZE);
      this.hud.waypoint = { x: wx, z: wz };
      this.drawFullMap();
    });
    if (this.ui.clearWp) {
      this.ui.clearWp.addEventListener('click', () => {
        this.hud.waypoint = null;
        this.drawFullMap();
      });
    }
  }

  drawFullMap() {
    const c = this.ui.fullMap;
    if (!c || !this.hud) return;
    const ctx = c.getContext('2d');
    const S = c.width;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.hud.mapCanvas, 0, 0, S, S);

    const toPx = (v) => ((v + CITY.HALF) / CITY.SIZE) * S;

    // Подписи районов
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.textAlign = 'center';
    ctx.fillText('ЦЕНТР', toPx(0), toPx(0) - 6);
    ctx.fillText('ПРОМЗОНА', toPx(330), toPx(-300));
    ctx.fillText('ЖИЛОЙ РАЙОН', toPx(-280), toPx(260));

    // Машины и полиция
    const cars = this.game.allVehicles ? this.game.allVehicles() : [];
    for (const v of cars) {
      if (v.destroyed) continue;
      const cx = toPx(v.body.position.x), cz = toPx(v.body.position.z);
      if (v.type === 'police') {
        ctx.fillStyle = v.sirenOn ? '#ff3844' : '#3b82f6';
        ctx.beginPath(); ctx.arc(cx, cz, 4, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(220,230,245,0.7)';
        ctx.fillRect(cx - 2, cz - 2, 4, 4);
      }
    }

    // GPS-метка
    if (this.hud.waypoint) {
      const wx = toPx(this.hud.waypoint.x), wz = toPx(this.hud.waypoint.z);
      ctx.fillStyle = '#f2c744';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(wx, wz, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    }

    // Игрок
    const p = this.game.player.position;
    const px = toPx(p.x), pz = toPx(p.z);
    ctx.fillStyle = '#59c35a';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(px, pz, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

    if (this.ui.mapCoords) {
      this.ui.mapCoords.textContent = `Игрок: X ${p.x.toFixed(0)}, Z ${p.z.toFixed(0)}` +
        (this.hud.waypoint ? `  •  Метка: ${this.hud.waypoint.x}, ${this.hud.waypoint.z}` : '  •  Кликните по карте для GPS-метки');
    }
  }

  _load() {
    try { return JSON.parse(localStorage.getItem('gtaweb.settings') || 'null'); } catch (e) { return null; }
  }

  _save() {
    const o = {};
    for (const k of ['volume', 'sens', 'shadow', 'refl', 'time', 'view', 'pr']) o[k] = this.ui[k].value;
    try { localStorage.setItem('gtaweb.settings', JSON.stringify(o)); } catch (e) { /* ignore */ }
  }
}
