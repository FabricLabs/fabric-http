'use strict';

const Message = require('@fabric/core/types/message');

class JSONCall extends Message {
  constructor(data) {
    super(data);
  }
}

module.exports = JSONCall;
