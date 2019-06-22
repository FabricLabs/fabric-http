'use strict';

const {
  HTTP_SERVER_PORT,
  BROWSER_TARGET
} = require('../constants');

const page = require('page');
const crypto = require('crypto');
const pluralize = require('pluralize');
const beautify = require('js-beautify');
// const d3 = require('d3');

const Fabric = require('@fabric/core');
const Avatar = require('./avatar');
const Router = require('./router');
const Browser = require('./browser');
const Resource = require('./resource');
const Identity = require('./identity');
const Component = require('./component');
const Package = require('../package');

// TODO: move component imports to components/ or scripts/
const MakiIntroduction = require('../components/introduction');
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
      controls: true,
      language: 'en',
      namespace: 'maki',
      components: {
        index: 'maki-introduction'
      },
      identities: {},
      resources: {},
      peers: {},
      port: HTTP_SERVER_PORT,
      version: Package.version
    }, settings);

    this.menu = new Menu();
    this.types = new ResourceList();
    this.avatar = new Avatar();
    this.router = new Router();
    this.browser = new Browser(this.settings);
    this.target = null;

    this.secrets = new Fabric.Store({
      path: 'stores/secrets'
    });

    this.handler = page;
    this.circuit = this.settings.circuit || new Fabric.Circuit();

    // Add index menu item
    this.menu._addItem({ name: this.settings.name, path: '/', brand: true });
    this.router._addRoute('/', this.settings.components.index);
    this.handler('/', this._loadIndex.bind(this));

    // properties
    this.identities = {};
    this.peers = {};
    this.components = { ResourceList };
    this.resources = {};
    this.elements = {};
    this.routes = [];

    for (let name in this.settings.resources) {
      let definition = this.settings.resources[name];
      let plural = pluralize(name);

      this.define(name, definition);

      // this.router._addFlat(`/${plural.toLowerCase()}`, definition);
      this.router._addRoute(`/${plural.toLowerCase()}/:id`, definition.components.view);
      this.router._addRoute(`/${plural.toLowerCase()}`, definition.components.list);

      // add menu items & handler
      if (!definition.hidden) {
        this.menu._addItem({ name: plural, path: `/${plural.toLowerCase()}` });
      }

      // page.js router...
      this.handler(`/${plural.toLowerCase()}`, this._handleNavigation.bind(this));
      this.handler(`/${plural.toLowerCase()}/:id`, this._handleNavigation.bind(this));
    }

    // Some default Components, available to all
    // TODO: expose this as the Library, namespace `alexandria`
    this.define('Introduction', MakiIntroduction);

    this.route = '/';
    this.status = 'ready';

    return this;
  }

  get page () {
    return new Resource({
      name: 'BlankPage'
    });
  }

  get version () {
    return this.settings.version;
  }

  define (name, definition) {
    this.router.define(name, definition);
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

  _defineElement (handle, definition) {
    this.log('[MAKI:APP]', 'defining element:', handle, definition);

    this.components[handle] = definition;

    try {
      customElements.define(handle, definition);
    } catch (E) {
      console.error('[MAKI:APP]', 'Could not define Custom Element:', E, handle, definition);
    }
  }

  _verifyElements () {
    let elements = document.querySelectorAll('*[integrity]');
    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];
      let integrity = element.getAttribute('integrity');
      let valid = this._checkIntegrity(element.innerHTML, integrity);
      console.log('[MAKI:APP]', 'checking integrity:', 'element:', element);
      console.log('[MAKI:APP]', 'checking integrity:', 'innerHTML:', element.innerHTML);
      console.log('[MAKI:APP]', 'checking integrity:', 'valid', valid);
    }
  }

  _flush () {
    while (this.target.firstChild) {
      this.target.removeChild(this.target.firstChild);
    }
  }

  _appendElement (element) {
    this.target.appendChild(element);
    element.innerHTML = element._getInnerHTML();
    return this;
  }

  async _loadIndex (ctx) {
    let Index = this.components[this.settings.components.index];
    let resource = new Index(this.state);
    let content = resource.render();
    this._setTitle(resource.name);
    this._renderContent(content);
  }

  /**
   * Trigger navigation.
   * @param  {Context}   ctx  Navigating context.
   * @param  {Function} next Function called if no route found.
   * @return {Promise}       Resolved on routing complete.
   */
  async _handleNavigation (ctx, next) {
    console.log('[MAKI:APP]', 'handling navigation intent:', ctx);

    let self = this;
    let address = await self.browser.route(ctx.path);
    let sample = await self.browser.load(ctx.path);

    console.log('[MAKI:APP]', 'final testing:', sample);

    let element = document.createElement(address.route.component);

    if (address) {
      console.log('[MAKI:APP]', 'resolved address:', address);
      console.log('[MAKI:APP]', 'appending element:', element);
      console.log('[MAKI:APP]', 'self data:', self.state);

      for (let name in self.state) {
        element.state[name] = self.state[name];
      }

      /* self._GET(ctx.path).then(async function (x) {
        console.log('GOT DATA:', x);
        element._redraw(x);
      }, function (e) {
        console.error('WAT:', e);
      }); */

      self._setTitle(element.title);

      self.browser._setAddress(ctx.path);
      self.browser._setElement(element);

      self.target = element;
    }
  }

  async _restoreIdentity () {
    let identities = null;

    try {
      identities = await this.secrets._GET(`/identities`);
    } catch (E) {
      console.error('Could not load history:', E);
    }

    if (!identities || !identities.length) {
      return this._generateIdentity();
    }

    return new Identity(identities[0]);
  }

  async _generateIdentity () {
    let item = null;
    let result = null;
    let link = null;

    // TODO: async generation
    let key = new Fabric.Key();
    let struct = {
      name: prompt('What shall be your name?'),
      address: key.address,
      private: key.private.toString('hex'),
      public: key.public
    };

    let existing = await this._getIdentityByName(struct.name);
    console.log('existing check:', existing);

    if (!existing) {
      try {
        let id = await this.secrets._POST(`/identities`, struct);
        link = id;
      } catch (E) {
        console.error('broken:', E);
      }
    } else {
      link = existing;
    }

    // TODO: verify login here
    // TODO: encrypt local storage with password

    this.identities[struct.address] = struct;
    this.identity = struct;

    // TODO: remove public key from character, use only address (or direct hash)
    return {
      address: struct.address,
      public: struct.public
    };
  }

  async _getIdentityByName (name) {
    let candidates = Object.keys(this.identities).map((x) => {
      return this.identities[x];
    }).filter((x) => {
      return x.name === name;
    });

    console.log('candidates:', candidates);
    return candidates[0] || null;
  }

  _setTitle (title) {
    this.title = `${title} &middot; ${this.settings.name}`;
    document.querySelector('title').innerHTML = this.title;
  }

  _refresh () {
    let resource = new Fabric.Resource();
    this.target.innerHTML = this._loadHTML(resource.render());
    return this;
  }

  _renderContent (html) {
    if (!this.target) this.target = document.querySelectorAll(BROWSER_TARGET);
    if (!this.target) return console.log('COULD NOT ACQUIRE TARGET:', document);
    this.target.innerHTML = html;
    return this.target;
  }

  // TODO: write Purity-based version, use in production
  _loadHTML (html) {
    let blob = JSON.stringify(this.state, null, '  ');
    let verification = crypto.createHash('sha256').update(blob).digest('hex');
    return `<fabric-application route="${this.route}" integrity="${this.integrity}" class="window">
  <header>
    <fabric-grid-row id="menu">${this.menu.render()}</fabric-grid-row>
    <fabric-grid-row id="details" class="ui container" style="display: none;">
      <img src="${this.avatar.toDataURI()}" class="bordered" />
      <h1><a href="/">${this.settings.name}</a></h1>
      <p>${this.settings.synopsis}</p>
    </fabric-grid-row>
  </header>
  <fabric-grid-row id="browser" class="ui main container">${this.browser.render()}</fabric-grid-row>
  <footer>
    <fabric-grid-row class="ui inverted vertical footer segment">
      <div class="ui container">
        <h2>Debug Information</h2>
        <fabric-grid-row>
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
      </div>
    </fabric-grid-row>
    <!-- [0]: README [dot] md -->
    <!--
    # RPG \`@fabric/rpg\`
    ## STOP HERE AND READ ME FIRST!
    Before continuing, let us be the first to welcome you to THE SOURCE.  While it
    might be confusing at first, there's a lot you can learn if you make the time.

    Use this URI:
    https://www.roleplaygateway.com/

    From there, links like \`hub.roleplaygateway.com\` might "pop up" from time to
    time.  With a bit of navigating around, you can earn credit for your progress.

    - Continue: https://chat.roleplaygateway.com/
    - Offline: https://www.roleplaygateway.com/medals/beta-tester

    Remember: never be afraid to explore!  Curiosity might have killed the cat, but
    that's why he had nine lives.

    Good luck, have fun (\`gl;hf o/\`), and enjoy!

                                             — the RPG team
    -->
  </footer>
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
    let page = this.page.render();
    let html = this._loadHTML(page);
    let pretty = beautify.html(html, {
      indent_size: 2,
      extra_liners: []
    });

    return pretty;
  }

  /**
   * Launches any necessary processes and notifies the user on ready.
   * @return {Promise} Resolves on completion.
   */
  async start () {
    await this.define('FabricMenu', Menu);
    await this.define('ResourceList', ResourceList);

    for (let name in this.resources) {
      let definition = this.resources[name];
      if (definition.data) {
        await this.set(`/${definition.names.plural}`, definition.data);
      }
    }

    await this.commit();

    // await this.fabric.start();
    await this.circuit.start();
    await this.browser.start();
    await this.router.start();

    return true;
  }

  async stop () {
    await this.router.stop();
    await this.browser.stop();
    await this.circuit.stop();

    return true;
  }
}

module.exports = App;
