'use strict';

/**
 * @fileoverview Import the Twemoji SVGs that Fomantic's `flag` and `emoji` elements draw, so the
 * Semantic CSS never loads them from a CDN. They are not kept in the repository: builds fetch one
 * pinned jdecked/twemoji release, check it against its SHA-256 (bump both together), and write the
 * unmodified SVGs plus the CC-BY 4.0 license into the given folder (normally
 * `assets/themes/fabric/assets/twemoji/`). The tarball is cached, and unpacked, under this package's
 * own `.cache/twemoji/`. Needs `tar` on PATH (macOS, Linux, Windows 10+).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TWEMOJI_TAG = 'v17.0.3';
const TWEMOJI_SHA256 = 'a0855654b633045ae2337537e77f1bb4361162f7fcd910e613eaab1d6d9c5fca';
const TWEMOJI_URL = `https://codeload.github.com/jdecked/twemoji/tar.gz/refs/tags/${TWEMOJI_TAG}`;
const TWEMOJI_PREFIX = `twemoji-${TWEMOJI_TAG.replace(/^v/, '')}`;
const DEFAULT_CACHE = path.join(__dirname, '..', '.cache', 'twemoji');

const NOTICE = [
  `Twemoji ${TWEMOJI_TAG} (https://github.com/jdecked/twemoji)`,
  'Copyright 2019 Twitter, Inc and other contributors',
  'Graphics licensed under CC-BY 4.0: https://creativecommons.org/licenses/by/4.0/ (see LICENSE-GRAPHICS)',
  'Unmodified. Used by the Fomantic UI flag and emoji elements in @fabric/http.',
  ''
].join('\n');

/** @private */
function sha256 (buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * @private
 * @returns {Promise<Buffer>} The verified release tarball, from the cache when it is intact.
 */
async function loadTarball (cacheDir) {
  const cached = path.join(cacheDir, `twemoji-${TWEMOJI_TAG}.tar.gz`);
  if (fs.existsSync(cached)) {
    const body = fs.readFileSync(cached);
    if (sha256(body) === TWEMOJI_SHA256) return body;
  }
  const response = await fetch(TWEMOJI_URL);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${TWEMOJI_URL}`);
  const body = Buffer.from(await response.arrayBuffer());
  const digest = sha256(body);
  if (digest !== TWEMOJI_SHA256) {
    throw new Error(`SHA-256 mismatch for ${TWEMOJI_URL}: expected ${TWEMOJI_SHA256}, got ${digest}`);
  }
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, body);
  return body;
}

/**
 * Write the pinned Twemoji SVGs into `destination`, replacing what is there. A folder already
 * holding this release (its `NOTICE` names the tag) is left alone.
 * @param {string} destination Folder the Semantic CSS points `@flagPath` / `@emojiPath` at.
 * @param {Object} [options]
 * @param {string} [options.cacheDir] Where to keep the downloaded tarball.
 * @returns {Promise<{ tag: string, count: number, skipped: boolean }>}
 */
async function importTwemoji (destination, options = {}) {
  const notice = path.join(destination, 'NOTICE');
  if (fs.existsSync(notice) && fs.readFileSync(notice, 'utf8') === NOTICE) {
    const count = fs.readdirSync(destination).filter((n) => n.endsWith('.svg')).length;
    return { tag: TWEMOJI_TAG, count, skipped: true };
  }

  const cacheDir = options.cacheDir || DEFAULT_CACHE;
  const tarball = await loadTarball(cacheDir);
  const work = fs.mkdtempSync(path.join(cacheDir, 'unpack-'));
  try {
    const archive = path.join(work, 'twemoji.tar.gz');
    fs.writeFileSync(archive, tarball);
    const tar = spawnSync('tar', [
      '-xzf', archive, '-C', work, '--strip-components=1',
      `${TWEMOJI_PREFIX}/assets/svg`, `${TWEMOJI_PREFIX}/LICENSE-GRAPHICS`
    ], { stdio: 'inherit' });
    if (tar.error) throw tar.error;
    if (tar.status !== 0) throw new Error(`tar exited with ${tar.status}`);

    const svgDir = path.join(work, 'assets', 'svg');
    const names = fs.readdirSync(svgDir).filter((n) => /^[0-9a-f]+(-[0-9a-f]+)*\.svg$/.test(n));
    if (names.length === 0) throw new Error('No SVGs found in the Twemoji archive');

    fs.rmSync(destination, { recursive: true, force: true });
    fs.mkdirSync(destination, { recursive: true });
    for (const name of names) {
      fs.copyFileSync(path.join(svgDir, name), path.join(destination, name));
    }
    fs.copyFileSync(path.join(work, 'LICENSE-GRAPHICS'), path.join(destination, 'LICENSE-GRAPHICS'));
    fs.writeFileSync(notice, NOTICE);
    return { tag: TWEMOJI_TAG, count: names.length, skipped: false };
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

module.exports = {
  TWEMOJI_TAG,
  TWEMOJI_SHA256,
  importTwemoji
};
