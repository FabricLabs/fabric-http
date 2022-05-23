'use strict';

const { JSDOM } = require('jsdom');
const fs = require('fs');

const Converter = require('showdown').Converter;
const Remote = require('@fabric/core/types/remote');

async function main () {
  const converter = new Converter({
    tables: true
  });

  const remote = new Remote({
    authority: 'raw.githubusercontent.com'
  });

  const result = await remote._GET('/satoshilabs/slips/master/slip-0044.md');
  const parsed = converter.makeHtml(result);

  const dom = new JSDOM(parsed);
  const rows = dom.window.document.querySelectorAll('table tr');

  const entries = [];
  const labels = [];

  for (const row of rows) {
    const headers = row.querySelectorAll('th');
    const cells = row.querySelectorAll('td');
    const entry = {};

    if (headers.length) {
      for (const header of headers) {
        labels.push(header.textContent);
      }
    }

    if (cells.length) {
      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];

        switch (label) {
          case 'Coin type':
            entry.type = cells[i].textContent;
            break;
          case 'Coin':
            entry.coin = cells[i].textContent;
            break;
          case "Path component (coin_type')":
            entry.path = cells[i].textContent;
            break;
          default:
            break;
        }
      }
    }

    if (entry.type && entry.coin) entries.push(entry);
  }

  fs.writeFileSync('./settings/slip-44.json', JSON.stringify(entries, null, '  '));

  return {
    content: entries
  };
}

main().catch((exception) => {
  console.error('[SCRIPTS:SLIP44]', 'Main Process Exception:', exception);
}).then((output) => {
  console.log('[SCRIPTS:SLIP44]', 'Main Process Output:', output);
});
