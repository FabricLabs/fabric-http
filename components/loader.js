'use strict';

const merge = require('lodash.merge');

/**
 * Loader web component that handles bundle retrieval and integrity checking
 */
class Loader extends HTMLElement {
  constructor (settings = {}) {
    super(settings);

    this.attachShadow({ mode: 'open' });

    // Default settings
    this.settings = merge({
      bundle: '/bundles/browser.min.js',
      timeout: 30000
    }, settings);

    // Initial state
    this._loading = true;
    this._error = null;
    this._bundle = null;
    this._html = null;

    // Create base structure
    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }

        fabric-loader {
          position: relative;
          min-height: 100px;
        }

        .dimmer {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.85);
          display: flex;
          align-items: center;
          justify-content: center;
          color: #fff;
        }

        .error {
          padding: 1em;
          margin: 1em 0;
          border: 1px solid #e0b4b4;
          border-radius: 0.28571429rem;
          background-color: #fff6f6;
          color: #9f3a38;
        }

        .error-header {
          font-weight: bold;
          margin-bottom: 0.5em;
        }
      </style>
      <fabric-loader>
        <div class="dimmer">Loading...</div>
      </fabric-loader>
    `;

    this._state = {
      content: this.settings.state
    }
  }

  static get observedAttributes () {
    return ['bundle'];
  }

  attributeChangedCallback (name, oldValue, newValue) {
    if (oldValue !== newValue) {
      this.settings[name] = newValue;
      if (name === 'bundle') {
        this._loadBundle();
      }
    }
  }

  connectedCallback () {
    this._loadBundle();
  }

  async _loadBundle () {
    if (!this.settings.bundle) {
      this._setError(new Error('No bundle URL provided'));
      return;
    }

    try {
      // First load the browser bundle
      const bundleResponse = await fetch(this.settings.bundle);
      const bundle = await bundleResponse.text();

      // Then load the initial HTML
      const htmlResponse = await fetch('/index.html');
      const html = await htmlResponse.text();

      this._loading = false;
      this._bundle = bundle;
      this._html = html;
      this._render();
    } catch (error) {
      this._setError(error);
    }
  }

  _setError (error) {
    this._loading = false;
    this._error = error;
    this._render();
  }

  _render () {
    const container = this.shadowRoot.querySelector('fabric-loader');

    if (this._loading) {
      container.innerHTML = `
        <div class="dimmer">Loading...</div>
      `;
      return;
    }

    if (this._error) {
      container.innerHTML = `
        <div class="error">
          <div class="error-header">Failed to load bundle</div>
          <p>${this._error.message}</p>
        </div>
      `;
      return;
    }

    if (!this._bundle || !this._html) {
      container.innerHTML = '';
      return;
    }

    // Insert HTML content
    container.innerHTML = this._html;
    
    // Execute the bundle
    const script = document.createElement('script');
    script.textContent = this._bundle;
    container.appendChild(script);
  }
}

// Register web component
customElements.define('fabric-loader', Loader);

module.exports = Loader;

