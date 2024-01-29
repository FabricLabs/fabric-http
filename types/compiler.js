'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const beautify = require('js-beautify').html;
const webpack = require('webpack');
const merge = require('lodash.merge');
const { JSDOM } = require('jsdom');

const dom = new JSDOM();

global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.HTMLElement;

// Fabric Types
const Service = require('@fabric/core/types/service');

// Types
const HTTPComponent = require('./component');
const HTTPSite = require('./site');

/**
 * Builder for {@link Fabric}-based applications.
 */
class Compiler extends Service {
  /**
   * Create an instance of the compiler.
   * @param {Object} [settings] Map of settings.
   * @param {HTTPComponent} [settings.document] Document to use.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = merge({
      document: settings.document || new HTTPComponent(settings),
      site: {
        name: 'Default Fabric Application'
      },
      state: {
        title: settings.title || 'Fabric HTTP Document'
      },
      // TODO: load from:
      // 1. webpack.config.js (local)
      // 2. @fabric/http/webpack.config
      webpack: {
        mode: 'production',
        entry: path.resolve('./scripts/browser.js'),
        experiments: {
          asyncWebAssembly: true
        },
        resolve: {
          fallback: {
            crypto: require.resolve('crypto-browserify'),
            stream: require.resolve('stream-browserify'),
            querystring: require.resolve('querystring-es3'),
            path: require.resolve('path-browserify'),
            assert: require.resolve('assert-browserify'),
            util: require.resolve('node-util'),
            fs: require.resolve('browserify-fs')
          },
          symlinks: false
        },
        target: 'web',
        output: {
          path: path.resolve('./assets/bundles'),
          filename: 'browser.min.js'
        },
        module: {
          rules: [
            {
              test: /\.(js)$/,
              use: ['babel-loader']
            },
            {
              test: /\.css$/,
              use: ['style-loader', 'css-loader']
            }
          ]
        },
        plugins: [
          new webpack.DefinePlugin({
            'process.env': JSON.stringify(process.env)
          }),
          new webpack.ProvidePlugin({
            Buffer: ['buffer', 'Buffer'],
          }),
        ],
        watch: false
      }
    }, settings);

    this.component = this.settings.document || null;
    this.site = new HTTPSite(this.settings.site);

    this._state = {
      content: this.settings.state
    };

    this.packer = webpack(this.settings.webpack);

    return this;
  }

  /**
   * Build a {@link String} representing the HTML-encoded Document.
   * @param {Mixed} [data] Input data to use for local rendering.
   * @returns {String} Rendered HTML document containing the compiled JavaScript application.
   */
  compile (state = this.state) {
    // Default case: no component provided, or not a Fabric Component
    if (!this.component || !this.component._getHTML) {
      return this.site.render(state);
    } else {
      const html = this.component._getHTML(state);
      return this.site._renderWith(html);
    }
  }

  async compileBundle (state = this.state) {
    return new Promise((resolve, reject) => {
      // TODO: consider creating compiler on the fly as to enable the
      // definition of Webpack's settings at runtime
      this.packer.run((err, res) => {
        if (err) return reject(err);
        resolve(res);
      });
    });
  }

  async compileHTML (state = this.state) {
    // Create browser bundle
    const bundle = await this.compileBundle(state);
    const html = this.compile({
      bundle: {
        fullhash: bundle.fullhash
      },
      state: state
    });

    // Cleanup output
    const output = beautify(html, { indent_size: 2, extra_liners: [] });
    return output;
  }

  async compileTo (target = 'assets/index.html') {
    return this._compileToFile(target);
  }

  /**
   * Compiles a Fabric component to an HTML document.
   * @param {String} target Path to output HTML.
   * @returns {Boolean} True if the build succeeded, false if it did not.
   */
  async _compileToFile (target = 'assets/index.html') {
    console.log('[HTTP:COMPILER]', `Compiling Fabric Component to HTML at ${target}...`);

    // Create HTML document
    const html = await this.compileHTML(this.state);
    const hash = crypto.createHash('sha256').update(html, 'utf8').digest('hex');

    // Write HTML to disk
    try {
      fs.writeFileSync(target, html);
    } catch (exception) {
      console.error('[HTTP:COMPILER]', 'Could not write HTML:', exception);
      return false;
    }

    console.log('[HTTP:COMPILER]', `${html.length} bytes written to ${target} with sha256(H) = ${hash} ~`);
    return true;
  }

  async compileToFile (target = 'assets/index.html') {
    const success = await this.compileTo(target);
    if (!success) {
      this.emit('error', `Could not write file: ${target}`);
    } else {
      this.state.status = 'FINISHED';
      this.commit();
      this.emit('log', `Compilation finished: ${target} [${this.id}]`);
    }

    return this;
  }
}

module.exports = Compiler;
