import { EventEmitter } from 'events';

export default class FabricHTTP extends EventEmitter {
  constructor (settings = {}) {
    super(settings);

    return this;
  }
};
