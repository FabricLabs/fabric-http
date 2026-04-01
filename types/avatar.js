'use strict';

const crypto = require('crypto');

function sha256 (input) {
  return crypto.createHash('sha256').update(String(input)).digest();
}

function lerp (a, b, t) {
  return Math.round(a + (b - a) * t);
}

function mixHex (fromHex, toHex, t) {
  const a = fromHex.replace('#', '');
  const b = toHex.replace('#', '');
  const ar = parseInt(a.slice(0, 2), 16);
  const ag = parseInt(a.slice(2, 4), 16);
  const ab = parseInt(a.slice(4, 6), 16);
  const br = parseInt(b.slice(0, 2), 16);
  const bg = parseInt(b.slice(2, 4), 16);
  const bb = parseInt(b.slice(4, 6), 16);
  const rr = lerp(ar, br, t).toString(16).padStart(2, '0');
  const rg = lerp(ag, bg, t).toString(16).padStart(2, '0');
  const rb = lerp(ab, bb, t).toString(16).padStart(2, '0');
  return `#${rr}${rg}${rb}`;
}

/**
 * Deterministic avatar generator inspired by academic visual hash work
 * (e.g. Perrig/Song "Hash Visualization", a.k.a. "drunken bishop").
 *
 * The algorithm walks a diagonal "bishop" across a board using bits from
 * SHA-256(input), accumulating visit counts to produce a stable identicon.
 */
class Avatar {
  /**
   * @param {string} [input=''] Seed input used to derive deterministic avatar bytes.
   * @param {Object} [settings={}] Optional rendering configuration (size, colors, grid, steps).
   */
  constructor (input = '', settings = {}) {
    this.input = String(input);
    this.settings = Object.assign({
      size: 128,
      cells: 9,
      steps: 96,
      padding: 0.08,
      // Fabric-ish dark/cyan/violet palette.
      background: '#0b0f1a',
      primary: '#2dd4bf',
      secondary: '#8b5cf6',
      stroke: '#1f2937'
    }, settings);

    const seed = sha256(this.input);
    this._state = { seed };
    this._state.board = this._buildBoard();

    return this;
  }

  static from (input, settings = {}) {
    return new Avatar(input, settings);
  }

  get board () {
    return this._state.board.map((row) => row.slice());
  }

  _readBitPair (buffer, index) {
    const byte = buffer[Math.floor(index / 4) % buffer.length];
    const shift = (index % 4) * 2;
    return (byte >> shift) & 0x03;
  }

  _buildBoard () {
    const cells = Math.max(5, Number(this.settings.cells) | 0);
    const steps = Math.max(16, Number(this.settings.steps) | 0);
    const board = Array.from({ length: cells }, () => Array(cells).fill(0));
    const dirs = [
      [-1, -1], // NW
      [1, -1], // NE
      [-1, 1], // SW
      [1, 1] // SE
    ];

    let x = Math.floor(cells / 2);
    let y = Math.floor(cells / 2);
    let entropy = this._state.seed;
    let pairIndex = 0;
    board[y][x] += 2; // emphasize origin

    for (let i = 0; i < steps; i++) {
      if (pairIndex > 0 && pairIndex % (entropy.length * 4) === 0) {
        entropy = sha256(entropy);
      }

      const dir = this._readBitPair(entropy, pairIndex++);
      let dx = dirs[dir][0];
      let dy = dirs[dir][1];

      // Reflect at edges so the walk stays on-board.
      if (x + dx < 0 || x + dx >= cells) dx *= -1;
      if (y + dy < 0 || y + dy >= cells) dy *= -1;

      x += dx;
      y += dy;
      board[y][x] += 1;
    }

    return board;
  }

  _toRects () {
    const { size, padding, primary, secondary, cells } = this.settings;
    const board = this._state.board;
    const grid = Math.max(5, Number(cells) | 0);
    const px = Number(size) || 128;
    const pad = Math.max(0, Math.min(0.45, Number(padding) || 0.08));
    const inner = px * (1 - (pad * 2));
    const cell = inner / grid;

    let max = 0;
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) max = Math.max(max, board[y][x]);
    }
    if (max < 1) max = 1;

    const rects = [];
    for (let y = 0; y < grid; y++) {
      for (let x = 0; x < grid; x++) {
        const value = board[y][x];
        if (!value) continue;
        const t = Math.min(1, value / max);
        const fill = mixHex(primary, secondary, t * 0.75);
        rects.push({
          x: (px * pad) + (x * cell),
          y: (px * pad) + (y * cell),
          w: cell,
          h: cell,
          fill,
          alpha: 0.25 + (t * 0.75)
        });
      }
    }

    return { px, rects };
  }

  toSVG () {
    const { background, stroke } = this.settings;
    const { px, rects } = this._toRects();
    const radius = Math.max(1, Math.round(px * 0.08));

    const cells = rects.map((r) => {
      const x = r.x.toFixed(3);
      const y = r.y.toFixed(3);
      const w = r.w.toFixed(3);
      const h = r.h.toFixed(3);
      const o = r.alpha.toFixed(3);
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.max(1, w * 0.16).toFixed(3)}" fill="${r.fill}" fill-opacity="${o}" />`;
    }).join('');

    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${px} ${px}" role="img" aria-label="Fabric Avatar">`,
      `<rect width="${px}" height="${px}" rx="${radius}" fill="${background}" />`,
      cells,
      `<rect x="0.5" y="0.5" width="${px - 1}" height="${px - 1}" rx="${radius}" fill="none" stroke="${stroke}" stroke-opacity="0.75" />`,
      '</svg>'
    ].join('');
  }

  toDataURI () {
    const svg = this.toSVG();
    const encoded = encodeURIComponent(svg)
      .replace(/%20/g, ' ')
      .replace(/%3D/g, '=')
      .replace(/%3A/g, ':')
      .replace(/%2F/g, '/');
    return `data:image/svg+xml;utf8,${encoded}`;
  }

  /**
   * Render a deterministic ASCII visual hash for terminal/text comparison.
   * Lower visit counts use lighter glyphs; higher counts use denser glyphs.
   * @returns {String}
   */
  toASCII () {
    const board = this._state.board;
    const glyphs = ' .:-=+*#%@';
    let max = 0;
    for (let y = 0; y < board.length; y++) {
      for (let x = 0; x < board[y].length; x++) max = Math.max(max, board[y][x]);
    }
    if (max < 1) max = 1;

    const lines = [];
    for (let y = 0; y < board.length; y++) {
      let line = '';
      for (let x = 0; x < board[y].length; x++) {
        const v = board[y][x];
        const idx = Math.min(glyphs.length - 1, Math.round((v / max) * (glyphs.length - 1)));
        line += glyphs[idx];
      }
      lines.push(line);
    }

    return lines.join('\n');
  }

  /**
   * Render a consumable HTML snippet.
   * @param {Object} [settings]
   * @param {('img'|'svg')} [settings.format='img'] Output format.
   * @param {String} [settings.className='fabric-avatar'] CSS class for wrapper output.
   * @param {String} [settings.alt='Fabric Avatar'] alt label for image output.
   * @returns {String}
   */
  render (settings = {}) {
    const opts = Object.assign({
      format: 'img',
      className: 'fabric-avatar',
      alt: 'Fabric Avatar'
    }, settings);

    if (opts.format === 'svg') return this.toSVG();

    const classAttr = opts.className ? ` class="${String(opts.className)}"` : '';
    const altAttr = String(opts.alt || 'Fabric Avatar').replace(/"/g, '&quot;');
    return `<img${classAttr} src="${this.toDataURI()}" alt="${altAttr}" />`;
  }

  toHTML (settings = {}) {
    return this.render(settings);
  }
}

module.exports = Avatar;
