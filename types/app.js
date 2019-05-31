'use strict';

const {
  HTTP_SERVER_PORT
} = require('../constants');

const crypto = require('crypto');
const d3 = require('d3');

const Fabric = require('@fabric/core');
const Component = require('./component');
const Package = require('../package');

// TODO: move component imports to components/ or scripts/
const ResourceList = require('../components/resource-list');
const Menu = require('../components/menu');

/**
 * Applications can be deployed to the legacy web using {@link App}, a powerful
 * template for building modern web applications.
 * @extends Component
 */
class App extends Component {
  /**
   * Create a {@link Web} application.
   * @param  {Object} [settings={}] Application settings.
   * @param  {Object} [settings.resources] Map of {@link Resource} classes.
   * @return {App}               Instance of the application.
   */
  constructor (settings = {}) {
    super(settings);

    // settings
    this.settings = Object.assign({
      name: '@fabric/http',
      synopsis: 'HTTP, WebSockets, WebRTC, and more.',
      language: 'en',
      components: {},
      resources: {},
      port: HTTP_SERVER_PORT,
      version: Package.version
    }, settings);

    this.menu = new Menu();
    this.types = new ResourceList();
    this.circuit = this.settings.circuit || new Fabric.Circuit();

    // Add index menu item
    this.menu._addItem({ name: this.settings.name, path: '/', brand: true });

    // properties
    this.identities = {};
    this.components = { ResourceList };
    this.routes = {};

    if (this.settings.components.index) {
      this.components['Index'] = this.settings.components.index;
    } else {
      this.components['Index'] = this.prototype;
    }

    for (let name in this.settings.resources) {
      let definition = this.settings.resources[name];
      // TODO: use definition always?
      // need to check for ES6 class vs. passed Object from config
      if (definition.constructor) {
        console.log('definition.constructor:', definition.constructor.name);
        if (definition.constructor.name === 'Object') {
          this.types.state[name] = Component;
        } else {
          this.types.state[name] = definition;
        }
      }
    }

    console.log('types:', this.types);

    for (let name in this.types.state) {
      this.menu._addItem(this.types.state[name]);
    }

    this.resources = {};
    this.elements = {};

    this.route = '/';
    this.status = 'ready';

    return this;
  }

  get version () {
    return this.settings.version;
  }

  define (name, definition) {
    this.types.state[name] = definition;
    this.resources[name] = definition;
  }

  _route (path) {
    this.route = path;
  }

  _checkIntegrity (data, integrity) {
    let parts = integrity.split('-');
    let hash = crypto.createHash('sha256').update(data).digest('base64');
    return hash === parts[1];
  }

  _verifyElements () {
    let elements = document.querySelectorAll('*[integrity]');
    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];
      let integrity = element.getAttribute('integrity');
      let valid = this._checkIntegrity(element.innerHTML, integrity);
      console.log('element:', element);
      console.log('integrity check:', valid);
    }
  }

  async _generateIdentity () {
    let item = null;
    let result = null;

    // TODO: async generation
    let key = new Fabric.Key();
    let struct = {
      name: prompt('What shall be your name?'),
      address: key.address,
      private: key.private.toString('hex'),
      public: key.public
    };

    try {
      item = await this._POST(`/identities`, struct);
      result = await this._GET(item);
    } catch (E) {
      console.error('broken:', E);
    }

    this.identities[struct.address] = struct;
    this.identity = struct;

    // TODO: remove public key from character, use only address (or direct hash)
    return {
      address: struct.address,
      public: struct.public
    };
  }

  async _toggleFullscreen () {
    // TODO: implement fullscreen from RPG
  }

  /**
   * Generate the rendered HTML output of the application's user interface.
   * @return {String} HTML string.
   */
  render () {
    if (this.settings.components.index) {
      this.elements['Index'] = new this.components['Index'](this.settings);
      return this.elements['Index'].render();
    }

    return `<fabric-application route="${this.route}" integrity="${this.integrity}">
  <fabric-grid>
    <fabric-grid-row id="menu">${this.menu.render()}</fabric-grid-row>
    <fabric-grid-row id="details" class="ui container">
      <h1><a href="/">${this.settings.name}</a></h1>
      <p>${this.settings.synopsis}</p>
      <fabric-channel></fabric-channel>
      <nav data-bind="controls">
        <button data-action="_generateIdentity" class="ui button">create new identity</button>
        <button data-action="_toggleFullscreen" class="ui button">fullscreen</button>
      </nav>
      <div>
        <p><code>Version:</code> <code>${this.settings.version}</code></p>
        <p><code>Tick:</code> <code data-bind="/tick">${this.state.tick}</code></p>
        <p><strong>Source:</strong> <a href="https://github.com/FabricLabs/web">fabric:github.com/FabricLabs/web</a>
      </div>
    </fabric-grid-row>
    <fabric-grid-row id="settings" class="ui container">
      <h3>Settings</h3>
      <application-settings type="application/json"><code>${JSON.stringify(this.settings, null, '  ')}</code></application-settings>
      <h3>Resources</h3>
      ${this.types.render()}
      <h3>Circuit</h3>
      ${this.circuit.render()}
      <h3>State</h3>
      <pre><code>${JSON.stringify(this.state, null, '  ')}</code></pre>
    </fabric-grid-row>
    <fabric-grid-row id="router" class="ui container">
      <fabric-router></fabric-router>
    </fabric-grid-row>
    <fabric-grid-row id="content" class="ui container">
      <noscript>
        <h3>JavaScript Renderer Available</h3>
        <p>If you're reading this, you should consider enabling JavaScript for full effect.</p>
      </noscript>
      <fabric-column id="canvas">
          <fabric-canvas></fabric-canvas>
      </fabric-column>
      <fabric-column id="peers">
        <fabric-peer-list></fabric-peer-list>
      </fabric-column>
    </fabric-grid-row>
  </fabric-grid>
  <script type="text/javascript" src="/scripts/index.min.js" defer></script>
</fabric-application>`;
  }

  /**
   * Launches any necessary processes and notifies the user on ready.
   * @return {Promise} Resolves on completion.
   */
  async start () {
    await this.define('FabricMenu', Menu);
    await this.define('ResourceList', ResourceList);

    // await this.fabric.start();
    await this.circuit.start();

    return true;
  }
}

module.exports = App;
