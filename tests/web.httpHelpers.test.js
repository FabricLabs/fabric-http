'use strict';

const assert = require('assert');
const Web = require('../types/web');
const { resolveAppAssetsDir } = require('../types/web');
const payment402 = require('../functions/fabricDocumentPayment402');
const webrtcInterop = require('../functions/fabricWebRtcInterop');
const messageTransport = require('../functions/fabricMessageTransport');
const jsonRpcTransport = require('../functions/fabricJsonRpcTransport');
const path = require('path');

describe('resolveAppAssetsDir', function () {
  it('uses env as app root when set', function () {
    const envName = 'FABRIC_TEST_ASSETS_ROOT_X';
    const prev = process.env[envName];
    const root = path.join(__dirname, '..');
    process.env[envName] = root;
    try {
      const d = resolveAppAssetsDir(__dirname, { envVar: envName, subdir: 'types' });
      assert.strictEqual(d, path.join(root, 'types'));
    } finally {
      if (prev != null) process.env[envName] = prev;
      else delete process.env[envName];
    }
  });

  it('resolves ../assets from module dirname when env unset', function () {
    const envName = 'FABRIC_TEST_ASSETS_ROOT_MISSING';
    delete process.env[envName];
    const d = resolveAppAssetsDir(path.join(__dirname, '..', 'types'), { envVar: envName });
    assert.strictEqual(d, path.join(__dirname, '..', 'assets'));
  });
});

describe('types/web export shape', function () {
  it('keeps top-level API instance-first and groups advanced helpers under protocol', function () {
    assert.strictEqual(typeof Web.Server, 'function');
    assert.strictEqual(typeof Web.Client, 'function');
    assert.strictEqual(typeof Web.resolveAppAssetsDir, 'function');
    assert.ok(Web.protocol && typeof Web.protocol === 'object');
    assert.strictEqual(typeof Web.protocol.payments402, 'object');
    assert.strictEqual(typeof Web.protocol.webrtcInterop, 'object');
    assert.strictEqual(typeof Web.protocol.messageTransport, 'object');
    assert.strictEqual(typeof Web.protocol.jsonRpcTransport, 'object');
    assert.strictEqual(Object.prototype.hasOwnProperty.call(Web, 'acceptFirstHtmlNavigation'), false);
    assert.strictEqual(Object.prototype.hasOwnProperty.call(Web, 'FABRIC_PAYMENT_REQUEST_HEADER'), false);
  });
});

describe('webrtc interop helpers', function () {
  it('exports canonical mesh postMessage constants', function () {
    assert.strictEqual(webrtcInterop.FABRIC_HUB_POSTMESSAGE_SOURCE, 'fabric-hub');
    assert.strictEqual(webrtcInterop.FABRIC_HUB_REGISTER_MESH, 'FABRIC_HUB_REGISTER_MESH');
    assert.strictEqual(webrtcInterop.FABRIC_HUB_UNREGISTER_MESH, 'FABRIC_HUB_UNREGISTER_MESH');
    assert.strictEqual(webrtcInterop.FABRIC_WEBRTC_SIGNAL_PROTOCOL, 'fabric-webrtc-v2');
  });

  it('exports canonical WebRTC registry method names and predicate', function () {
    assert.deepStrictEqual([
      'RegisterWebRTCPeer',
      'UnregisterWebRTCPeer',
      'ListWebRTCPeers'
    ], [
      'RegisterWebRTCPeer',
      'UnregisterWebRTCPeer',
      'ListWebRTCPeers'
    ]);

    const wsUrl = webrtcInterop.fabricSignalingWebSocketUrl('http://127.0.0.1:8080', '/');
    assert.strictEqual(wsUrl, 'ws://127.0.0.1:8080/');
  });

  it('normalizes Hub HTTP(S) addresses to signaling WebSocket URLs', function () {
    const parsed = webrtcInterop.parseFabricHubAddress('https://hub.fabric.pub');
    assert.deepStrictEqual(parsed, {
      host: 'hub.fabric.pub',
      port: 443,
      secure: true,
      wsOrigin: 'wss://hub.fabric.pub:443',
      raw: 'https://hub.fabric.pub'
    });
    assert.strictEqual(webrtcInterop.fabricSignalingWebSocketUrl('http://127.0.0.1:8080', '/'), 'ws://127.0.0.1:8080/');
    assert.strictEqual(webrtcInterop.fabricSignalingWebSocketUrl('hub.fabric.pub', '/services/ws'), 'wss://hub.fabric.pub:443/services/ws');
    assert.strictEqual(webrtcInterop.parseFabricHubAddress(''), null);
    assert.strictEqual(webrtcInterop.expectedOriginFromHubAddress('hub.fabric.pub'), 'https://hub.fabric.pub');
    assert.strictEqual(webrtcInterop.expectedOriginFromHubAddress('http://127.0.0.1:8080'), 'http://127.0.0.1:8080');
    assert.strictEqual(webrtcInterop.expectedOriginFromHubAddress(''), null);
    assert.strictEqual(webrtcInterop.isHubPageOriginMatch('https://hub.fabric.pub/', 'https://hub.fabric.pub'), true);
    assert.strictEqual(webrtcInterop.isHubPageOriginMatch('https://hub.fabric.pub/', 'https://evil.example'), false);
  });

  it('builds canonical register/unregister messages and signal metadata', function () {
    assert.deepStrictEqual(webrtcInterop.buildFabricHubRegisterMeshMessage('https://hub.fabric.pub/'), {
      source: 'fabric-hub',
      type: 'FABRIC_HUB_REGISTER_MESH',
      hubAddress: 'https://hub.fabric.pub/'
    });
    assert.deepStrictEqual(webrtcInterop.buildFabricHubUnregisterMeshMessage(), {
      source: 'fabric-hub',
      type: 'FABRIC_HUB_UNREGISTER_MESH'
    });

    const session = { localSessionId: 's-local', remoteSessionId: 's-remote', localSignalRevision: 0 };
    const payload = webrtcInterop.attachFabricSignalMeta(session, { kind: 'offer' });
    assert.strictEqual(payload._fabric.protocol, 'fabric-webrtc-v2');
    assert.strictEqual(payload._fabric.sessionId, 's-local');
    assert.strictEqual(payload._fabric.targetSessionId, 's-remote');
    assert.strictEqual(payload._fabric.revision, 1);
    assert.strictEqual(session.localSignalRevision, 1);
  });
});

describe('message transport helpers', function () {
  it('exports canonical type names and aliases', function () {
    assert.strictEqual(messageTransport.JSON_CALL_CANONICAL_TYPE, 'JSONCall');
    assert.deepStrictEqual(messageTransport.JSON_CALL_ALIASES, ['JSONCall', 'JSON_CALL']);
    assert.strictEqual(messageTransport.PING_CANONICAL_TYPE, 'Ping');
    assert.deepStrictEqual(messageTransport.PING_ALIASES, ['Ping', 'P2P_PING']);
    assert.strictEqual(messageTransport.PONG_CANONICAL_TYPE, 'Pong');
    assert.deepStrictEqual(messageTransport.PONG_ALIASES, ['Pong', 'P2P_PONG']);
    assert.strictEqual(messageTransport.HEARTBEAT_TYPE, 'HEARTBEAT');
    assert.strictEqual(messageTransport.GENERIC_MESSAGE_TYPE, 'GenericMessage');
    assert.strictEqual(messageTransport.JSON_CALL_RESULT_METHOD, 'JSONCallResult');
    assert.strictEqual(messageTransport.GENERIC_MESSAGE_RECEIPT_TYPE, 'GenericMessageReceipt');
    assert.ok(Array.isArray(messageTransport.SYSTEM_MESSAGE_TYPES));
    assert.ok(messageTransport.SYSTEM_MESSAGE_TYPES.includes('HEARTBEAT'));
  });

  it('normalizes aliases and classifies system messages', function () {
    assert.strictEqual(messageTransport.isJsonCallType('JSON_CALL'), true);
    assert.strictEqual(messageTransport.isPingType('P2P_PING'), true);
    assert.strictEqual(messageTransport.isPongType('P2P_PONG'), true);
    assert.strictEqual(messageTransport.isSystemMessageType('P2P_PING'), true);
    assert.strictEqual(messageTransport.isSystemMessageType('GenericMessage'), false);
    assert.strictEqual(messageTransport.normalizeTransportType('JSON_CALL'), 'JSONCall');
    assert.strictEqual(messageTransport.normalizeTransportType('P2P_PING'), 'Ping');
    assert.strictEqual(messageTransport.normalizeTransportType('P2P_PONG'), 'Pong');
    assert.strictEqual(messageTransport.normalizeTransportType('GenericMessage'), 'GenericMessage');
  });

  it('extracts control type and detects non-canonical heartbeat aliases', function () {
    assert.strictEqual(messageTransport.extractTransportControlType({ type: 'JSONCall' }), 'JSONCall');
    assert.strictEqual(messageTransport.extractTransportControlType({ '@type': 'Ping' }), 'Ping');
    assert.strictEqual(messageTransport.extractTransportControlType({}), undefined);
    assert.strictEqual(messageTransport.isNonCanonicalHeartbeatAlias('heartbeat'), true);
    assert.strictEqual(messageTransport.isNonCanonicalHeartbeatAlias('HEARTBEAT'), false);
  });
});

describe('json-rpc transport helpers', function () {
  it('normalizes params into positional array form', function () {
    assert.deepStrictEqual(jsonRpcTransport.normalizeJsonRpcParams(undefined), []);
    assert.deepStrictEqual(jsonRpcTransport.normalizeJsonRpcParams(null), []);
    assert.deepStrictEqual(jsonRpcTransport.normalizeJsonRpcParams([1, 2]), [1, 2]);
    assert.deepStrictEqual(jsonRpcTransport.normalizeJsonRpcParams({ x: 1 }), [{ x: 1 }]);
    assert.deepStrictEqual(jsonRpcTransport.normalizeJsonRpcParams('x'), ['x']);
  });

  it('builds json-rpc success/error envelopes', function () {
    assert.strictEqual(jsonRpcTransport.JSON_RPC_VERSION, '2.0');
    assert.deepStrictEqual(
      jsonRpcTransport.buildJsonRpcSuccessEnvelope({ id: 7, result: { ok: true } }),
      { jsonrpc: '2.0', id: 7, result: { ok: true } }
    );
    assert.deepStrictEqual(
      jsonRpcTransport.buildJsonRpcErrorEnvelope({ id: 7, code: -32001, message: 'Unauthorized' }),
      { jsonrpc: '2.0', id: 7, error: { code: -32001, message: 'Unauthorized' } }
    );
  });

  it('parses websocket call body and builds hash/result/error payloads', function () {
    const body = JSON.stringify({ method: 'Echo', params: [{ ok: true }] });
    assert.deepStrictEqual(jsonRpcTransport.parseWebSocketJsonCallBody(body), { method: 'Echo', params: [{ ok: true }] });

    const pair = jsonRpcTransport.computeWebSocketJsonCallHashPair(body);
    assert.strictEqual(typeof pair.preimage, 'string');
    assert.strictEqual(typeof pair.hash, 'string');
    assert.strictEqual(pair.preimage.length, 64);
    assert.strictEqual(pair.hash.length, 64);

    assert.deepStrictEqual(
      jsonRpcTransport.buildWebSocketJsonCallResultBody({ hash: pair.hash, result: 42 }),
      { method: 'JSONCallResult', params: [pair.hash, 42] }
    );
    assert.deepStrictEqual(
      jsonRpcTransport.buildWebSocketJsonCallErrorBody({ hash: pair.hash, code: -32001, message: 'Unauthorized' }),
      { method: 'JSONCallResult', params: [pair.hash, null], error: { code: -32001, message: 'Unauthorized' } }
    );
  });
});

describe('payment helpers', function () {
  it('exports canonical Fabric payment request header name', function () {
    assert.strictEqual(payment402.FABRIC_PAYMENT_REQUEST_HEADER, 'X-Fabric-Payment-Request');
  });

  it('round-trips payment request header payload via exported helpers', function () {
    const payload = payment402.buildFabricDocumentPaymentRequestHeader({
      requestPath: '/services/test',
      detail: 'Complete payment to continue.',
      documentOffer: {
        documentId: 'doc-123',
        purchasePriceSats: 21
      }
    });
    const encoded = payment402.encodeFabricPaymentRequestHeaderValue(payload);
    const decoded = payment402.decodeFabricPaymentRequestHeaderValue(encoded);
    assert.strictEqual(decoded, payload);
  });
});
