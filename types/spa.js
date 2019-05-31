'use strict';


const App = require('./app');
const page = require('page');
const crypto = require('crypto');

/**
 * Fully-managed HTML application.
 * @extends App
 */
class SPA extends App {
  /**
   * Create a single-page app.
   * @param  {Object} [settings={}] Settings for the application.
   * @param  {String} [settings.name="@fabric/maki"] Name of the app.
   * @param  {Boolean} [settings.offline=true] Hint offline mode to browsers.
   * @return {App}               Instance of the application.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: '@fabric/maki',
      synopsis: 'Making beautiful apps a breeze.',
      handle: 'html',
      language: 'en',
      components: {},
      offline: false
    }, settings);

    // TODO: enable Web Worker integration
    /* this.worker = new Worker('./worker', {
      type: 'module'
    }); */

    this.routes = [];

    return this;
  }

  register () {
    return this;
  }

  route (path) {
    for (let i = 0; i < this.routes.length; i++) {
      
    }
  }

  _renderWith (html) {
    let hash = crypto.createHash('sha256').update(html).digest('hex');

    return `<!DOCTYPE html>
<html lang="${this.settings.language}"${(this.settings.offline) ? 'manifest="cache.manifest"' : ''}>
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <title>${this.settings.synopsis} &middot; ${this.settings.name}</title>
  <link rel="manifest" href="/assets/manifest.json">
  <link rel="stylesheet" type="text/css" href="/styles/screen.css" />
  <link rel="stylesheet" type="text/css" href="/styles/semantic.css" />
</head>
<body data-bind="${hash}">${html}</body>
</html>`;
  }

  /**
   * Return a string of HTML for the application.
   * @return {String} Fully-rendered HTML document.
   */
  render () {
    let body = super.render();
    // TODO: define Custom Element
    // let app = SPA.toString('base64');
    // definition = customElements.define(name, SPA);

    return this._renderWith(body);
  }
}

module.exports = SPA;
