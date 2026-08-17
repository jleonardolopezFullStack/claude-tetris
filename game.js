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
const pauseMenu = document.getElementById('pause-menu');
const resumeBtn = document.getElementById('resume-btn');
const pauseRestartBtn = document.getElementById('pause-restart-btn');
const controlsToggleBtn = document.getElementById('controls-toggle-btn');
const controlsPanel = document.getElementById('controls-panel');
const levelDecBtn = document.getElementById('level-dec-btn');
const levelIncBtn = document.getElementById('level-inc-btn');
const levelValueEl = document.getElementById('level-value');

const THEME_KEY = 'tetris-theme';
const MIN_START_LEVEL = 1;
const MAX_START_LEVEL = 15;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, gridColor, rewardNext;
let combo, b2b, lastMoveWasRotation, effects;
let audioCtx;
// Nivel inicial elegido en el menú de pausa; se aplica a la PRÓXIMA partida (al Reiniciar).
// No se resetea en init() a propósito: debe sobrevivir entre partidas.
let selectedStartLevel = 1;
// Nivel con el que arrancó la partida actual (copia de selectedStartLevel tomada en init()),
// usado como base para el cálculo de nivel por líneas limpiadas.
let runStartLevel = 1;

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
    level = runStartLevel + Math.floor(lines / 10);
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

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
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

// Restablece los botones/paneles del overlay al estado por defecto (sin menú de pausa
// ni panel de controles abiertos). Usado tanto al terminar la partida como al reiniciar.
function resetOverlayControls() {
  restartBtn.classList.remove('hidden');
  pauseMenu.classList.add('hidden');
  controlsPanel.classList.add('hidden');
  controlsToggleBtn.textContent = 'Ver controles';
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);
  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;
  resetOverlayControls();
  overlay.classList.remove('hidden');
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    overlay.classList.add('hidden');
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    restartBtn.classList.add('hidden');
    pauseMenu.classList.remove('hidden');
    levelValueEl.textContent = selectedStartLevel;
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
  board = createBoard();
  score = 0;
  lines = 0;
  runStartLevel = selectedStartLevel;
  level = runStartLevel;
  paused = false;
  gameOver = false;
  dropInterval = Math.max(100, 1000 - (level - 1) * 90);
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
  resetOverlayControls();
  levelValueEl.textContent = selectedStartLevel;
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  ensureAudio();
  if (e.code === 'KeyP' || e.code === 'Escape') { togglePause(); return; }
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

resumeBtn.addEventListener('click', () => {
  if (paused) togglePause();
});

pauseRestartBtn.addEventListener('click', init);

controlsToggleBtn.addEventListener('click', () => {
  const willShow = controlsPanel.classList.contains('hidden');
  controlsPanel.classList.toggle('hidden', !willShow);
  controlsToggleBtn.textContent = willShow ? 'Ocultar controles' : 'Ver controles';
});

levelDecBtn.addEventListener('click', () => {
  selectedStartLevel = Math.max(MIN_START_LEVEL, selectedStartLevel - 1);
  levelValueEl.textContent = selectedStartLevel;
});

levelIncBtn.addEventListener('click', () => {
  selectedStartLevel = Math.min(MAX_START_LEVEL, selectedStartLevel + 1);
  levelValueEl.textContent = selectedStartLevel;
});

init();
