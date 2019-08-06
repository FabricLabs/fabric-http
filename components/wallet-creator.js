'use strict';

const Component = require('./component');
const Wallet = require('../types/wallet');

/**
 * Simple user interface for creating a {@link Wallet}.
 */
class WalletCreator extends Component {
  /**
   * Create an instance of the Wallet Creator.
   * @param  {Object} [settings={}] [description]
   * @return {Component}            Instance of the component.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      input: null,
      handle: 'maki-wallet-creator'
    }, settings);

    this.wallet = new Wallet();
    this.state = {
      clock: 0,
      wallets: []
    };

    return this;
  }

  _submitFormWithData (event) {
    event.preventDefault();
    console.log('WHOA EVENT:', event);
  }

  _loadConfirmedPanel (html) {
    let steps = document.querySelector('maki-steps');
    let elements = document.querySelectorAll('.tab');

    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];
      if (parseInt(element.getAttribute('data-step')) === this.state.clock) {
        let content = element.querySelector('.content');
        content.innerHTML = `<div class="ui message">
          <h4 class="ui header">Ready to Generate Keys</h4>
          <maki-canvas id="entropy-viewer"></maki-canvas>
          <p>Ready to generate. <a class="ui button" data-action="_loadGeneratorPanel">Generate</a></p>
        </div>`;
      }
    }
  }

  _loadGeneratorPanel () {
    let self = this;
    let steps = this.querySelector('maki-steps');
    let elements = document.querySelectorAll('.tab');

    console.log('steps:', steps);

    for (let i = 0; i < steps.length; i++) {
      let step = steps[i];
      if (i === this.state.clock) {
        step.className += ' active';
      }
    }

    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];
      if (parseInt(element.getAttribute('data-step')) === this.state.clock) {
        let content = element.querySelector('.content');
        let wallet = new Wallet();

        content.innerHTML = `<div class="ui message">
          <h4 class="ui header">Generating keys...</h4>
          <maki-canvas id="entropy-viewer"></maki-canvas>
          <p><div class="ui loading button">Generating...</div><p>
        </div>`;

        wallet._load().then(function (data) {
          let memory = {
            address: wallet.account.receiveAddress(),
            seed: wallet.wallet.master.mnemonic.phrase
          };

          window.app._POST('/wallets', memory).then(function (data) {
            console.log('data:', data);
            wallet.set('/wallets', [window.app.get(data)]);
            window.wallet = wallet;
            self._loadSuccessPanel();
          });
        });
      }
    }
  }

  _loadSuccessPanel () {
    let steps = document.querySelector('maki-steps');
    let elements = document.querySelectorAll('.tab');

    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];
      if (parseInt(element.getAttribute('data-step')) === this.state.clock) {
        let content = element.querySelector('.content');
        content.innerHTML = `<div class="ui message">
          <h4 class="ui header">Keys Generated</h4>
          <code class="code">${window.wallet}</code>
          <maki-canvas id="entropy-viewer"></maki-canvas>
          <p><div class="ui green right labeled icon button" data-action="_loadStepTwo">Next Step <i class="right chevron icon"></i></div><p>
        </div>`;
      }
    }
  }

  _loadStepTwo () {
    let elements = document.querySelectorAll('.tab');

    this.state.clock = 1;

    for (let i = 0; i < elements.length; i++) {
      let element = elements[i];
      if (parseInt(element.getAttribute('data-step')) === this.state.clock) {
        let content = element.querySelector('.content');
        let steps = element.querySelector('maki-steps');
        console.log('steps:', steps);
        content.innerHTML = `<div class="ui message">
          <h4 class="ui header">Verify Your Keys</h4>
          <maki-canvas id="entropy-viewer"></maki-canvas>
          <p>Double-check that the address matches your device and <a href="">the transaction on the blockchain</a>.  <div class="ui green right labeled icon button" data-action="_loadStepTwo">Next Step <i class="right chevron icon"></i></div><p>
        </div>`;
      }
    }
  }

  _advanceToLabeling (event) {
    event.preventDefault();

    this.status = 'advancing';

    let steps = this.querySelector('maki-steps');

    steps.state.clock = 2;
    steps.connectedCallback();

    this.status = 'labeling';
  }

  _advanceToKeyGeneration (event) {
    console.log('KEY GENERATION:', event, this);
    let self = this;

    self.status = 'advancing';

    let steps = this.querySelector('maki-steps');
    let element = document.querySelector('.maki-step[data-step="0"]');
    let content = element.querySelector('.content');

    console.log('element:', element);
    console.log('content:', content);

    let old = content.innerHTML;

    content.innerHTML = `<h4>Generating key...</h4>
      <button class="ui loading button">generating...</button>`;

    this.status = 'waiting';
    this.wallet._load().then(function (data) {
      let seed = self.wallet._getSeed();

      if (seed) {
        steps.state.clock = 1;

        let target = document.querySelector('.maki-step[data-step="1"]');
        let message = target.querySelector('.content');

        message.innerHTML = `<h4>Your Wallet Seed</h4>
          <p>Write this down and store it somewhere safe & secure.  <strong>Your funds will be permanently lost without this.</p>
          <code>${seed}</code>
          <button class="ui fluid right labeled icon button" data-action="_advanceToLabeling">I've saved this, move forward<i class="right chevron icon"></i></button>`;

        steps.connectedCallback();
      } else {
        content.innerHTML = old;
      }
    });

    this.status = 'loaded';
    steps.innerHTML = steps._getInnerHTML();
    // this.innerHTML = this._getInnerHTML();
  }

  _advanceToKeyRestoration (event) {
    console.log('KEY RESTORATION:', event, this);
    let self = this;

    let steps = this.querySelector('maki-steps');
    let element = document.querySelector('.maki-step[data-step="0"]');
    let content = element.querySelector('.content');

    console.log('element:', element);
    console.log('content:', content);

    let html = `<h4>Provide Wallet Seed</h4>
      <p>For improved security, turn off your network connection and ensure there are no cameras recording your screen.</p>
      <select multiple class="ui fluid search multiple dropdown" name="seed" placeholder="Enter your 24-word restoration seed"><option></option>`;
    for (let i = 0; i < this.wallet.words.length; i++) {
      let word = self.wallet.words[i];
      html += `<option value="${word}">${word}</option>`;
    }
    html += `</select>
      <button class="ui fluid right icon labeled button" data-action="_confirmSeedPhrase">Confirm <i class="right chevron icon"></i></button>`;

    content.innerHTML = html;
    steps.innerHTML = steps._getInnerHTML();

    $('.ui.dropdown').dropdown();
  }

  _confirmSeedPhrase (event) {
    event.preventDefault();

    this.state.clock = 1;

    let steps = this.querySelector('maki-steps');
    let element = document.querySelector('.maki-step[data-step="1"]');
    let content = element.querySelector('.content');

    content.innerHTML = `<code>${this.wallet.seed}</code>
      <button class="ui fluid button">Confirm</button>`;

    steps.innerHTML = steps._getInnerHTML();
  }

  async _publishIdentityAndCommitWallet (event) {
    event.preventDefault();

    $('.ui.modal').addClass('loading');

    let modal = document.querySelector('maki-modal');
    let account = this.wallet._getAccountByIndex(0);
    let identity = await this._publishIdentity(event);
    let wallet = await window.app._registerWallet({ account });


    modal._closeModal();
  }

  async _publishIdentity (event) {
    event.preventDefault();

    let modal = document.querySelector('maki-modal');
    let account = this.wallet._getAccountByIndex(0);
    let identity = null;

    try {
      let data = { id: account.address, address: account.address };
      let actor = await window.app._registerActor(data);
      let link = await window.app._POST('/identities', data);
      identity = Object.assign({
        link: link
      }, data);

      window.app._setIdentity(data);
    } catch (E) {
      console.error('Could not create identity:', E);
    }

    return identity;
  }

  connectedCallback () {
    super.connectedCallback();
    console.log('wallet creator attached!');

    window.app.circuit._registerMethod('_submitFormWithData', this._submitFormWithData.bind(this));
    window.app.circuit._registerMethod('_advanceToKeyGeneration', this._advanceToKeyGeneration.bind(this));
    window.app.circuit._registerMethod('_advanceToKeyRestoration', this._advanceToKeyRestoration.bind(this));
    window.app.circuit._registerMethod('_loadConfirmedPanel', this._loadConfirmedPanel.bind(this));
    window.app.circuit._registerMethod('_loadGeneratorPanel', this._loadGeneratorPanel.bind(this));
    window.app.circuit._registerMethod('_loadSuccessPanel', this._loadSuccessPanel.bind(this));
    window.app.circuit._registerMethod('_loadStepTwo', this._loadStepTwo.bind(this));
    window.app.circuit._registerMethod('_confirmSeedPhrase', this._confirmSeedPhrase.bind(this));
    window.app.circuit._registerMethod('_advanceToLabeling', this._advanceToLabeling.bind(this));
    window.app.circuit._registerMethod('_publishIdentity', this._publishIdentity.bind(this));
    window.app.circuit._registerMethod('_publishIdentityAndCommitWallet', this._publishIdentityAndCommitWallet.bind(this));

    let steps = this.querySelector('maki-steps');
    let progress = this.querySelector('maki-progress');

    console.log('FOUND STEPS:', steps);
    console.log('progress:', progress);

    steps.settings.steps = [
      {
        active: true,
        icon: 'lock',
        title: `Step 1: Insert Key`,
        description: 'Generate or restore from memory?',
        content: `<h4>Insert Key</h4>
          <div class="ui two buttons">
            <div class="ui blue left labeled icon button" data-action="_advanceToKeyRestoration"><i class="brain icon"></i>Restore from Memory</div>
            <div class="or">or</div>
            <div class="ui green right labeled icon button" data-action="_advanceToKeyGeneration">Generate New Key<i class="right chevron icon"></i></div>
          </div>`
      },
      {
        title: `Step 2: Verify`,
        icon: 'eye',
        description: 'Inspect the key.',
        content: '<code data-bind="/seed">key to verify</code>'
      },
      {
        title: `Step 3: Set Name`,
        icon: 'settings',
        description: 'Give it a name!',
        content: `<h4>Label This Wallet</h4>
        <div>
          <p>Set a local name.</p>
          <form class="ui form">
            <div class="field">
              <label for="name">Name</label>
              <input type="text" name="name" placeholder="Label for this wallet (local only)" class="required input" /><button data-action="_publishIdentityAndCommitWallet" class="ui fluid right labeled green icon button">Save & Open <i class="icon right chevron"></i></button>
            </div>
          </form>
        </div>`
      }
    ];

    steps.innerHTML = steps._getInnerHTML();
  }

  _getInnerHTML () {
    return `<form class="ui fluid form" action="/wallets" method="POST" data-action="_submitFormWithData">
      <maki-steps id="${this.settings.handle}-steps"></maki-steps>
    </form>`;
  }
}

module.exports = WalletCreator;
