'use strict';

const Fabric = require('@fabric/core');
const Introduction = require('../components/introduction');

class Browser extends Fabric.Service {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      path: 'stores/browser',
      width: 640,
      height: 480,
      handle: 'fabric-browser',
      controls: false
    }, settings);

    this.introduction = new Introduction(this.settings);

    return this;
  }

  async start () {
    await super.start();
    return this;
  }

  _getInnerHTML () {
    return this.introduction.render();
  }

  render () {
    let html = `<fabric-grid rows="3" columns="3">`;

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

    if (this.settings.controls) {
      html += `<fabric-grid-row class="ui icon buttons">
        <button data-action="_navigateBack" class="ui button" title="back"><i class="icon left chevron"></i></button>
        <button data-action="_navigateForward" class="ui button" title="forward" disabled><i class="icon right chevron"></i></button>
        <button data-action="_reloadContent" class="ui button" title="refresh"><i class="icon refresh"></i></button>
        <input type="text" name="address" value="${this.address}" class="twelve wide input" />
        <button data-action="_saveToLibrary" class="ui button" title="save"><i class="icon star"></i></button>
      </fabric-grid-row>`;
    }

    html += `<fabric-grid-row id="browser-content">${this._getInnerHTML()}</fabric-grid-row>
      </fabric-grid>`;

    return html;
  }
}

module.exports = Browser;
