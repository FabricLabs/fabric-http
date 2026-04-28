'use strict';

/**
 * Fetch Arvo latin .woff2 from Google’s static hosts into
 * `libraries/fomantic/src/themes/fabric/assets/fonts/`. Then `npm run build:semantic` to bake into `assets/`.
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const root = process.env.FABRIC_HTTP
  ? path.resolve(process.env.FABRIC_HTTP)
  : path.join(__dirname, '..');
const fontDir = path.join(
  root, 'libraries', 'fomantic', 'src', 'themes', 'fabric', 'assets', 'fonts'
);
const fomanticTheme = path.join(root, 'libraries', 'fomantic', 'src', 'themes', 'fabric');

const ARVO_WOFF2 = [
  ['arvo-normal-400.woff2', 'https://fonts.gstatic.com/s/arvo/v23/tDbD2oWUg0MKqScQ7Q.woff2'],
  ['arvo-normal-700.woff2', 'https://fonts.gstatic.com/s/arvo/v23/tDbM2oWUg0MKoZw1-LPK8w.woff2'],
  ['arvo-italic-400.woff2', 'https://fonts.gstatic.com/s/arvo/v23/tDbN2oWUg0MKqSIg75Tv.woff2'],
  ['arvo-italic-700.woff2', 'https://fonts.gstatic.com/s/arvo/v23/tDbO2oWUg0MKqSIoVLH68dr_.woff2']
];

function downloadFile (url, filepath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(filepath);
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' } }, (response) => {
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(filepath, () => {});
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(filepath, () => {});
      reject(err);
    });
  });
}

async function main () {
  if (!fs.existsSync(fomanticTheme)) {
    console.error(
      '[download-fonts] Expected',
      fomanticTheme,
      '— use a full fabric-http clone (libraries/fomantic) or set FABRIC_HTTP to one.'
    );
    process.exit(1);
  }
  fs.mkdirSync(fontDir, { recursive: true });
  for (const [filename, url] of ARVO_WOFF2) {
    const filepath = path.join(fontDir, filename);
    process.stdout.write(`Downloading ${filename}... `);
    try {
      await downloadFile(url, filepath);
      console.log('ok');
    } catch (err) {
      console.error(err.message || err);
    }
  }
  console.log('Then: npm run build:semantic');
}

main().catch(console.error);
