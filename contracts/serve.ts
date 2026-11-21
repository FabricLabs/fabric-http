'use strict';

const HTTPServer = require('../types/server');

async function OP_SERVE (x = {}) {
  // Constants
  const now = new Date();
  const target = this.program.target || 'assets';
  const server = new HTTPServer({
    assets: target
  });

  server.on('activity', (...params) => {
    console.debug(`[${now.toISOString()}]`, '[ACTIVITY]', ...params);
  });

  server.on('log', (...params) => {
    console.log(`[${now.toISOString()}]`, ...params);
  });

  server.on('debug', (...params) => {
    console.debug(`[${now.toISOString()}]`, ...params);
  });

  await server.start();

  // Canonical Object
  return {
    id: server.id,
    link: server.link
  };
};

module.exports = OP_SERVE;
