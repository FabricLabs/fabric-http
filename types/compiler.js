'use strict';

const fs = require('fs');

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
    let html = this.compile();
    console.log('html:', html);
    console.log('target:', target);
    fs.writeFileSync(target, html);
    console.log('wrote!');
    return true;
  }
}

module.exports = Compiler;
