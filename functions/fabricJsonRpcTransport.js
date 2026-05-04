'use strict';

const crypto = require('crypto');

/** Standard JSON-RPC version tag emitted by this package. */
const JSON_RPC_VERSION = '2.0';
/** Canonical method name for WebSocket JSON call responses. */
const JSON_CALL_RESULT_METHOD = 'JSONCallResult';

/**
 * Normalize params into positional-array form.
 *
 * @param {unknown} params
 * @returns {unknown[]}
 */
function normalizeJsonRpcParams (params) {
  if (params === undefined || params === null) return [];
  return Array.isArray(params) ? params : [params];
}

/**
 * Build JSON-RPC success envelope.
 *
 * @param {{ id: unknown, result: unknown }} input
 * @returns {{ jsonrpc: string, id: unknown, result: unknown }}
 */
function buildJsonRpcSuccessEnvelope (input) {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id: input.id,
    result: input.result
  };
}

/**
 * Build JSON-RPC error envelope.
 *
 * @param {{ id: unknown, code: number, message: string, data?: unknown }} input
 * @returns {{ jsonrpc: string, id: unknown, error: { code: number, message: string, data?: unknown } }}
 */
function buildJsonRpcErrorEnvelope (input) {
  const out = {
    jsonrpc: JSON_RPC_VERSION,
    id: input.id,
    error: {
      code: input.code,
      message: input.message
    }
  };
  if (input.data !== undefined) out.error.data = input.data;
  return out;
}

/**
 * Parse a WebSocket JSON call body.
 *
 * @param {string} body
 * @returns {{ method?: unknown, params?: unknown }}
 */
function parseWebSocketJsonCallBody (body) {
  return JSON.parse(body);
}

/**
 * Compute two-step hash pair for WebSocket JSON call correlation.
 * Preserves existing server behavior:
 *  1) preimage = sha256(utf8-body).hex
 *  2) hash = sha256(utf8-preimageHex).hex
 *
 * @param {string} body
 * @returns {{ preimage: string, hash: string }}
 */
function computeWebSocketJsonCallHashPair (body) {
  const preimage = crypto.createHash('sha256').update(body).digest('hex');
  const hash = crypto.createHash('sha256').update(preimage).digest('hex');
  return { preimage, hash };
}

/**
 * Build WS JSON call result envelope body object.
 *
 * @param {{ hash: string, result: unknown }} input
 * @returns {{ method: string, params: [string, unknown] }}
 */
function buildWebSocketJsonCallResultBody (input) {
  return {
    method: JSON_CALL_RESULT_METHOD,
    params: [input.hash, input.result]
  };
}

/**
 * Build WS JSON call error envelope body object.
 *
 * @param {{ hash: string, code: number, message: string }} input
 * @returns {{ method: string, params: [string, null], error: { code: number, message: string } }}
 */
function buildWebSocketJsonCallErrorBody (input) {
  return {
    method: JSON_CALL_RESULT_METHOD,
    params: [input.hash, null],
    error: {
      code: input.code,
      message: input.message
    }
  };
}

module.exports = {
  JSON_RPC_VERSION,
  JSON_CALL_RESULT_METHOD,
  normalizeJsonRpcParams,
  buildJsonRpcSuccessEnvelope,
  buildJsonRpcErrorEnvelope,
  parseWebSocketJsonCallBody,
  computeWebSocketJsonCallHashPair,
  buildWebSocketJsonCallResultBody,
  buildWebSocketJsonCallErrorBody
};
