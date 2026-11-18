import { CITY } from '../world/CityBuilder.js?v=10';
import { WEAPONS } from '../systems/WeaponSystem.js?v=10';

/**
 * HUD — здоровье, броня, деньги, звёзды розыска, точечный прицел, хэдшот-маркер,
 * колесо выбора оружия на Tab (как в GTA V), подсказка угона [E], спидометр и мини-карта.
 */

const WHEEL_SLOTS = [
  { weaponIdx: -1, label: 'Безоружен', short: 'Кулаки' },
  { weaponIdx: 0,  label: 'Пистолет', short: 'Пистолет' },
  { weaponIdx: 1,  label: 'Пистолет-пулемёт', short: 'ПП' },
  { weaponIdx: 2,  label: 'Дробовик', short: 'Дробовик' },
  { weaponIdx: 3,  label: 'Штурмовая винтовка', short: 'Винтовка' },
];

export class HUD {
  constructor(game, mapCanvas) {
    this.game = game;
    this.mapCanvas = mapCanvas;
    const $ = (id) => document.getElementById(id);

    this.el = {
      money: $('money'), stars: $('stars'),
      hp: $('hpFill'), ar: $('arFill'),
      wName: $('weaponName'), ammo: $('ammo'), reloadMsg: $('reloadMsg'),
      hotbar: $('hotbar'), crosshair: $('crosshair'), hit: $('hitmarker'),
      hsBadge: $('headshotBadge'),
      damage: $('damage'), debug: $('debug'),
      prompt: $('interactPrompt'),
      speedBox: $('speedBox'), speedVal: $('speedVal'), carName: $('carName'),
      wasted: $('wasted'),
      wheel: $('weaponWheel'),
      wheelCenter: $('wheelCenter'),
      wheelSectors: Array.from(document.querySelectorAll('.wheel-sector')),
      slowmo: $('slowmoVignette'),
    };
    this.mini = $('minimap');
    this.mctx = this.mini.getContext('2d');
    this.debugOn = true;
    this._lastHP = game.player.health;
    this._hitShown = false;
    this._hsShown = false;
    this._mapAcc = 0;
    this.waypoint = null;

    // Состояние колеса оружия (Tab)
    this.wheelOpen = false;
    this._wheelX = 0;
    this._wheelY = 0;
    this._wheelSelected = 0; // индекс в WHEEL_SLOTS

    this.slots = WEAPONS.map((w, i) => {
      const s = document.createElement('div');
      s.className = 'slot';
      s.innerHTML = `<b>${i + 1}</b>${w.name}`;
      this.el.hotbar.appendChild(s);
      return s;
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'F3') {
        this.debugOn = !this.debugOn;
        this.el.debug.style.display = this.debugOn ? 'block' : 'none';
        e.preventDefault();
      }
    });

    this._tick();
    setInterval(() => this._tick(), 180);
  }

  /** Обновление колеса выбора оружия на Tab. Возвращает true, если колесо открыто. */
  updateWeaponWheel(input, paused) {
    const wantOpen = !paused && !this.game.player.inVehicle && !this.game.player.dead && input.keys.has('Tab');

    if (wantOpen && !this.wheelOpen) {
      this.wheelOpen = true;
      this._wheelX = 0;
      this._wheelY = 0;
      const cur = this.game.weapons.current;
      this._wheelSelected = Math.max(0, WHEEL_SLOTS.findIndex((s) => s.weaponIdx === cur));
      this.el.wheel.classList.remove('hidden');
      this.el.slowmo.classList.add('active');
    } else if (!wantOpen && this.wheelOpen) {
      this.wheelOpen = false;
      this.el.wheel.classList.add('hidden');
      this.el.slowmo.classList.remove('active');
      const chosen = WHEEL_SLOTS[this._wheelSelected];
      if (chosen) this.game.weapons.select(chosen.weaponIdx);
    }

    if (this.wheelOpen) {
      // Используем движение мыши для выбора сектора
      this._wheelX = Math.max(-120, Math.min(120, this._wheelX + input.mouseDX * 0.65));
      this._wheelY = Math.max(-120, Math.min(120, this._wheelY + input.mouseDY * 0.65));
      input.mouseDX = 0;
      input.mouseDY = 0;

      const dist = Math.hypot(this._wheelX, this._wheelY);
      if (dist > 18) {
        // Угол 0 = вверх (-Y), по часовой стрелке
        let deg = Math.atan2(this._wheelX, -this._wheelY) * (180 / Math.PI);
        if (deg < 0) deg += 360;
        this._wheelSelected = Math.floor(((deg + 36) % 360) / 72);
      }

      this.el.wheelSectors.forEach((el, idx) => {
        el.classList.toggle('active', idx === this._wheelSelected);
      });
      const slot = WHEEL_SLOTS[this._wheelSelected];
      const wIdx = slot.weaponIdx;
      const ammoStr = wIdx >= 0
        ? `${this.game.weapons.ammo[wIdx].mag} / ${this.game.weapons.ammo[wIdx].reserve}`
        : 'Без оружия';
      this.el.wheelCenter.innerHTML = `<b>${slot.label}</b><span>${ammoStr}</span>`;
    }

    return this.wheelOpen;
  }

  _tick() {
    const { player, weapons } = this.game;
    const e = this.el;

    e.money.textContent = '$' + player.money.toLocaleString('en-US');
    e.hp.style.width = Math.max(0, player.health) + '%';
    e.ar.style.width = Math.max(0, player.armor) + '%';

    const wanted = this.game.wanted ? this.game.wanted() : 0;
    let s = '';
    for (let i = 0; i < 5; i++) s += i < wanted ? '<span class="on">★</span>' : '★';
    if (e.stars._s !== s) { e.stars.innerHTML = s; e.stars._s = s; }
    e.stars.classList.toggle('flashing', wanted > 0);

    if (player.inVehicle) {
      e.wName.textContent = player.inVehicle.spec.name;
      e.ammo.textContent = player.inVehicle.type === 'police' ? '[G] Сирена' : '[H] Гудок';
      e.reloadMsg.textContent = '[E] Выйти';
      e.hotbar.style.opacity = '0.25';
    } else {
      e.hotbar.style.opacity = '1';
      const d = weapons.def;
      e.wName.textContent = d ? d.name : 'Безоружен';
      if (d) {
        e.ammo.innerHTML = `${weapons.mag} <small>/ ${weapons.reserve}</small>`;
        e.ammo.classList.toggle('low', weapons.mag <= Math.ceil(d.mag * 0.25));
      } else {
        e.ammo.textContent = '';
      }
      e.reloadMsg.textContent = weapons.reloading > 0 ? 'ПЕРЕЗАРЯДКА…' : '';
    }
    this.slots.forEach((el, i) => el.classList.toggle('sel', !player.inVehicle && i === weapons.current));

    if (player.inVehicle) {
      e.speedBox.classList.remove('hidden');
      e.speedVal.textContent = Math.round(player.inVehicle.speed * 3.6);
      e.carName.textContent = player.inVehicle.spec.name;
    } else {
      e.speedBox.classList.add('hidden');
    }

    if (!player.inVehicle && !player.dead && this.game.nearestCar) {
      const car = this.game.nearestCar();
      if (car) {
        e.prompt.classList.remove('hidden');
        e.prompt.innerHTML = car.occupant
          ? `<kbd>E</kbd> Выкинуть водителя и угнать (${car.spec.name})`
          : `<kbd>E</kbd> Сесть в ${car.spec.name}`;
      } else {
        e.prompt.classList.add('hidden');
      }
    } else {
      e.prompt.classList.add('hidden');
    }

    if (e.wasted) e.wasted.classList.toggle('hidden', !player.dead);

    if (player.health < this._lastHP) {
      e.damage.style.opacity = '1';
      setTimeout(() => { e.damage.style.opacity = '0'; }, 140);
    }
    this._lastHP = player.health;
  }

  frame(dt, yaw, debugText) {
    const w = this.game.weapons, e = this.el;
    const armed = w.current >= 0 && !this.game.player.inVehicle && !this.wheelOpen;
    e.crosshair.classList.toggle('hidden', !armed);

    const hit = w.hitTimer > 0;
    if (hit !== this._hitShown) {
      e.hit.classList.toggle('show', hit);
      e.crosshair.classList.toggle('hit', hit);
      this._hitShown = hit;
    }

    const hs = w.headshotTimer > 0;
    if (hs !== this._hsShown) {
      e.hsBadge.classList.toggle('show', hs);
      this._hsShown = hs;
    }

    this._mapAcc += dt;
    if (this._mapAcc >= 1 / 30) { this._mapAcc = 0; this._drawMap(yaw); }

    if (this.debugOn && debugText !== undefined) e.debug.textContent = debugText;
  }

  _drawMap(yaw) {
    const ctx = this.mctx, S = this.mini.width, half = S / 2;
    const p = this.game.player.position;
    const range = this.game.player.inVehicle ? 190 : 140;
    const mapScale = this.mapCanvas.width / CITY.SIZE;
    const k = half / (range * mapScale);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(half, half);
    ctx.rotate(yaw);
    ctx.scale(k, k);
    ctx.translate(-(p.x + CITY.HALF) * mapScale, -(p.z + CITY.HALF) * mapScale);
    ctx.drawImage(this.mapCanvas, 0, 0);

    const cars = this.game.allVehicles ? this.game.allVehicles() : [];
    for (const v of cars) {
      if (v === this.game.player.inVehicle || v.destroyed) continue;
      const vx = (v.body.position.x + CITY.HALF) * mapScale, vz = (v.body.position.z + CITY.HALF) * mapScale;
      if (v.type === 'police' && v.sirenOn) {
        ctx.fillStyle = (Date.now() % 400 < 200) ? '#ff3344' : '#3388ff';
        ctx.beginPath(); ctx.arc(vx, vz, 5.5, 0, Math.PI * 2); ctx.fill();
      } else {
        ctx.fillStyle = 'rgba(210,220,235,0.75)';
        ctx.fillRect(vx - 2.5, vz - 2.5, 5, 5);
      }
    }

    if (this.waypoint) {
      ctx.fillStyle = '#f2c744';
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc((this.waypoint.x + CITY.HALF) * mapScale, (this.waypoint.z + CITY.HALF) * mapScale, 9, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    }
    ctx.restore();

    if (this.waypoint) {
      const dx = this.waypoint.x - p.x, dz = this.waypoint.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range * 0.92) {
        const ang = Math.atan2(dz, dx) + yaw;
        const rx = half + Math.cos(ang) * (half - 9);
        const ry = half + Math.sin(ang) * (half - 9);
        ctx.fillStyle = '#f2c744';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(rx, ry, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
    }

    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(half, half - 9);
    ctx.lineTo(half + 7, half + 8);
    ctx.lineTo(half, half + 4);
    ctx.lineTo(half - 7, half + 8);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }
}
