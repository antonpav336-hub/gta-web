import * as THREE from 'three';

/**
 * Textures — процедурная генерация текстур через Canvas 2D (без загрузки файлов).
 * Возвращает диффузные текстуры, карты шероховатости (roughnessMap) и маски окон
 * для реалистичных отражений и шейдеров фасадов.
 */

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/** Зернистость: добавляет случайный шум яркости ко всему холсту. */
function addGrain(ctx, size, amount) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function toTexture(canvas, repeatX = 1, repeatY = 1, isSRGB = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = isSRGB ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 8;
  return t;
}

/** Асфальт без разметки (перекрёстки). */
function asphaltCanvas(size = 512) {
  const c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#33363c';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 45; i++) {
    ctx.fillStyle = `rgba(${18 + Math.random() * 28},${18 + Math.random() * 28},${22 + Math.random() * 28},0.28)`;
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 10 + Math.random() * 42, 6 + Math.random() * 26, Math.random() * 3, 0, 6.283);
    ctx.fill();
  }
  for (let i = 0; i < 1800; i++) {
    const g = 55 + Math.random() * 75;
    ctx.fillStyle = `rgba(${g},${g},${g},0.32)`;
    ctx.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  addGrain(ctx, size, 20);
  return c;
}

/** Карта шероховатости асфальта (лёгкие влажные/отполированные участки колеи). */
function asphaltRoughnessCanvas(size = 512) {
  const c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#d8d8d8';
  ctx.fillRect(0, 0, size, size);
  // Колея от машин чуть более гладкая
  ctx.fillStyle = 'rgba(130,130,130,0.45)';
  ctx.fillRect(85, 0, 80, size);
  ctx.fillRect(347, 0, 80, size);
  for (let i = 0; i < 18; i++) {
    ctx.fillStyle = 'rgba(95,95,95,0.35)';
    ctx.beginPath();
    ctx.ellipse(Math.random() * size, Math.random() * size, 16 + Math.random() * 44, 12 + Math.random() * 30, Math.random() * 3, 0, 6.283);
    ctx.fill();
  }
  addGrain(ctx, size, 18);
  return c;
}

/** Дорога с разметкой: u — поперёк дороги (0..1 = 16 м), v — вдоль (тайл = 16 м). */
function roadCanvas(size = 512) {
  const c = asphaltCanvas(size), ctx = c.getContext('2d');
  const s = size / 512;
  ctx.fillStyle = 'rgba(235,235,235,0.9)';
  ctx.fillRect(18 * s, 0, 5 * s, size);
  ctx.fillRect(489 * s, 0, 5 * s, size);
  ctx.fillStyle = 'rgba(240,200,60,0.95)';
  ctx.fillRect(250 * s, 0, 4 * s, size);
  ctx.fillRect(258 * s, 0, 4 * s, size);
  ctx.fillStyle = 'rgba(235,235,235,0.85)';
  for (let k = 0; k < 2; k++) {
    ctx.fillRect(126 * s, (k * 256 + 20) * s, 4 * s, 120 * s);
    ctx.fillRect(382 * s, (k * 256 + 20) * s, 4 * s, 120 * s);
  }
  addGrain(ctx, size, 10);
  return c;
}

/** Тротуарная плитка (земля вне дорог). Тайл = 8 м. */
function pavementCanvas(size = 512) {
  const c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#8b8f96';
  ctx.fillRect(0, 0, size, size);
  const step = size / 4;
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const l = 134 + Math.random() * 22;
      ctx.fillStyle = `rgb(${l},${l + 2},${l + 5})`;
      ctx.fillRect(x * step + 2, y * step + 2, step - 4, step - 4);
    }
  }
  ctx.strokeStyle = 'rgba(35,38,44,0.58)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, i * step); ctx.lineTo(size, i * step); ctx.stroke();
  }
  addGrain(ctx, size, 18);
  return c;
}

/**
 * Фасад здания + маска окон (для шейдера отражений и шероховатости).
 * Тайл = 8×8 м: 2 окна по горизонтали × 2 этажа.
 * style: 'concrete' | 'brick' | 'glass' | 'industrial'
 */
function facadeCanvases(style, size = 512) {
  const c = makeCanvas(size), ctx = c.getContext('2d');
  const m = makeCanvas(size), mctx = m.getContext('2d'); // маска окон: белый = стекло, чёрный = стена

  const palette = {
    concrete:   { wall: '#c4beb1', win: ['#162333', '#2d4663'], frame: '#7e7970' },
    brick:      { wall: '#9c4e38', win: ['#15202d', '#293e54'], frame: '#dfd7c8' },
    glass:      { wall: '#46586d', win: ['#0d1c2e', '#26496e'], frame: '#232e3d' },
    industrial: { wall: '#8f928d', win: ['#1d2328', '#3c4852'], frame: '#5f625d' },
  }[style];

  ctx.fillStyle = palette.wall;
  ctx.fillRect(0, 0, size, size);

  mctx.fillStyle = '#000000';
  mctx.fillRect(0, 0, size, size);

  if (style === 'brick') {
    const bh = size / 32, bw = size / 8;
    for (let y = 0; y < 32; y++) {
      for (let x = -1; x < 9; x++) {
        const off = (y % 2) * bw / 2;
        const v = 0.84 + Math.random() * 0.3;
        ctx.fillStyle = `rgb(${156 * v},${78 * v},${56 * v})`;
        ctx.fillRect(x * bw + off + 1, y * bh + 1, bw - 2, bh - 2);
      }
    }
  }
  if (style === 'industrial') {
    for (let x = 0; x < size; x += 16) {
      ctx.fillStyle = (x / 16) % 2 ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.08)';
      ctx.fillRect(x, 0, 8, size);
    }
  }

  const cols = 2, rows = 2;
  const cw = size / cols, rh = size / rows;
  const ww = style === 'glass' ? cw * 0.84 : cw * 0.54;
  const wh = style === 'glass' ? rh * 0.76 : rh * 0.52;

  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const wx = k * cw + (cw - ww) / 2;
      const wy = r * rh + (rh - wh) / 2 + 20;
      if (wy < size * 0.07 && wx < size * 0.07) continue;

      // Рама
      ctx.fillStyle = palette.frame;
      ctx.fillRect(wx - 6, wy - 6, ww + 12, wh + 12);

      // Тёмное глубокое стекло (шейдер добавит отражение поверх!)
      const g = ctx.createLinearGradient(wx, wy, wx, wy + wh);
      g.addColorStop(0, palette.win[1]);
      g.addColorStop(0.6, palette.win[0]);
      g.addColorStop(1, palette.win[0]);
      ctx.fillStyle = g;
      ctx.fillRect(wx, wy, ww, wh);

      // Маска стекла (белый = гладкое зеркальное стекло)
      mctx.fillStyle = '#ffffff';
      mctx.fillRect(wx, wy, ww, wh);

      // Переплёт (не отражает так сильно, как стекло)
      ctx.fillStyle = palette.frame;
      ctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      mctx.fillStyle = '#181818';
      mctx.fillRect(wx + ww / 2 - 2, wy, 4, wh);
      if (style !== 'glass') {
        ctx.fillRect(wx, wy + wh / 2 - 2, ww, 4);
        mctx.fillRect(wx, wy + wh / 2 - 2, ww, 4);
      }

      // Подоконник
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(wx - 10, wy + wh + 6, ww + 20, 6);
    }
  }

  // Межэтажные карнизы
  ctx.fillStyle = 'rgba(0,0,0,0.24)';
  ctx.fillRect(0, rh - 3, size, 5);
  ctx.fillRect(0, size - 5, size, 5);

  addGrain(ctx, size, 16);
  return { color: c, mask: m };
}

/** Деревянный ящик 256×256. */
function crateCanvas(size = 256) {
  const c = makeCanvas(size), ctx = c.getContext('2d');
  ctx.fillStyle = '#8a6236';
  ctx.fillRect(0, 0, size, size);
  const pl = size / 4;
  for (let i = 0; i < 4; i++) {
    const v = 0.85 + Math.random() * 0.25;
    ctx.fillStyle = `rgb(${150 * v},${105 * v},${60 * v})`;
    ctx.fillRect(8, i * pl + 3, size - 16, pl - 6);
    ctx.strokeStyle = 'rgba(60,35,15,0.5)';
    for (let k = 0; k < 4; k++) {
      ctx.beginPath();
      const y = i * pl + 8 + Math.random() * (pl - 16);
      ctx.moveTo(8, y); ctx.lineTo(size - 8, y + (Math.random() - 0.5) * 4); ctx.stroke();
    }
  }
  ctx.strokeStyle = '#5a3c1c'; ctx.lineWidth = 14;
  ctx.strokeRect(7, 7, size - 14, size - 14);
  ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(10, 10); ctx.lineTo(size - 10, size - 10);
  ctx.moveTo(size - 10, 10); ctx.lineTo(10, size - 10); ctx.stroke();
  addGrain(ctx, size, 16);
  return c;
}

/** Градиент неба (запасной). */
function skyTexture() {
  const c = document.createElement('canvas');
  c.width = 2; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#4f87c9');
  g.addColorStop(0.55, '#9cc4ec');
  g.addColorStop(1.0, '#d7e6f5');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 2, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createTextures() {
  const facades = {};
  const windowMasks = {};
  for (const style of ['concrete', 'brick', 'glass', 'industrial']) {
    const { color, mask } = facadeCanvases(style);
    facades[style] = toTexture(color, 1, 1, true);
    windowMasks[style] = toTexture(mask, 1, 1, false);
  }

  return {
    pavement: toTexture(pavementCanvas(), 250, 250),
    road: toTexture(roadCanvas(), 1, 1),
    asphalt: toTexture(asphaltCanvas(), 1, 1),
    asphaltRoughness: toTexture(asphaltRoughnessCanvas(), 1, 1, false),
    facade: facades,
    windowMask: windowMasks,
    crate: toTexture(crateCanvas()),
    sky: skyTexture(),
  };
}
