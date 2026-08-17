'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#90caf9', // J - azul pálido
  '#ffb74d', // L - orange
  '#f48fb1', // Cat - pink
  '#b0bec5', // Nut - tuerca (acero)
  '#4db6ac', // Plus (+) - teal
  '#7e57c2', // U - deep purple
  '#ec407a', // Y - rose
  '#ffd700', // Single (1x1) - dorado (recompensa)
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
  [[8,0,8],[8,8,8],[8,0,8]],                  // Cat (ears + face + paws)
  [[9,9,9],[9,0,9],[9,9,9]],                  // Nut - tuerca (hueco central)
  [[0,10,0],[10,10,10],[0,10,0]],             // + pentominó
  [[11,0,11],[11,11,11]],                     // U pentominó
  [[0,12],[12,12],[0,12],[0,12]],             // Y pentominó
  [[13]],                                     // Single 1x1
];

// Piezas normales (frecuentes) y especiales (ocasionales).
const NORMAL_PIECES = [1, 2, 3, 4, 5, 6, 7, 8]; // 7 tetrominós + gato
const SPECIAL_PIECES = [9, 10, 11, 12];         // tuerca + pentominós (+, U, Y)
const SINGLE = 13;
const SPECIAL_CHANCE = 0.15;

const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = [400, 800, 1200, 1600]; // por líneas limpiadas: 0,1,2,3
const PERFECT_CLEAR_BONUS = 2000;            // × nivel
const B2B_MULTIPLIER = 1.5;                  // back-to-back (Tetris / T-spin)

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const themeToggle = document.getElementById('theme-toggle');
const skinSelect = document.getElementById('skin-select');

const THEME_KEY = 'tetris-theme';
const SKIN_KEY = 'tetris-skin';

// Paletas por skin. `colors` reemplaza a COLORS cuando la skin está activa.
const SKINS = {
  retro: {
    colors: COLORS,
    glow: false,
    radius: 0,
    texture: false,
    bg: null,
  },
  neon: {
    colors: [
      null,
      '#00e5ff', '#fff176', '#e040fb', '#69f0ae', '#ff5252',
      '#448aff', '#ffab40', '#ff4081', '#e0e0e0', '#1de9b6',
      '#7c4dff', '#f50057', '#ffea00',
    ],
    glow: true,
    radius: 0,
    texture: false,
    bg: '#000000',
  },
  pastel: {
    colors: [
      null,
      '#a7d8de', '#fff2b2', '#d8b6e0', '#bfe3bf', '#f3b8b8',
      '#c3ddf7', '#ffd8ae', '#f6c9db', '#d9dee2', '#a9dcd4',
      '#c9bce8', '#f5b9cf', '#fff0a3',
    ],
    glow: false,
    radius: 6,
    texture: false,
    bg: null,
  },
  pixel: {
    colors: COLORS,
    glow: false,
    radius: 0,
    texture: true,
    bg: null,
  },
};

let currentSkin = SKINS.retro;

function applySkin(name) {
  const skin = SKINS[name] ? name : 'retro';
  currentSkin = SKINS[skin];
  if (skinSelect) skinSelect.value = skin;
  canvas.style.background = currentSkin.bg || '';
  localStorage.setItem(SKIN_KEY, skin);
}

if (skinSelect) {
  skinSelect.addEventListener('change', () => {
    applySkin(skinSelect.value);
    // Repinta de inmediato (aunque el juego esté pausado/game over) para que
    // el cambio de skin se vea en el próximo frame sin recargar la página.
    if (current) draw();
    if (next) drawNext();
  });
}

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, gridColor, rewardNext;
let combo, b2b, lastMoveWasRotation, effects;
let audioCtx;

function applyTheme(theme) {
  document.body.classList.toggle('light', theme === 'light');
  themeToggle.checked = theme === 'light';
  gridColor = getComputedStyle(document.body).getPropertyValue('--grid-line').trim();
  localStorage.setItem(THEME_KEY, theme);
}

themeToggle.addEventListener('change', () => {
  applyTheme(themeToggle.checked ? 'light' : 'dark');
});

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function makePiece(type) {
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function randomPiece() {
  const pool = Math.random() < SPECIAL_CHANCE ? SPECIAL_PIECES : NORMAL_PIECES;
  const type = pool[Math.floor(Math.random() * pool.length)];
  return makePiece(type);
}

// Devuelve la próxima pieza, entregando el single como recompensa tras un Tetris.
function nextPiece() {
  if (rewardNext) {
    rewardNext = false;
    return makePiece(SINGLE);
  }
  return randomPiece();
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      lastMoveWasRotation = true;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  return cleared;
}

function isBoardEmpty() {
  return board.every(row => row.every(v => v === 0));
}

// Regla de 3 esquinas: T + última acción rotación + ≥3 diagonales bloqueadas.
function detectTSpin() {
  if (current.type !== 3 || !lastMoveWasRotation) return false;
  const cx = current.x + 1, cy = current.y + 1; // centro del T (celda media del 3×3)
  const corners = [[cx - 1, cy - 1], [cx + 1, cy - 1], [cx - 1, cy + 1], [cx + 1, cy + 1]];
  let occupied = 0;
  for (const [x, y] of corners) {
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) { occupied++; continue; } // pared/suelo
    if (board[y][x]) occupied++;
  }
  return occupied >= 3;
}

function applyScoring(cleared, tSpin) {
  // Combo: se encadena mientras haya limpiezas consecutivas.
  if (cleared > 0) combo++; else combo = 0;

  const labels = [];
  const isTetris = cleared === 4;
  const isTSpin = tSpin;              // T-spin (con o sin líneas)
  const difficult = isTetris || (isTSpin && cleared > 0);

  // Base
  let points = (isTSpin ? TSPIN_SCORES[cleared] : (LINE_SCORES[cleared] || 0)) * level;

  if (isTSpin) labels.push(cleared > 0 ? `T-SPIN x${cleared}` : 'T-SPIN');
  else if (isTetris) labels.push('TETRIS');

  // Multiplicador de combo (x2, x3, x4…)
  if (cleared > 0 && combo >= 2) {
    points *= combo;
    labels.push(`COMBO x${combo}`);
  }

  // Back-to-back entre limpiezas difíciles
  if (cleared > 0) {
    if (difficult && b2b) {
      points = Math.floor(points * B2B_MULTIPLIER);
      labels.push('B2B');
    }
    b2b = difficult;
  }

  // Perfect Clear: tablero vacío tras limpiar
  if (cleared > 0 && isBoardEmpty()) {
    points += PERFECT_CLEAR_BONUS * level;
    labels.push('PERFECT CLEAR');
  }

  score += points;

  if (cleared > 0) {
    lines += cleared;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    if (isTetris) rewardNext = true; // Tetris → recompensa: pieza single
  }

  if (labels.length) triggerEffects(labels, points);
  updateHUD();
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  if (gy > current.y) lastMoveWasRotation = false; // hubo desplazamiento vertical
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    lastMoveWasRotation = false;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  const tSpin = detectTSpin();
  merge();
  const cleared = clearLines();
  applyScoring(cleared, tSpin);
  spawn();
}

function spawn() {
  current = next;
  next = nextPiece();
  lastMoveWasRotation = false;
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawRoundRectPath(context, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  if (typeof context.roundRect === 'function') {
    context.beginPath();
    context.roundRect(x, y, w, h, radius);
    return;
  }
  // Fallback manual para navegadores sin ctx.roundRect.
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + w - radius, y);
  context.arcTo(x + w, y, x + w, y + radius, radius);
  context.lineTo(x + w, y + h - radius);
  context.arcTo(x + w, y + h, x + w - radius, y + h, radius);
  context.lineTo(x + radius, y + h);
  context.arcTo(x, y + h, x, y + h - radius, radius);
  context.lineTo(x, y + radius);
  context.arcTo(x, y, x + radius, y, radius);
  context.closePath();
}

function drawBlockTexture(context, px, py, size, baseAlpha) {
  // Mini-cuadrícula 3x3 (pixel art / dithering) sobre el bloque.
  // Se escala por baseAlpha para respetar la translucidez del llamador
  // (ej. el ghost piece, dibujado con alpha reducido).
  context.save();
  context.globalAlpha = 0.18 * baseAlpha;
  context.strokeStyle = '#000000';
  context.lineWidth = 1;
  const step = (size - 2) / 3;
  for (let i = 1; i < 3; i++) {
    context.beginPath();
    context.moveTo(px + i * step, py);
    context.lineTo(px + i * step, py + size - 2);
    context.stroke();
    context.beginPath();
    context.moveTo(px, py + i * step);
    context.lineTo(px + size - 2, py + i * step);
    context.stroke();
  }
  context.globalAlpha = 0.1 * baseAlpha;
  context.fillStyle = '#ffffff';
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if ((r + c) % 2 === 0) {
        context.fillRect(px + c * step, py + r * step, step, step);
      }
    }
  }
  context.restore();
}

// Rellena un rectángulo (recto o con esquinas redondeadas según `radius`).
function fillBlockShape(context, px, py, w, h, radius) {
  if (radius > 0) {
    drawRoundRectPath(context, px, py, w, h, radius);
    context.fill();
  } else {
    context.fillRect(px, py, w, h);
  }
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const skin = currentSkin || SKINS.retro;
  const palette = skin.colors || COLORS;
  const color = palette[colorIndex] || COLORS[colorIndex];
  const px = x * size + 1;
  const py = y * size + 1;
  const w = size - 2;
  const h = size - 2;

  context.save();
  context.globalAlpha = alpha ?? 1;

  if (skin.glow) {
    context.shadowColor = color;
    context.shadowBlur = size * 0.6;
  }

  context.fillStyle = color;
  fillBlockShape(context, px, py, w, h, skin.radius);

  // Segunda pasada para el glow: refuerza el relleno sin la sombra duplicándose
  // en el highlight, y evita que shadowBlur afecte al highlight/textura.
  context.shadowBlur = 0;

  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  fillBlockShape(context, px, py, w, Math.min(4, h), skin.radius);

  if (skin.texture) {
    drawBlockTexture(context, px, py, size, alpha ?? 1);
  }

  context.restore();
}

function drawGrid() {
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);

  drawEffects(performance.now());
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

// ---- Efectos visuales y sonoros ----

function triggerEffects(labels, points) {
  effects.push({
    text: labels.join('  ·  '),
    points,
    start: performance.now(),
    duration: 1300,
  });
  playChain(labels);
}

function drawEffects(now) {
  effects = effects.filter(e => now - e.start < e.duration);
  for (const e of effects) {
    const t = (now - e.start) / e.duration;
    const alpha = 1 - t;
    const y = canvas.height / 2 - t * 60;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#ffe082';
    // Escala la fuente para que el texto quepa en el ancho del tablero.
    const maxW = canvas.width - 16;
    let fontSize = 24;
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textW = ctx.measureText(e.text).width;
    if (textW > maxW) {
      fontSize = Math.max(12, Math.floor(fontSize * maxW / textW));
      ctx.font = `bold ${fontSize}px sans-serif`;
    }
    ctx.fillText(e.text, canvas.width / 2, y);
    if (e.points > 0) {
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(`+${e.points.toLocaleString()}`, canvas.width / 2, y + 26);
    }
    ctx.restore();
  }
}

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; }
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function beep(freq, startOffset, dur, gain) {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime + startOffset;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

// Arpegio ascendente: más notas y más agudo al encadenar; nota extra en bonos.
function playChain(labels) {
  if (!audioCtx) return;
  const scale = [523, 659, 784, 988, 1175, 1319, 1568]; // C5 E5 G5 B5 D6 E6 G6
  const notes = Math.min(scale.length, Math.max(2, combo + 1));
  for (let i = 0; i < notes; i++) beep(scale[i], i * 0.06, 0.12, 0.08);
  const special = labels.some(l => l === 'TETRIS' || l.startsWith('T-SPIN') || l === 'PERFECT CLEAR');
  if (special) beep(1976, notes * 0.06, 0.25, 0.09); // B6 destacado
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
      lastMoveWasRotation = false;
    } else {
      lockPiece();
    }
  }
  draw();
  if (!gameOver) animId = requestAnimationFrame(loop);
}

function init() {
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');
  applySkin(localStorage.getItem(SKIN_KEY) || 'retro');
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  dropInterval = 1000;
  dropAccum = 0;
  rewardNext = false;
  combo = 0;
  b2b = false;
  lastMoveWasRotation = false;
  effects = [];
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  // Ignorar controles del juego cuando el foco está en un control de UI
  // (ej. el <select> de skin), para no interceptar su propia navegación
  // por teclado (flechas/espacio).
  const tag = e.target && e.target.tagName;
  if (tag === 'SELECT' || tag === 'INPUT' || tag === 'BUTTON') return;
  ensureAudio();
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) { current.x--; lastMoveWasRotation = false; }
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) { current.x++; lastMoveWasRotation = false; }
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);

init();
