'use strict';

const EventEmitter = require('events').EventEmitter;
const Key = require('@fabric/core').Key;

class Peer extends EventEmitter {
  constructor (configuration = {}) {
    super(configuration);
    this.key = new Key();
    this.config = configuration;
    this.config.on('open', this._onOpen.bind(this));
    this.config.on('data', this._onData.bind(this));
    return this;
  }

  async _onOpen () {
    this.emit('open');
  }

  async _onData (data) {
    console.log('got data:', data);
    this.emit('message', {
      '@actor': this.config.peer,
      '@type:': 'PeerMessage',
      '@data': data
    });
  }

  async send (msg) {
    this.config.send(msg);
  }
}

module.exports = Peer;
