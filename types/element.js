'use strict';

class HTMLCustomElement extends HTMLElement {
  constructor (...$) {
    return super(...$).init();
  }

  /**
   * Initialize the element.  Use in place of constructor behavior.
   */
  init () {
    console.log('[FABRIC:ELEMENT]', 'Initializing...');
    return this;
  }
}

module.exports = HTMLCustomElement;
