'use strict';

const Fabric = require('@fabric/core');
const SPA = require('./spa');

/**
 * Maki makes building beautiful apps a breeze.
 * @type {Object}
 */
class Maki extends Fabric.Program {
  /**
   * Build a new application.
   * @param  {Object} [settings={}] Configuration for the Maki app.
   * @return {Maki}                 Instance of Maki.
   */
  constructor (settings = {}) {
    super(settings);
    this.spa = new SPA(settings);
    return this;
  }

  /**
   * Generate an HTML string representing the current state of the app.
   * @return {[type]} [description]
   */
  render () {
    return `<maki-application>
  <fabric-state><code>${JSON.stringify(this.state)}</code></fabric-state>
  <maki-canvas>${this.spa._renderWith('Hello, world!')}</maki-canvas>
</maki-application>`;
  }
}

module.exports = Maki;
