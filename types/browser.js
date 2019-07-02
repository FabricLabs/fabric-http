'use strict';

// TODO: move to @fabric/core/types/service
const pluralize = require('pluralize');
const pointer = require('json-pointer');

const {
  BROWSER_TARGET
} = require('../constants');

const Fabric = require('@fabric/core');
const Router = require('./router');
const BrowserContent = require('../components/browser-content');
const Introduction = require('../components/introduction');
const SearchBox = require('../components/search-box');

class Browser extends Fabric.Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: '@fabric/browser',
      path: 'stores/browser',
      width: 640,
      height: 480,
      depth: 5,
      handle: 'fabric-browser',
      controls: false,
      components: {
        index: 'fabric-introduction'
      }
    }, settings);

    this.address = '/'; // start page
    this.introduction = new Introduction(this.settings);
    // TODO: move to @fabric/core/types/service
    this.router = new Router(this.settings);
    this.searchbox = new SearchBox(this.settings);
    this.target = null;

    // TODO: move to @fabric/core/types/service
    for (let name in this.settings.resources) {
      let definition = this.settings.resources[name];
      let plural = pluralize(name);

      // this.router._addFlat(`/${plural.toLowerCase()}`, definition);
      this.router._addRoute(`/${plural.toLowerCase()}/:id`, definition.components.view);
      this.router._addRoute(`/${plural.toLowerCase()}`, definition.components.list);
    }

    this.router._addRoute(`/`, this.settings.components.index);

    return this;
  }

  load (path) {
    if (!path) path = this.address;

    console.log('[FABRIC:BROWSER]', 'Loading:', path);

    let self = this;
    let route = this.route(path);

    console.log('loaded path:', path, route);
    let element = document.createElement(route.route.component);

    self._GET(path).then(async function _applyToTarget (x) {
      console.log('[FABRIC:BROWSER]', 'GOT DATA:', x);
      console.log('[FABRIC:BROWSER]', 'element is:', element);

      element.state = {};

      pointer.set(element.state, path, x);

      self._setElement(element);
    }, function (e) {
      console.error('[FABRIC:BROWSER]', 'WAT:', e);
    });

    self._setElement(element);

    return self.innerHTML;
  }

  route (path) {
    if (!path) path = '/';
    return this.router.route(path);
  }

  _redraw () {
    console.log('[FABRIC:BROWSER]', `redrawing ${this.address} with state:`, this.state);
    this.innerHTML = this._getInnerHTML(this.state);
    console.log('this innerHTML', this.innerHTML);
    return this;
  }

  _flush () {
    if (!this.target) return true;

    while (this.target.firstChild) {
      this.target.removeChild(this.target.firstChild);
    }

    return true;
  }

  _appendElement (element) {
    console.log('[FABRIC:BROWSER]', 'appending element:', element);
    if (!this.target) this.target = document.querySelector(BROWSER_TARGET);
    if (!this.target) return false;

    this.target.appendChild(element);
    element.innerHTML = element._getInnerHTML();

    return this;
  }

  _setAddress (path) {
    this.address = path;
  }

  _setElement (element) {
    console.log('[FABRIC:BROWSER]', 'setting element:', element);

    this._flush();
    this._appendElement(element);

    return this;
  }

  _setTitle (title) {
    this.title = `${title} &middot; ${this.settings.name}`;
    document.querySelector('title').innerHTML = this.title;
  }

  _getInnerHTML () {
    let content = new BrowserContent();
    let html = `<fabric-grid rows="3" columns="3">`;

    if (this.settings.controls) {
      html += `<fabric-grid-row>
  <div class="ui left attached icon buttons">
    <button data-action="_navigateBack" class="ui button" title="back"><i class="icon left chevron"></i></button>
    <button data-action="_navigateForward" class="ui button" title="forward" disabled><i class="icon right chevron"></i></button>
  </div>
  <div class="ui search input">
    <input type="text" name="address" value="${this.address || ''}" class="prompt" />
  </div>
  <div class="ui right attached icon buttons">
    <button data-action="_reloadContent" class="ui button" title="refresh"><i class="icon refresh"></i></button>
  </div>
  <button data-action="_saveToLibrary" class="ui button" title="save"><i class="icon star"></i></button>
</fabric-grid-row>`;
    }

    // html += `<fabric-browser-content id="browser-content">dummy content... ${JSON.stringify(this.router.route(this.address).route)}</fabric-browser-content>`;
    html += content.render();

    html += `</fabric-grid>`;

    return html;
  }

  render () {
    /* A 3-panel design for the Fabric Browser
      In addition to the primary content pane, 2 optional panels are present
      for both the vertical and horizontal axes.  In some interfaces, these may
      be displayed by default, such as lists of users or other menus.

      ### General Grid Design
      ############################################
      #         #                     #          #
      #         #                     #          #
      #         #                     #          #
      ############################################
      #         #                     #          #
      #         #                     #          #
      #         #                     #          #
      ############################################
      #         #                     #          #
      #         #                     #          #
      #         #                     #          #
      ############################################

      ### Compiling for Other Platforms
      While Maki might target the Web, Fabric targets a wider audience.  For
      example, `npm run cli` in the `@fabric/core` repository will compile this
      interface into an ncurses-style GUI for the terminal, suitable for network
      operators and systems administrators.

      Remember: if you don't like it, don't be afraid to change it!
     */

    let html = `<fabric-browser address="${this.address}">${this._getInnerHTML()}</fabric-browser>`;

    return html;
  }

  async start () {
    await super.start();
    await this.router.start();
    return this;
  }

  async stop () {
    await this.router.stop();
    await super.stop();
    return this;
  }
}

module.exports = Browser;
