'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const beautify = require('js-beautify').html;
const webpack = require('webpack');

const Service = require('@fabric/core/types/service');
const FabricComponent = require('./component');

/**
 * Builder for {@link Fabric}-based applications.
 */
class Compiler extends Service {
  /**
   * Create an instance of the compiler.
   * @param {Object} [settings] Map of settings.
   * @param {FabricComponent} [settings.document] Document to use.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      document: new FabricComponent(settings),
      state: {},
      // TODO: load from:
      // 1. webpack.config.js (local)
      // 2. @fabric/http/webpack.config
      webpack: {
        mode: 'development',
        entry: path.resolve('./scripts/browser.js'),
        target: 'web',
        output: {
          path: path.resolve('./assets/bundles'),
          filename: 'browser.js'
        },
        devtool: 'inline-source-map',
        module: {
          rules: [
            {
              test: /\.(js)$/,
              exclude: /node_modules/,
              use: ['babel-loader']
            },
            {
              test: /\.css$/,
              use: [
                {
                  loader: 'style-loader'
                },
                {
                  loader: 'css-loader',
                  options: {
                    modules: true,
                    sourceMap: true
                  }
                }
              ]
            }
          ]
        },
        plugins: [
          new webpack.DefinePlugin({
            'process.env': {
              NODE_ENV: JSON.stringify('production'),
              APP_ENV: JSON.stringify('browser')
            }
          })
        ]
      }
    }, this.settings, settings);

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
    return this.settings.document.render(state);
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
    const html = this.compileHTML(this.state);
    const hash = crypto.createHash('sha256').update(html).digest('hex');

    // Write HTML to disk
    try {
      fs.writeFileSync(target, html);
    } catch (exception) {
      console.error('[HTTP:COMPILER]', 'Could not write HTML:', exception);
      return false;
    }

    console.log('[MAKI:ROLLER]', `${html.length} bytes written to ${target} with sha256(H) = ${hash} ~`);
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
