'use strict';

const Fabric = require('@fabric/core');
const Component = require('./component');

const ResourceList = require('../components/resource-list');

class App extends Component {
  constructor (settings = {}) {
    super(settings);

    // settings
    this.settings = Object.assign({
      resources: {}
    }, settings);

    // fabric
    this.fabric = new Fabric();
    this.types = new ResourceList();

    // properties
    this.components = { ResourceList };
    this.resources = {};
    this.elements = {};

    this.route = '/';
    this.status = 'ready';

    return this;
  }

  define (name, definition) {
    this.types.state[name] = definition;
    this.resources[name] = definition;
  }

  _route (path) {
    this.route = path;
  }

  render () {
    console.log('rendering:', this);
    return `<fabric-application route="${this.route}">
  <fabric-grid>
    <fabric-grid-row id="details">
      <h1>${this.settings.name}</h1>
      <fabric-channel></fabric-channel>
    </fabric-grid-row>
    <fabric-grid-row id="settings">
      <h3>Settings</h3>
      <application-settings type="application/json"><code>${JSON.stringify(this.settings)}</code></application-settings>
      <h3>Resources</h3>
      ${this.types.render()}
    </fabric-grid-row>
    <fabric-grid-row id="router">
      <fabric-router></fabric-router>
    </fabric-grid-row>
    <fabric-grid-row id="content">
      <fabric-column id="canvas">
          <fabric-canvas></fabric-canvas>
      </fabric-column>
      <fabric-column id="peers">
        <fabric-peer-list></fabric-peer-list>
      </fabric-column>
    </fabric-grid-row>
  </fabric-grid>
</fabric-application>`;
  }

  async start () {
    await this.define('ResourceList', ResourceList);

    await this.fabric.start();
    return true;
  }
}

module.exports = App;
