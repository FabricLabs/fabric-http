'use strict';

/**
 * JSON at the HTTP edge, typed fields on the message.
 * Run: node examples/message-bridge.js
 *
 * One ping, and one RFC6902 sidechain patch. No server.
 */

const {
  messageFromJsonBody,
  messageBodyToJson,
  rfc6902SidechainJsonToFields
} = require('../functions/messageBodyJsonBridge');

function fail (message) {
  console.error('[EXAMPLES:MESSAGE_BRIDGE]', message);
  process.exitCode = 1;
  throw new Error(message);
}

function main () {
  const ping = messageFromJsonBody('P2P_PING', { nonce: '42' });
  const pingJson = messageBodyToJson(ping);
  if (!pingJson.ok || String(pingJson.value.nonce) !== '42') fail('ping JSON did not round-trip');
  if (pingJson.format !== 'fields') fail('a ping with a schema should come back as fields');

  const patch = {
    basisClock: 0,
    basisDigest: '',
    patches: [{ op: 'add', path: '/hello', value: 'world' }]
  };
  const fields = rfc6902SidechainJsonToFields(patch);
  if (!fields.patchesCanonical || fields.patchesCanonical.indexOf('/hello') === -1) {
    fail('the patch list should be kept in patchesCanonical');
  }

  const sidechain = messageFromJsonBody('SIDECHAIN_STATE_PATCH', patch);
  const sideJson = messageBodyToJson(sidechain);
  if (!sideJson.ok || !sideJson.rfc6902) fail('sidechain fields should offer an RFC6902 view');
  if (sideJson.rfc6902.patches[0].path !== '/hello') fail('the RFC6902 view dropped the path');

  console.log('[EXAMPLES:MESSAGE_BRIDGE]', 'ping', pingJson.format, String(pingJson.value.nonce));
  console.log('[EXAMPLES:MESSAGE_BRIDGE]', 'patch', sideJson.rfc6902.patches[0].op, sideJson.rfc6902.patches[0].path);
}

main();
