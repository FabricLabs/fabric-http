'use strict';

/**
 * Legacy browser mesh helper previously backed by PeerJS.
 * PeerJS and the Express `peer` signaling server are removed from the stack;
 * Hub uses native RTCPeerConnection + WebSocket signaling ({@link ../hub.fabric.pub/components/Bridge.js}).
 *
 * This class remains as a **no-op stub** so older `components/application.js` loads without the `peerjs`
 * package. Do not use for new work — use Hub Bridge patterns instead.
 */
const {
  HTTP_SERVER_PORT
} = require('../constants');

const Service = require('@fabric/core/types/service');

class Swarm extends Service {
  constructor (configuration = {}) {
    super(configuration);

    this.settings = this.config = Object.assign({
      port: HTTP_SERVER_PORT,
      secure: true,
      seeds: []
    }, configuration);

    this.agent = null;
    this.connections = {};
    this.peers = [];
  }

  identify (id) {
    this.name = id;
    this.status = 'identified';
    return this;
  }

  connect (id) {
    console.warn('[SWARM] connect() is a no-op; PeerJS has been removed. Use Hub WebRTC + RegisterWebRTCPeer.');
    return this.connections[id];
  }

  start () {
    this.status = 'started';
    const self = this;
    setImmediate(() => self.emit('ready'));
    return this;
  }

  _broadcast () {
    console.warn('[SWARM] _broadcast no-op');
  }

  async _GET () {
    console.warn('[SWARM] _GET no-op');
  }
}

module.exports = Swarm;
