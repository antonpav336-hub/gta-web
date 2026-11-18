import { WEAPONS } from '../systems/WeaponSystem.js?v=10';
import { GROUP } from '../core/Physics.js?v=10';

const SAVE_KEY = 'lsw_save_v1';
const PRICES = { 1: 1500, 2: 2000, 3: 4000 };
const COLORS = [0xd62828, 0x1d4ed8, 0x111111, 0xf2f2f2, 0xf2c744, 0x16a34a, 0xea580c, 0x9333ea];
const MISSIONS = {
  delivery: { name: 'Доставка', pts: 1, min: 140, max: 260, speed: 6, pay: 3 },
  race: { name: 'Гонка по точкам', pts: 4, min: 80, max: 150, speed: 9, pay: 4 },
  far: { name: 'Дальний рейс', pts: 1, min: 300, max: 450, speed: 8, pay: 3.5 },
};

/** Extras — магазин, гараж, миссии и сохранение прогресса. */
export class Extras {
  constructor({ input, player, weapons, hud, physics, audio }) {
    Object.assign(this, { input, player, weapons, hud, physics, audio });
    this.mission = null;
    this.saveT = 0;

    this.toastEl = document.createElement('div'); this.toastEl.id = 'toast'; document.body.appendChild(this.toastEl);
    this.mhud = document.createElement('div'); this.mhud.id = 'missionHud'; document.body.appendChild(this.mhud);
    this.shopEl = document.getElementById('tab-shop');
    this.misEl = document.getElementById('tab-missions');

    this._load();
    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.tab === 'shop') this.renderShop();
      if (b.dataset.tab === 'missions') this.renderMissions();
    }));
    this.renderShop(); this.renderMissions();
  }

  toast(msg) {
    this.toastEl.textContent = msg; this.toastEl.classList.add('show');
    clearTimeout(this._tt); this._tt = setTimeout(() => this.toastEl.classList.remove('show'), 3000);
  }

  // ---------- Сохранение ----------
  _load() {
    try {
      const d = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
      if (!d) return;
      if (typeof d.money === 'number') this.player.money = d.money;
      if (Array.isArray(d.owned)) d.owned.forEach((v, i) => { if (i < WEAPONS.length) this.weapons.owned[i] = !!v || i === 0; });
    } catch (e) { /* ignore */ }
  }
  _save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify({ money: this.player.money, owned: this.weapons.owned })); } catch (e) { /* ignore */ }
  }

  // ---------- Магазин и гараж ----------
  _row(title, sub, label, enabled, fn) {
    const r = document.createElement('div'); r.className = 'row';
    r.innerHTML = `<div>${title}<small>${sub}</small></div>`;
    const b = document.createElement('button'); b.className = 'buy'; b.textContent = label; b.disabled = !enabled;
    b.addEventListener('click', fn); r.appendChild(b); return r;
  }
  _pay(cost) {
    if (this.player.money < cost) { this.toast('Не хватает денег'); return false; }
    this.player.money -= cost; this.audio.cashPickup(); this._save(); return true;
  }

  renderShop() {
    const p = this.player, w = this.weapons, el = this.shopEl;
    el.innerHTML = `<div class="row"><b>Деньги: $${p.money.toLocaleString('en-US')}</b></div>`;
    for (let i = 1; i < WEAPONS.length; i++) {
      const own = w.owned[i];
      el.appendChild(this._row(WEAPONS[i].name, own ? 'Куплено' : `Урон ${WEAPONS[i].dmg}, магазин ${WEAPONS[i].mag}`,
        own ? '✓' : '$' + PRICES[i], !own && p.money >= PRICES[i], () => {
          if (this._pay(PRICES[i])) { w.owned[i] = true; this._save(); this.renderShop(); this.toast('Куплено: ' + WEAPONS[i].name); }
        }));
    }
    el.appendChild(this._row('Патроны', 'Пополнить запас всего купленного оружия', '$250', p.money >= 250, () => {
      if (this._pay(250)) { WEAPONS.forEach((d, i) => { if (w.owned[i]) w.ammo[i].reserve = d.reserve; }); this.renderShop(); this.toast('Патроны пополнены'); }
    }));
    el.appendChild(this._row('Аптечка', 'Здоровье до 100%', '$150', p.money >= 150 && p.health < 100, () => {
      if (this._pay(150)) { p.health = 100; this.renderShop(); this.toast('Здоровье восстановлено'); }
    }));
    el.appendChild(this._row('Бронежилет', 'Броня до 100%', '$300', p.money >= 300 && p.armor < 100, () => {
      if (this._pay(300)) { p.armor = 100; this.renderShop(); this.toast('Броня 100%'); }
    }));
    const g = document.createElement('div');
    g.innerHTML = `<div class="row"><div>Гараж: покраска авто<small>${p.inVehicle ? '$500 за покраску текущей машины' : 'Сядьте в машину (E), затем откройте это меню'}</small></div></div>`;
    const sw = document.createElement('div'); sw.className = 'swatches';
    COLORS.forEach((c) => {
      const s = document.createElement('div'); s.className = 'swatch'; s.style.background = '#' + c.toString(16).padStart(6, '0');
      s.addEventListener('click', () => {
        const v = p.inVehicle;
        if (!v || !v.paintMat) { this.toast('Сначала сядьте в машину'); return; }
        if (this._pay(500)) { v.paintMat.color.setHex(c); this.renderShop(); this.toast('Машина перекрашена'); }
      });
      sw.appendChild(s);
    });
    g.appendChild(sw); el.appendChild(g);
  }

  // ---------- Миссии ----------
  renderMissions() {
    const el = this.misEl;
    el.innerHTML = '<div class="row"><div>Выберите задание<small>Доедьте или добегите до жёлтого маяка до конца таймера. Награда зависит от расстояния.</small></div></div>';
    for (const k in MISSIONS) {
      const m = MISSIONS[k];
      el.appendChild(this._row(m.name, m.pts > 1 ? `${m.pts} точки подряд` : `Одна точка, ${m.min}–${m.max} м`, 'НАЧАТЬ', true, () => this.start(k)));
    }
    if (this.mission) el.appendChild(this._row('Текущая миссия: ' + this.mission.def.name, 'Можно отменить', 'ОТМЕНА', true, () => { this._end(); this.renderMissions(); }));
  }

  _findFree(cx, cz, rMin, rMax) {
    for (let t = 0; t < 80; t++) {
      const a = Math.random() * Math.PI * 2, r = rMin + Math.random() * (rMax - rMin);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      if (Math.abs(x) > 230 || Math.abs(z) > 230) continue;
      if (!this.physics.raycast(x, 160, z, x, 0.3, z, GROUP.STATIC).hasHit) return { x, z };
    }
    return null;
  }

  start(kind) {
    const def = MISSIONS[kind], p = this.player;
    const pts = []; let cx = p.position.x, cz = p.position.z, dist = 0;
    for (let i = 0; i < def.pts; i++) {
      const pt = this._findFree(cx, cz, def.min, def.max);
      if (!pt) { this.toast('Не удалось найти точку, попробуйте ещё раз'); return; }
      dist += Math.hypot(pt.x - cx, pt.z - cz); pts.push(pt); cx = pt.x; cz = pt.z;
    }
    this.mission = { def, pts, idx: 0, time: dist / def.speed + 15, reward: Math.round(dist * def.pay) };
    this.hud.waypoint = { x: pts[0].x, z: pts[0].z };
    this.toast(`${def.name}: награда $${this.mission.reward}`);
    this.renderMissions();
    this.input.requestLock();
  }

  _end() { this.mission = null; this.hud.waypoint = null; this.mhud.style.display = 'none'; }

  update(dt) {
    this.saveT += dt;
    if (this.saveT > 3) { this.saveT = 0; this._save(); }
    const m = this.mission; if (!m) return;
    if (this.player.dead) { this.toast('Миссия провалена'); this._end(); return; }
    m.time -= dt;
    const pt = m.pts[m.idx], px = this.player.position.x, pz = this.player.position.z;
    const d = Math.hypot(pt.x - px, pt.z - pz);
    if (d < 10) {
      m.idx++;
      if (m.idx >= m.pts.length) {
        this.player.money += m.reward; this.audio.cashPickup(); this._save();
        this.toast(`Миссия выполнена! +$${m.reward}`); this._end(); return;
      }
      this.hud.waypoint = { x: m.pts[m.idx].x, z: m.pts[m.idx].z };
    } else if (!this.hud.waypoint) {
      this.hud.waypoint = { x: pt.x, z: pt.z };
    }
    if (m.time <= 0) { this.toast('Время вышло — миссия провалена'); this._end(); return; }
    this.mhud.style.display = 'block';
    this.mhud.textContent = `${m.def.name} ${m.idx + 1}/${m.pts.length} • ${Math.round(d)} м • ${Math.ceil(m.time)} с • $${m.reward}`;
  }
}
