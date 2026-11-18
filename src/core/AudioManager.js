/**
 * AudioManager — процедурный синтез звуков через Web Audio API.
 * Включает звуки оружия, шагов, двигателя авто, гудка, сирены полиции, ударов и дверей.
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.volume = 0.7;
    this.master = null;
    this.noiseBuf = null;
    this._engineOsc = null;
    this._engineGain = null;
    this._sirenOsc = null;
    this._sirenGain = null;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC({ latencyHint: 'interactive' });

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(this.ctx.destination);

    const len = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._startAmbient();
    this._initContinuousChannels();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  _burst({ t = 0, dur = 0.1, type = 'lowpass', f0 = 2000, f1 = f0, q = 0.7, gain = 0.5, attack = 0.002 }) {
    const c = this.ctx, now = c.currentTime + t;
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.9 + Math.random() * 0.2;
    const filt = c.createBiquadFilter();
    filt.type = type; filt.Q.value = q;
    filt.frequency.setValueAtTime(f0, now);
    filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(gain, now + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(now, Math.random() * 0.5, dur + 0.05);
  }

  setRain(level) {
    if (!this.ctx) return;
    if (!this._rain) {
      const c = this.ctx, src = c.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.5;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(f); f.connect(g); g.connect(this.master); src.start();
      this._rain = { g };
    }
    this._rain.g.gain.setTargetAtTime(level * 0.22, this.ctx.currentTime, 0.6);
  }

  explosion() {
    if (!this.ctx) return;
    this._burst({ dur: 1.4, type: 'lowpass', f0: 1800, f1: 60, q: 0.8, gain: 1.0, attack: 0.005 });
    this._burst({ t: 0.05, dur: 0.6, type: 'bandpass', f0: 900, f1: 200, q: 0.9, gain: 0.6 });
    this._tone({ dur: 0.9, f0: 90, f1: 28, gain: 0.9 });
  }

  _tone({ t = 0, dur = 0.1, f0 = 150, f1 = 40, gain = 0.5, type = 'sine' }) {
    const c = this.ctx, now = c.currentTime + t;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, now);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.connect(g); g.connect(this.master);
    o.start(now); o.stop(now + dur + 0.02);
  }

  _startAmbient() {
    const c = this.ctx;
    const mk = (freq, gain) => {
      const src = c.createBufferSource();
      src.buffer = this.noiseBuf; src.loop = true;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
      const g = c.createGain(); g.gain.value = gain;
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start();
    };
    mk(180, 0.06);
    mk(900, 0.01);
  }

  _initContinuousChannels() {
    const c = this.ctx;
    // Двигатель машины игрока
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filt = c.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 260;
    const g = c.createGain();
    g.gain.value = 0;
    osc.connect(filt); filt.connect(g); g.connect(this.master);
    osc.start();
    this._engineOsc = osc;
    this._engineFilt = filt;
    this._engineGain = g;

    // Полицейская сирена
    const sOsc = c.createOscillator();
    sOsc.type = 'triangle';
    sOsc.frequency.value = 650;
    const sGain = c.createGain();
    sGain.gain.value = 0;
    sOsc.connect(sGain); sGain.connect(this.master);
    sOsc.start();
    this._sirenOsc = sOsc;
    this._sirenGain = sGain;
  }

  updateVehicleEngine(active, speedRatio) {
    if (!this.ctx || !this._engineGain) return;
    const now = this.ctx.currentTime;
    if (!active) {
      this._engineGain.gain.setTargetAtTime(0, now, 0.08);
      return;
    }
    const rpm = 48 + Math.min(1.4, speedRatio) * 115;
    this._engineOsc.frequency.setTargetAtTime(rpm, now, 0.06);
    this._engineFilt.frequency.setTargetAtTime(220 + speedRatio * 550, now, 0.06);
    this._engineGain.gain.setTargetAtTime(0.11 + speedRatio * 0.09, now, 0.08);
  }

  updatePoliceSiren(active, time, dist = 30) {
    if (!this.ctx || !this._sirenGain) return;
    const now = this.ctx.currentTime;
    if (!active) {
      this._sirenGain.gain.setTargetAtTime(0, now, 0.12);
      return;
    }
    const atten = Math.max(0, 1 - dist / 140);
    const wail = 620 + Math.sin(time * 4.5) * 240;
    this._sirenOsc.frequency.setTargetAtTime(wail, now, 0.04);
    this._sirenGain.gain.setTargetAtTime(0.09 * atten, now, 0.08);
  }

  carDoor() {
    if (!this.ctx) return;
    this._burst({ dur: 0.08, type: 'lowpass', f0: 600, f1: 180, gain: 0.45 });
    this._tone({ t: 0.04, dur: 0.09, f0: 140, f1: 65, gain: 0.4 });
  }

  carHorn() {
    if (!this.ctx) return;
    this._tone({ dur: 0.28, f0: 390, f1: 385, gain: 0.22, type: 'sawtooth' });
    this._tone({ dur: 0.28, f0: 490, f1: 485, gain: 0.18, type: 'sawtooth' });
  }

  carCrash(strength = 1) {
    if (!this.ctx) return;
    const g = Math.min(0.75, 0.2 + strength * 0.35);
    this._burst({ dur: 0.24, type: 'lowpass', f0: 1200, f1: 160, gain: g });
    this._tone({ dur: 0.2, f0: 110, f1: 32, gain: g * 0.9 });
  }

  pedScream() {
    if (!this.ctx) return;
    const f = 380 + Math.random() * 140;
    this._tone({ dur: 0.24, f0: f, f1: f * 0.72, gain: 0.14, type: 'triangle' });
  }

  cashPickup() {
    if (!this.ctx) return;
    this._tone({ dur: 0.08, f0: 880, f1: 1100, gain: 0.15, type: 'sine' });
    this._tone({ t: 0.07, dur: 0.12, f0: 1320, f1: 1560, gain: 0.16, type: 'sine' });
  }

  shoot(s) {
    if (!this.ctx) return;
    this._burst({ dur: s.dur, type: 'lowpass', f0: s.f0, f1: s.f1, gain: s.gain, q: 0.9 });
    this._burst({ dur: s.dur * 0.35, type: 'highpass', f0: 2500, f1: 1500, gain: s.gain * 0.5 });
    this._tone({ dur: s.thumpDur, f0: s.thump, f1: s.thump * 0.28, gain: s.gain * 0.9 });
    this._burst({ t: 0.09, dur: s.dur * 2.2, type: 'lowpass', f0: 700, f1: 200, gain: s.gain * 0.22 });
  }

  reload(duration) {
    if (!this.ctx) return;
    const click = (t, f) => this._burst({ t, dur: 0.045, type: 'bandpass', f0: f, f1: f * 0.6, q: 3, gain: 0.5 });
    click(0.12, 1800);
    click(duration * 0.62, 1200);
    click(duration * 0.62 + 0.09, 2400);
    if (duration > 1.8) click(duration * 0.9, 2000);
  }

  dryClick() {
    if (!this.ctx) return;
    this._burst({ dur: 0.04, type: 'bandpass', f0: 2200, f1: 1500, q: 4, gain: 0.35 });
  }

  switchWeapon() {
    if (!this.ctx) return;
    this._burst({ dur: 0.06, type: 'bandpass', f0: 1000, f1: 600, q: 2, gain: 0.35 });
    this._burst({ t: 0.07, dur: 0.04, type: 'bandpass', f0: 2000, f1: 1500, q: 3, gain: 0.3 });
  }

  footstep(sprint) {
    if (!this.ctx) return;
    const g = sprint ? 0.32 : 0.2;
    this._burst({ dur: 0.07, type: 'lowpass', f0: sprint ? 900 : 650, f1: 200, gain: g, q: 0.5 });
    this._tone({ dur: 0.06, f0: 110, f1: 55, gain: g * 0.7 });
  }

  jump() {
    if (!this.ctx) return;
    this._burst({ dur: 0.12, type: 'lowpass', f0: 500, f1: 250, gain: 0.18 });
  }

  land(strength) {
    if (!this.ctx) return;
    const g = Math.min(0.6, 0.15 + strength * 0.04);
    this._burst({ dur: 0.12, type: 'lowpass', f0: 500, f1: 150, gain: g });
    this._tone({ dur: 0.14, f0: 90, f1: 40, gain: g });
  }

  roll() {
    if (!this.ctx) return;
    this._burst({ dur: 0.35, type: 'bandpass', f0: 500, f1: 300, q: 0.6, gain: 0.22 });
  }

  impact(surface = 'concrete') {
    if (!this.ctx) return;
    if (surface === 'wood') {
      this._burst({ dur: 0.08, type: 'bandpass', f0: 700, f1: 400, q: 2, gain: 0.3 });
    } else {
      this._burst({ dur: 0.06, type: 'highpass', f0: 3000, f1: 2000, gain: 0.22 });
      this._tone({ dur: 0.08, f0: 1800, f1: 900, gain: 0.05, type: 'triangle' });
    }
  }

  hitMarker() {
    if (!this.ctx) return;
    this._tone({ dur: 0.05, f0: 1400, f1: 1000, gain: 0.08, type: 'square' });
  }
}
