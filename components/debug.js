'use strict';

const Component = require('../types/component');

class Debug extends Component {
  constructor (settings = {}) {
    super(settings);
    this.settings = Object.assign({
      handle: 'fabric-debug'
    }, settings);
    this.state = {};
    return this;
  }

  _getInnerHTML () {
    let html = ``;
    html += `<fabric-grid-row class="ui inverted vertical footer segment">
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
    -->`;
    return html;
  }
}

module.exports = Debug;
