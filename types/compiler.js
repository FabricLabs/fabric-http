'use strict';

const fs = require('fs');
const crypto = require('crypto');
const beautify = require('js-beautify').html;

class Compiler {
  constructor (settings = {}) {
    this.settings = Object.assign({
      document: settings.document
    }, settings);

    return this;
  }

  compile (data) {
    return this.settings.document.render();
  }

  compileTo (target) {
    console.log('[MAKI:ROLLER]', `Compiling SPA to ${target}...`);

    let html = this.compile();
    let clean = beautify(html, {
      indent_size: 2,
      extra_liners: []
    });
    let hash = crypto.createHash('sha256').update(clean).digest('hex');

    try {
      fs.writeFileSync(target, clean);
    } catch (E) {
      console.error('[MAKI:ROLLER]', 'Could not write SPA:', E);
    }

    console.log('[MAKI:ROLLER]', `${clean.length} bytes written to ${target} with sha256(H) = ${hash} ~`);

    return true;
  }
}

module.exports = Compiler;
