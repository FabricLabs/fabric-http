'use strict';

const fs = require('fs');
const crypto = require('crypto');
const beautify = require('js-beautify').html;

/**
 * Builder for {@link Fabric}-based applications.
 */
class Compiler {
  /**
   * 
   * @param {Object} [settings] Map of settings.
   * @param {Mixed} [settings.document] Document to use.
   */
  constructor (settings = {}) {
    this.settings = Object.assign({
      document: null
    }, settings);

    return this;
  }

  /**
   * Build a {@link String} representing the HTML-encoded Document.
   * @param {Mixed} data Input data to use for local rendering.
   * @returns {String} Rendered HTML document containing the compiled JavaScript application.
   */
  compile (data) {
    return this.settings.document.render();
  }

  compileTo (target) {
    console.log('[MAKI:ROLLER]', `Compiling SPA to ${target}...`);

    const html = this.compile();
    const clean = beautify(html, { indent_size: 2, extra_liners: [] });
    const hash = crypto.createHash('sha256').update(clean).digest('hex');

    try {
      fs.writeFileSync(target, clean);
    } catch (exception) {
      console.error('[MAKI:ROLLER]', 'Could not write SPA:', exception);
      return false;
    }

    console.log('[MAKI:ROLLER]', `${clean.length} bytes written to ${target} with sha256(H) = ${hash} ~`);

    return true;
  }
}

module.exports = Compiler;
