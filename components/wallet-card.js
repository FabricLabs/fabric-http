'use strict';

const Fabric = require('@fabric/core');
// const Component = require('./component');

/**
 * Manage keys and track their balances.
 * @type {Object}
 */
class WalletCard extends Fabric.Service {
  /**
   * Create an instance of a {@link Wallet}.
   * @param  {Object} [settings={}] Configure the wallet.
   * @return {Wallet}               Instance of the wallet.
   */
  constructor (settings = {}) {
    super(settings);

    this.settings = Object.assign({
      name: 'default',
      network: 'testnet'
    }, settings);

    this.account = null;
    this.manager = null;
    this.wallet = null;
    this.master = null;
    this.seed = null;

    this.status = 'closed';

    return this;
  }

  _handleWalletTransaction (tx) {
    console.log('[BRIDGE:WALLET]', 'incoming transaction:', tx);
  }

  _getDepositAddress () {
    return this.address;
  }

  async _handleWalletBalance (balance) {
    console.log('wallet balance:', balance);
    await this._PUT(`/balance`, balance);

    let depositor = new Fabric.State({ name: 'eric' });
    await this._PUT(`/depositors/${depositor.id}/balance`, balance);
    this.emit('balance', balance);
  }

  async _registerAccount (obj) {
    this.status = 'creating';

    if (!this.database.db.loaded) {
      await this.database.open();
    }

    try {
      this.wallet = await this.database.create();
    } catch (E) {
      console.error('Could not create wallet:', E);
    }

    if (this.manager) {
      this.manager.on('tx', this._handleWalletTransaction.bind(this));
      this.manager.on('balance', this._handleWalletBalance.bind(this));
    }

    return this.account;
  }

  async _unload () {
    return this.database.close();
  }

  async _load (settings = {}) {
    this.status = 'loading';

    await this.database.open();

    this.wallet = await this.database.create();
    this.account = await this.wallet.getAccount('default');
    this.address = await this.account.receiveAddress();

    this.status = 'loaded';

    this.emit('ready');

    console.log('[FABRIC:WALLET]', 'Wallet opened:', this.wallet);

    return this.wallet;
  }

  async start () {
    return this._load();
  }
}

module.exports = WalletCard;
