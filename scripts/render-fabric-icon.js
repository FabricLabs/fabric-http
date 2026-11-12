'use strict';

/**
 * Render the canonical Fabric lettermark (serif lowercase f) into package `assets/`.
 * Writes nothing outside this package; apps copy the files from `assets/` themselves.
 *
 * Requires macOS (`swift`, `sips`, `iconutil`).
 *
 *   node scripts/render-fabric-icon.js
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  FABRIC_BRAND_PURPLE,
  FABRIC_BRAND_FOREGROUND,
  FABRIC_BRAND_LETTER
} = require('../functions/fabricBrand');

const ROOT = path.join(__dirname, '..');
const FONT = path.join(ROOT, 'assets', 'themes', 'fabric', 'assets', 'fonts', 'arvo-normal-700.ttf');
const SWIFT = path.join(__dirname, 'render-fabric-icon.swift');
const ASSETS = path.join(ROOT, 'assets');
const ICONS = path.join(ASSETS, 'icons');
const SCRATCH = path.join(ROOT, '.cache');
const MASTER = 1024;

const PNG_SIZES = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512, 1024];

function run (cmd, args, opts) {
  const res = spawnSync(cmd, args, Object.assign({ encoding: 'utf8' }, opts || {}));
  if (res.status !== 0) {
    const err = (res.stderr || res.stdout || '').trim() || `${cmd} exited ${res.status}`;
    throw new Error(err);
  }
  return res;
}

function writeIco (entries, dest) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  let offset = 6 + 16 * count;
  const dirParts = [];
  for (const entry of entries) {
    const dir = Buffer.alloc(16);
    const w = entry.width >= 256 ? 0 : entry.width;
    const h = entry.height >= 256 ? 0 : entry.height;
    dir.writeUInt8(w, 0);
    dir.writeUInt8(h, 1);
    dir.writeUInt8(0, 2);
    dir.writeUInt8(0, 3);
    dir.writeUInt16LE(1, 4);
    dir.writeUInt16LE(32, 6);
    dir.writeUInt32LE(entry.png.length, 8);
    dir.writeUInt32LE(offset, 12);
    offset += entry.png.length;
    dirParts.push(dir);
  }
  fs.writeFileSync(dest, Buffer.concat([header, ...dirParts, ...entries.map((e) => e.png)]));
}

function copyFile (src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function buildIcns (pngBySize, dest) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const iconset = fs.mkdtempSync(path.join(SCRATCH, 'fabric-iconset-'));
  const map = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024]
  ];
  for (const [name, size] of map) {
    fs.copyFileSync(pngBySize[size], path.join(iconset, name));
  }
  const named = `${iconset}.iconset`;
  fs.renameSync(iconset, named);
  try {
    run('iconutil', ['-c', 'icns', named, '-o', dest]);
  } finally {
    fs.rmSync(named, { recursive: true, force: true });
  }
}

function main () {
  if (process.platform !== 'darwin') {
    throw new Error('npm run make:icons requires macOS (swift, sips, iconutil)');
  }
  if (!fs.existsSync(FONT)) {
    throw new Error('Arvo Bold TTF missing: ' + FONT);
  }
  fs.mkdirSync(ICONS, { recursive: true });

  const masterPng = path.join(ICONS, 'icon-1024.png');
  const svgOut = path.join(ASSETS, 'favicon.svg');
  const swiftBrand = [
    SWIFT,
    '--font', FONT,
    '--purple', FABRIC_BRAND_PURPLE,
    '--white', FABRIC_BRAND_FOREGROUND,
    '--letter', FABRIC_BRAND_LETTER
  ];
  run('swift', swiftBrand.concat([
    '--size', String(MASTER),
    '--png', masterPng,
    '--svg', svgOut
  ]));

  const letter32 = path.join(ICONS, 'icon-letter-32.png');
  const letter64 = path.join(ICONS, 'icon-letter-64.png');
  run('swift', swiftBrand.concat(['--transparent', '--size', '32', '--png', letter32]));
  run('swift', swiftBrand.concat(['--transparent', '--size', '64', '--png', letter64]));

  const pngBySize = { 1024: masterPng };
  for (const size of PNG_SIZES) {
    if (size === 1024) continue;
    const dest = path.join(ICONS, `icon-${size}.png`);
    run('sips', ['-z', String(size), String(size), masterPng, '--out', dest]);
    pngBySize[size] = dest;
  }
  copyFile(pngBySize[512], path.join(ICONS, 'icon.png'));
  copyFile(pngBySize[180], path.join(ASSETS, 'apple-touch-icon.png'));

  const icoPath = path.join(ASSETS, 'favicon.ico');
  writeIco(
    [16, 32, 48, 256].map((size) => ({
      width: size,
      height: size,
      png: fs.readFileSync(pngBySize[size])
    })),
    icoPath
  );

  const icnsPath = path.join(ICONS, 'icon.icns');
  buildIcns(pngBySize, icnsPath);

  const readme = [
    '# Fabric lettermark',
    '',
    'Serif lowercase **f** (Arvo Bold) in white on rich royal purple `' + FABRIC_BRAND_PURPLE + '`.',
    '',
    'Canonical generator: `npm run make:icons` (`scripts/render-fabric-icon.js`).',
    'Do not redraw this mark in downstream apps — copy these files.',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(ICONS, 'README.md'), readme);

  console.log('[fabric-icon] wrote', path.relative(ROOT, svgOut), 'and', PNG_SIZES.length, 'png sizes');
}

main();
