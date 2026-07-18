# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Classic Tetris in vanilla JS + HTML5 Canvas. No dependencies, no `package.json`, no build/bundler/transpiler. UI text is in Spanish.

## Running

No install/compile step. Either open `index.html` directly, or serve statically (recommended, avoids `file://` quirks):

```bash
python3 -m http.server 8000   # or: npx serve .
```

No test/lint tooling exists.

## Architecture

Three files: `index.html` (DOM + two canvases), `style.css` (dark arcade theme), `game.js` (all game logic, ~300 lines, single IIFE-less top-level module).

`game.js` key facts to know before editing:

- **Board model**: `ROWS × COLS` matrix; each cell is `0` (empty) or a color index `1–7` identifying the piece type. `COLORS` and `PIECES` arrays are 1-indexed (index `0` is `null`) — index = piece type = stored cell value.
- **Rotation** (`rotateCW`): transpose + reverse rows. `tryRotate` applies basic wall kicks by testing horizontal offsets `[0,-1,1,-2,2]`.
- **Game loop** (`loop`): `requestAnimationFrame`-driven, accumulates `dt` into `dropAccum` and drops one row when it exceeds `dropInterval`. State lives in module-level `let` vars reset by `init()`.
- **Scoring/level**: `LINE_SCORES` table × level; level rises every 10 lines; `dropInterval = max(100, 1000 - (level-1)*90)` ms.
- **Coupling constraint**: if you change `COLS`, `ROWS`, or `BLOCK`, you MUST also update the `<canvas id="board">` `width`/`height` in `index.html` to stay `COLS*BLOCK × ROWS*BLOCK`. They are not derived at runtime.

Input is handled by a single `keydown` listener at the bottom of `game.js`.
