'use strict';

const App = require('./app');
const crypto = require('crypto');

class SPA extends App {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      name: '@fabric/web',
      language: 'en',
      handle: 'html'
    }, settings);
    return this;
  }

  register () {
    return this;
  }

  render () {
    let body = super.render();
    // TODO: cache and skip
    let hash = crypto.createHash('sha256').update(body).digest('hex');
    // TODO: define Custom Element
    // let app = SPA.toString('base64');
    // definition = customElements.define(name, SPA);

    // TODO: add integrity checks
    return `<!doctype HTML>
<html lang="${this.settings.language}">
  <head>
    <title>${this.settings.name} &middot; @fabric/web</title>
  </head>
  <body data-integrity="sha256:${hash}">${body}</body>
</html>`;
  }
}

module.exports = SPA;
