'use strict';

class FabricChatBar extends HTMLElement {
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      handle: 'fabric-chat-bar',
      state: {
        status: 'PAUSED'
      }
    }, settings);

    this._state = {
      content: this.settings.state
    };

    return this;
  }

  connectedCallback () {
    console.log('connected !!!!!!!!');
  }

  _getHTML () {
    return `
      <fabric-chat-bar id="chat-bar">
        <fabric-card class="ui fluid card">
          <fabric-card-content id="chat-log" class="extra content" style="display: none;">
            <fabric-chat-log style="height: 30em;">
              <fabric-chat-entry>
                <p><strong><abbr title="Message Of The Day">MOTD</abbr>:</strong> YOLO!</p>
              </fabric-chat-entry>
            </fabric-chat-log>
          </fabric-card-content>
          <fabric-card-content class="content">
            <form class="ui form" id="chat-input">
              <fabric-form-field class="ui field">
                <fabric-input class="ui transparent inverted left action fluid input">
                  <fabric-button class="ui inverted basic button">Say:</fabric-button>
                  <input type="text" name="input" placeholder="..." autocomplete="off" />
                  <fabric-button class="icon button" id="chat-collapse" style="display: none;"><i class="down chevron icon"></i></fabric-button>
                </fabric-input>
              </fabric-form-field>
            </form>
          </fabric-card-content>
        </fabric-card>
      </fabric-chat-bar>
    `.trim();
  }
}

module.exports = FabricChatBar;
