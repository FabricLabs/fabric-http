'use strict';

/**
 * Regenerate settings/slip-44.json from SatoshiLabs SLIP-0044.
 *
 * Source is pinned to a git commit (not `master`) so regenerations are
 * reproducible:
 *   https://github.com/satoshilabs/slips/commit/a8f4330a9f7c982edc78581890579f921d4a055e
 */

const { JSDOM } = require('jsdom');
const fs = require('fs');

const { marked } = require('marked');
const Remote = require('@fabric/core/types/remote');

/** Pinned satoshilabs/slips commit for slip-0044.md */
const SLIP_0044_COMMIT = 'a8f4330a9f7c982edc78581890579f921d4a055e';
const SLIP_0044_PATH = `/satoshilabs/slips/${SLIP_0044_COMMIT}/slip-0044.md`;

function cellText (cell) {
  return String(cell.textContent || '').replace(/\s+/g, ' ').trim();
}

async function main () {
  // marked replaces showdown (CVE-2024-1899 / GHSA-rmmh-p597-ppvv; no showdown patch).
  marked.setOptions({ gfm: true, breaks: false });

  const remote = new Remote({
    authority: 'raw.githubusercontent.com'
  });

  const result = await remote._GET(SLIP_0044_PATH);
  const parsed = marked.parse(typeof result === 'string' ? result : String(result));

  const dom = new JSDOM(parsed);
  const rows = dom.window.document.querySelectorAll('table tr');

  const entries = [];
  let labels = [];

  for (const row of rows) {
    const headers = row.querySelectorAll('th');
    const cells = row.querySelectorAll('td');

    if (headers.length) {
      labels = Array.from(headers).map((h) => cellText(h).toLowerCase());
      continue;
    }

    if (!cells.length) continue;

    // Some marked builds emit header as the first <td> row.
    if (!labels.length) {
      labels = Array.from(cells).map((c) => cellText(c).toLowerCase());
      continue;
    }

    const cols = Array.from(cells).map(cellText);
    const byLabel = {};
    for (let i = 0; i < labels.length; i++) {
      byLabel[labels[i]] = cols[i] != null ? cols[i] : '';
    }

    // Historic columns: "Coin type" / "Path component (coin_type')" / "Coin"
    // Current SLIP table: "index" / "hexa" / "symbol" / "coin"
    const type = byLabel['coin type'] || byLabel.index || byLabel['#'] || '';
    const path = byLabel["path component (coin_type')"] || byLabel.hexa || byLabel.path || '';
    let coin = byLabel.coin || '';
    if (!type || !coin) continue;

    entries.push({ type, path, coin });
  }

  if (!entries.length) {
    throw new Error(`No SLIP-0044 rows parsed from ${SLIP_0044_PATH}`);
  }

  // Fail closed before overwrite: expect a dense coin table with stable column shapes.
  const MIN_SLIP_0044_ROWS = 100;
  if (entries.length < MIN_SLIP_0044_ROWS) {
    throw new Error(
      `SLIP-0044 parse too sparse (${entries.length} rows; need >= ${MIN_SLIP_0044_ROWS}) from ${SLIP_0044_PATH}`
    );
  }
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i];
    if (!row || typeof row !== 'object') {
      throw new Error(`SLIP-0044 row ${i}: missing object`);
    }
    const type = String(row.type || '').trim();
    const path = String(row.path || '').trim();
    const coin = String(row.coin || '').trim();
    if (!/^\d+$/.test(type)) {
      throw new Error(`SLIP-0044 row ${i}: type must be decimal index (got ${JSON.stringify(row.type)})`);
    }
    if (!path) {
      throw new Error(`SLIP-0044 row ${i}: path/hexa required`);
    }
    if (!coin) {
      throw new Error(`SLIP-0044 row ${i}: coin name required`);
    }
  }

  fs.writeFileSync('./settings/slip-44.json', JSON.stringify(entries, null, '  ') + '\n');

  return {
    sourceCommit: SLIP_0044_COMMIT,
    count: entries.length,
    content: entries.slice(0, 3)
  };
}

main().catch((exception) => {
  console.error('[SCRIPTS:SLIP44]', 'Main Process Exception:', exception);
  process.exitCode = 1;
}).then((output) => {
  if (output) console.log('[SCRIPTS:SLIP44]', 'Main Process Output:', output);
});
