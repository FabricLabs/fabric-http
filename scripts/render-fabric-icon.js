'use strict';

/**
 * Render the canonical Fabric lettermark (serif lowercase f) and copy it into
 * package `assets/` plus sibling app trees (Hub, GoonCitizen, goon.vc, Passport).
 *
 * Requires macOS (`swift`, `sips`, `iconutil`).
 *
 *   node scripts/render-fabric-icon.js
 *   node scripts/render-fabric-icon.js --no-sync
 */

const fs = require('fs');
const os = require('os');
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
  const iconset = fs.mkdtempSync(path.join(os.tmpdir(), 'fabric-iconset-'));
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

function syncDownstream (files) {
  const parent = path.join(ROOT, '..');
  const jobs = [
    {
      root: path.join(parent, 'hub.fabric.pub'),
      copies: [
        ['favicon.ico', 'assets/favicon.ico'],
        ['favicon.svg', 'assets/favicon.svg'],
        ['apple-touch-icon.png', 'assets/apple-touch-icon.png'],
        ['icons/icon.png', 'assets/icons/icon.png'],
        ['icons/icon-16.png', 'assets/icons/icon-16.png'],
        ['icons/icon-32.png', 'assets/icons/icon-32.png'],
        ['icons/icon-48.png', 'assets/icons/icon-48.png'],
        ['icons/icon-128.png', 'assets/icons/icon-128.png'],
        ['icons/icon-180.png', 'assets/icons/icon-180.png'],
        ['icons/icon-192.png', 'assets/icons/icon-192.png'],
        ['icons/icon-256.png', 'assets/icons/icon-256.png'],
        ['icons/icon-512.png', 'assets/icons/icon-512.png'],
        ['icons/icon-1024.png', 'assets/icons/icon-1024.png'],
        ['icons/icon-1024.png', 'build/icon.png'],
        ['favicon.ico', 'build/icon.ico'],
        ['icon.icns', 'build/icon.icns']
      ]
    },
    {
      root: path.join(parent, 'star-citizen-live'),
      copies: [
        ['favicon.ico', 'assets/favicon.ico'],
        ['favicon.svg', 'assets/favicon.svg'],
        ['apple-touch-icon.png', 'assets/apple-touch-icon.png'],
        ['icons/icon-512.png', 'assets/icon.png'],
        ['favicon.ico', 'assets/icon.ico'],
        ['icon.icns', 'assets/icon.icns'],
        ['icons/icon-32.png', 'assets/tray.png'],
        ['icon-letter-32.png', 'assets/trayTemplate.png'],
        ['icon-letter-64.png', 'assets/trayTemplate@2x.png'],
        ['favicon.ico', 'android-www/favicon.ico'],
        ['favicon.svg', 'android-www/favicon.svg'],
        ['apple-touch-icon.png', 'android-www/apple-touch-icon.png']
      ]
    },
    {
      root: path.join(parent, 'goon.vc'),
      copies: [
        ['favicon.ico', 'assets/favicon.ico'],
        ['favicon.svg', 'assets/favicon.svg'],
        ['apple-touch-icon.png', 'assets/apple-touch-icon.png']
      ]
    },
    {
      root: path.join(parent, 'fabric-browser-extension'),
      copies: [
        ['icons/icon-16.png', 'assets/icons/icon16.png'],
        ['icons/icon-24.png', 'assets/icons/icon24.png'],
        ['icons/icon-32.png', 'assets/icons/icon32.png'],
        ['icons/icon-48.png', 'assets/icons/icon48.png'],
        ['icons/icon-128.png', 'assets/icons/icon128.png'],
        ['icons/icon-192.png', 'assets/icons/icon192.png'],
        ['icons/icon-128.png', 'assets/icons/logo.png'],
        ['icons/icon-128.png', 'assets/icons/chrome-store-icon-128.png'],
        ['icons/icon-128.png', 'store/icons/icon-128.png'],
        ['icons/icon-512.png', 'store/icons/icon-512.png']
      ]
    }
  ];

  for (const job of jobs) {
    if (!fs.existsSync(job.root)) {
      console.log('[fabric-icon] skip missing', job.root);
      continue;
    }
    for (const [fromRel, toRel] of job.copies) {
      if (!files[fromRel]) {
        throw new Error('missing icon source ' + fromRel);
      }
      copyFile(files[fromRel], path.join(job.root, toRel));
    }
    if (path.basename(job.root) === 'star-citizen-live') {
      writeAndroidLaunchers(job.root, files['icons/icon-1024.png']);
    }
    console.log('[fabric-icon] synced', path.basename(job.root));
  }
}

function writeAndroidLaunchers (appRoot, masterPng) {
  const res = path.join(appRoot, 'android', 'app', 'src', 'main', 'res');
  if (!fs.existsSync(res)) {
    console.log('[fabric-icon] skip android launchers (no res/)');
    return;
  }
  const densities = [
    ['mipmap-mdpi', 48, 108],
    ['mipmap-hdpi', 72, 162],
    ['mipmap-xhdpi', 96, 216],
    ['mipmap-xxhdpi', 144, 324],
    ['mipmap-xxxhdpi', 192, 432]
  ];
  for (const [dir, launcher, foreground] of densities) {
    const folder = path.join(res, dir);
    fs.mkdirSync(folder, { recursive: true });
    const launcherPng = path.join(folder, 'ic_launcher.png');
    run('sips', ['-z', String(launcher), String(launcher), masterPng, '--out', launcherPng]);
    copyFile(launcherPng, path.join(folder, 'ic_launcher_round.png'));
    run('sips', ['-z', String(foreground), String(foreground), masterPng, '--out', path.join(folder, 'ic_launcher_foreground.png')]);
  }
  const colorXml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<resources>',
    `    <color name="ic_launcher_background">${FABRIC_BRAND_PURPLE}</color>`,
    '</resources>',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(res, 'values', 'ic_launcher_background.xml'), colorXml);
  const bgVector = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
    '    android:width="108dp"',
    '    android:height="108dp"',
    '    android:viewportWidth="108"',
    '    android:viewportHeight="108">',
    `    <path android:fillColor="${FABRIC_BRAND_PURPLE}" android:pathData="M0,0h108v108h-108z" />`,
    '</vector>',
    ''
  ].join('\n');
  fs.writeFileSync(path.join(res, 'drawable', 'ic_launcher_background.xml'), bgVector);
}

function main () {
  if (process.platform !== 'darwin') {
    throw new Error('npm run make:icons requires macOS (swift, sips, iconutil)');
  }
  const noSync = process.argv.includes('--no-sync');
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

  const files = {
    'favicon.ico': icoPath,
    'favicon.svg': svgOut,
    'apple-touch-icon.png': path.join(ASSETS, 'apple-touch-icon.png'),
    'icon.icns': icnsPath,
    'icons/icon.png': path.join(ICONS, 'icon.png'),
    'icons/icon-16.png': pngBySize[16],
    'icons/icon-24.png': pngBySize[24],
    'icons/icon-32.png': pngBySize[32],
    'icons/icon-48.png': pngBySize[48],
    'icons/icon-128.png': pngBySize[128],
    'icons/icon-180.png': pngBySize[180],
    'icons/icon-192.png': pngBySize[192],
    'icons/icon-256.png': pngBySize[256],
    'icons/icon-512.png': pngBySize[512],
    'icons/icon-1024.png': pngBySize[1024],
    'icon-letter-32.png': letter32,
    'icon-letter-64.png': letter64
  };

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

  if (!noSync) syncDownstream(files);
  console.log('[fabric-icon] wrote', path.relative(ROOT, svgOut), 'and', PNG_SIZES.length, 'png sizes');
}

main();
