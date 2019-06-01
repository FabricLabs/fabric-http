'use strict';

const {
  HTTP_SERVER_PORT
} = require('../constants');

const page = require('page');
const crypto = require('crypto');
const pluralize = require('pluralize');
const d3 = require('d3');

const Fabric = require('@fabric/core');
const Avatar = require('./avatar');
const Router = require('./router');
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

    console.log('[FABRIC:HTTP]', 'creating new APP with:', settings);

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
    this.avatar = new Avatar();
    this.router = new Router();
    this.handler = page;
    this.circuit = this.settings.circuit || new Fabric.Circuit();

    // Add index menu item
    this.menu._addItem({ name: this.settings.name, path: '/', brand: true });
    this.handler('/', this._refresh.bind(this));

    this._addHandler('_loadIndex', function () {
      console.log('loaded index (fake for fsm)');
    });

    // properties
    this.identities = {};
    this.components = { ResourceList };
    this.routes = [];

    if (this.settings.components.index) {
      this.components['Index'] = this.settings.components.index;
    } else {
      this.components['Index'] = this.prototype;
    }

    for (let name in this.settings.resources) {
      let definition = this.settings.resources[name];
      let plural = pluralize(name);

      // TODO: use Fabric.Resource here
      this.router._addFlat(`/${plural.toLowerCase()}`, definition);
      this._addRoute({ name: plural, path: `/${plural.toLowerCase()}` });
      this.menu._addItem({ name: plural, path: `/${plural.toLowerCase()}` });
      this.handler(`/${plural.toLowerCase()}`, this._handleNavigation.bind(this));

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

    this.resources = {};
    this.elements = {};

    this.route = '/';
    this.status = 'ready';

    return this;
  }

  get page () {
    return new Fabric.Resource({
      name: 'BlankPage'
    });
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

  _addRoute (definition) {
    this.routes.push(definition);
  }

  _addHandler (name, method) {
    this.circuit.methods[name] = method;
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

  async _handleNavigation (ctx, next) {
    console.log('handling navigation intent:', ctx);
    let definition = await this.router._route(ctx.path);
    let resource = new Fabric.Resource(definition);
    let content = resource.render();
    this._renderContent(content);
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

  _refresh () {
    let element = document.querySelector('#content');
    let resource = new Fabric.Resource();
    element.innerHTML = this._loadHTML(resource.render());
    return this;
  }

  _renderContent (html) {
    let element = document.querySelector('#content');
    element.innerHTML = html;
    return element;
  }

  _loadHTML (html) {
    let blob = JSON.stringify(this.state, null, '  ');
    let verification = crypto.createHash('sha256').update(blob).digest('hex');
    return `<fabric-application route="${this.route}" integrity="${this.integrity}">
  <fabric-grid>
    <fabric-grid-row id="menu">${this.menu.render()}</fabric-grid-row>
    <fabric-grid-row id="details" class="ui container">
      <img src="${this.avatar.toDataURI()}" class="bordered" />
      <h1><a href="/">${this.settings.name}</a></h1>
      <p>${this.settings.synopsis}</p>
      <fabric-channel></fabric-channel>
      <nav data-bind="controls">
        <button data-action="_generateIdentity" class="ui button">create new identity</button>
        <button data-action="_toggleFullscreen" class="ui button">fullscreen</button>
      </nav>
      <div>
        <p><code>Version:</code> <code>${this.settings.version}</code></p>
        <p><code>Clock:</code> <code data-bind="/clock">${this.state.clock}</code></p>
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
      <h3>State <small><code>${verification}</code></small></h3>
      <pre><code>${blob}</code></pre>
    </fabric-grid-row>
    <fabric-grid-row id="router" class="ui container">
      <fabric-router>
        <fabric-grid-row>
          <input type="text" name="address" value="${this.path}" />
        </fabric-grid-row>
        <fabric-grid-row id="content">${html}</fabric-grid-row>
      </fabric-router>
    </fabric-grid-row>
    <fabric-grid-row id="composite" class="ui container">
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
  <!-- [0]: README [dot] md -->
  <!--
  > # RPG \`@fabric/rpg\`
  > ## STOP HERE AND READ ME FIRST!
  > Before continuing, let us be the first to welcome you to the Source.  While it
  > might be confusing at first, there's a lot you can learn if you make the time.
  > Use this URI:
  > > https://www.roleplaygateway.com/
  > From there, links like \`hub.roleplaygateway.com\` might "pop up" from time to
  > time.  With a bit of navigating around, you can earn credit for your progress.
  > Continue:
  > > https://chat.roleplaygateway.com/
  > Offline:
  > > https://www.roleplaygateway.com/medals/beta-tester
  > Remember: never be afraid to explore!  Curiosity might have killed the cat, but
  > that's why he had nine lives.
  > Good luck, have fun (\`gl;hf o/\`), and enjoy!
  >                                          — the RPG team
  -->
  <script type="text/javascript" src="/scripts/index.min.js" defer></script>
</fabric-application>`;
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

    let page = this.page.render();
    let html = this._loadHTML(page);

    return html;
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
    await this.router.start();

    return true;
  }
}

module.exports = App;
