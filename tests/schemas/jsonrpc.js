'use strict';

/**
 * JSON Schema (draft-07) fragments for JSON-RPC 2.0 over HTTP tests.
 * @see https://www.jsonrpc.org/specification
 */

const jsonRpcSuccessResponse = {
  $id: 'https://fabric.pub/schemas/jsonrpc-success-response.json',
  type: 'object',
  required: ['jsonrpc', 'result'],
  additionalProperties: true,
  properties: {
    jsonrpc: { type: 'string', enum: ['2.0'] },
    id: {},
    result: {}
  }
};

const jsonRpcErrorResponse = {
  $id: 'https://fabric.pub/schemas/jsonrpc-error-response.json',
  type: 'object',
  required: ['jsonrpc', 'error'],
  additionalProperties: true,
  properties: {
    jsonrpc: { type: 'string', enum: ['2.0'] },
    id: {},
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'integer' },
        message: { type: 'string' }
      }
    }
  }
};

module.exports = {
  jsonRpcSuccessResponse,
  jsonRpcErrorResponse
};
