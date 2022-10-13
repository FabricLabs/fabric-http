// ## Dependencies
// ### Fabric Types
import Actor from '@fabric/core/types/actor';

// ### HTTP Types
import Bridge from '../types/bridge';
import Client from '../types/client';
import Remote from '../types/remote';
import Server from '../types/server';
import Site from '../types/site';

/**
 * Implements support for the legacy web.
 */
export class EdgeNode extends Actor {
  Bridge: Bridge
  Client: Client
  Remote: Remote
  Server: Server
  Site: Site

  constructor (settings: object = {}) {
    super(settings);

    this.on('debug', function (...params) {
      console.debug('[EDGE:NODE]', '[DEBUG]', ...params);
    });

    this.on('log', function (...params) {
      console.log('[EDGE:NODE]', '[LOG]', ...params);
    });

    return this;
  }
}

export class Fabric extends Actor {
  Actor: Actor

  constructor (settings: object = {}) {
    super(settings);

    this.on('debug', function (...params) {
      console.debug('[FABRIC]', '[DEBUG]', ...params);
    });

    this.on('log', function (...params) {
      console.log('[FABRIC]', '[LOG]', ...params);
    });

    return this;
  }
}

// This namespace is merged with the FabricHTTP class and allows for consumers,
// and this file, to have types which are nested away in their own sections.
declare namespace EdgeNode {
  export interface Server {
    id: string;
  }
}

export default Fabric;
