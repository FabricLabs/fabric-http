'use strict';

/**
 * JSON bridge for Fabric Message field bodies (HTTP / browser edge).
 *
 * Core AMP bodies are C-like typed fields (`@fabric/core` messageBodyCodec).
 * This helper maps fields ↔ plain JSON objects for REST and SPA views.
 * Legacy UTF-8 JSON bodies (no schema) still parse via tryParseWireJson.
 *
 * @module functions/messageBodyJsonBridge
 * @see @fabric/core/docs/MESSAGE_BODY.md
 */

const Message = require('@fabric/core/types/message');

let codec = null;
try {
  codec = require('@fabric/core/functions/messageBodyCodec');
} catch (_) {
  codec = null;
}

let wireJson = null;
try {
  wireJson = require('@fabric/core/functions/wireJson');
} catch (_) {
  wireJson = null;
}

// Side-effect: register SIDECHAIN_STATE_PATCH field schema in core.
try {
  require('@fabric/core/functions/documentRegistrySidechain');
} catch (_) {
  // Older published core: install the V1 schema locally so HTTP still maps fields.
  if (codec && typeof codec.registerBodySchema === 'function' && !codec.getBodySchema('SIDECHAIN_STATE_PATCH')) {
    const schema = Object.freeze([
      { name: 'basisClock', type: 'u32' },
      { name: 'basisDigest', type: 'bytes32' },
      { name: 'catalogCanonical', type: 'string' }
    ]);
    codec.registerBodySchema('SIDECHAIN_STATE_PATCH', schema);
    codec.registerBodySchema('SidechainStatePatch', schema);
  }
}

/**
 * HTTP edge: RFC6902-shaped JSON `{ basisClock, basisDigest, patches }` → typed fields
 * (`basisClock`, `basisDigest`, `catalogCanonical`). Opcodes unchanged.
 * @param {object} body
 * @returns {object}
 */
function rfc6902SidechainJsonToFields (body = {}) {
  const patches = Array.isArray(body.patches) ? body.patches : [];
  const regOp = patches.find((p) => p && (p.path === '/registry' || p.path === '/registry/'));
  const catalog = regOp && regOp.value != null
    ? regOp.value
    : { version: 1, documents: {}, patches };
  let basisDigest = body.basisDigest;
  if (typeof basisDigest === 'string') {
    basisDigest = Buffer.from(String(basisDigest).replace(/^0x/, ''), 'hex');
  }
  return {
    basisClock: body.basisClock != null ? Number(body.basisClock) : 0,
    basisDigest: basisDigest || Buffer.alloc(32),
    catalogCanonical: typeof catalog === 'string' ? catalog : JSON.stringify(catalog)
  };
}

/**
 * Typed fields → HTTP JSON including RFC6902 `patches` view for Hub RPC clients.
 * @param {object} fieldsJson hex-safe field object
 * @returns {object}
 */
function registryFieldsToRfc6902Json (fieldsJson = {}) {
  let value = {};
  try {
    value = JSON.parse(fieldsJson.catalogCanonical || '{}');
  } catch (_) {
    value = {};
  }
  return {
    type: 'SIDECHAIN_STATE_PATCH',
    basisClock: fieldsJson.basisClock != null ? Number(fieldsJson.basisClock) : 0,
    basisDigest: fieldsJson.basisDigest != null ? String(fieldsJson.basisDigest) : '',
    patches: [{ op: 'add', path: '/registry', value }]
  };
}

/**
 * Present a Message body as a JSON-safe value for HTTP/browser consumers.
 * @param {import('@fabric/core/types/message')|object} message Message instance or { type, data }
 * @returns {{ ok: boolean, format: 'fields'|'json'|'raw'|'empty', value: *, error?: string }}
 */
function messageBodyToJson (message) {
  if (!message) return { ok: false, format: 'empty', value: null, error: 'message required' };

  const type = message.type || message.wireType || null;
  const buf = Buffer.isBuffer(message.bodyBuffer)
    ? message.bodyBuffer
    : (Buffer.isBuffer(message.raw && message.raw.data)
      ? message.raw.data
      : Buffer.from(typeof message.data === 'string' ? message.data : '', 'utf8'));

  if (!buf.length) return { ok: true, format: 'empty', value: null };

  if (codec && typeof message.toFields === 'function') {
    try {
      const fields = message.toFields();
      if (fields && typeof fields === 'object') {
        const jsonSafe = {};
        for (const [k, v] of Object.entries(fields)) {
          if (Buffer.isBuffer(v)) jsonSafe[k] = v.toString('hex');
          else if (typeof v === 'bigint') jsonSafe[k] = v.toString();
          else jsonSafe[k] = v;
        }
        if (type === 'SIDECHAIN_STATE_PATCH' || type === 'SidechainStatePatch') {
          return {
            ok: true,
            format: 'fields',
            value: jsonSafe,
            rfc6902: registryFieldsToRfc6902Json(jsonSafe)
          };
        }
        return { ok: true, format: 'fields', value: jsonSafe };
      }
    } catch (err) {
      /* fall through to legacy JSON */
    }
  }

  if (codec && type) {
    const schema = codec.getBodySchema(type);
    if (schema) {
      try {
        const fields = codec.decodeBody(schema, buf);
        const jsonSafe = {};
        for (const [k, v] of Object.entries(fields)) {
          if (Buffer.isBuffer(v)) jsonSafe[k] = v.toString('hex');
          else if (typeof v === 'bigint') jsonSafe[k] = v.toString();
          else jsonSafe[k] = v;
        }
        if (type === 'SIDECHAIN_STATE_PATCH' || type === 'SidechainStatePatch') {
          return {
            ok: true,
            format: 'fields',
            value: jsonSafe,
            rfc6902: registryFieldsToRfc6902Json(jsonSafe)
          };
        }
        return { ok: true, format: 'fields', value: jsonSafe };
      } catch (err) {
        return {
          ok: false,
          format: 'fields',
          value: null,
          error: err && err.message ? err.message : 'field decode failed'
        };
      }
    }
  }

  const text = buf.toString('utf8');
  if (wireJson && typeof wireJson.tryParseWireJson === 'function') {
    const parsed = wireJson.tryParseWireJson(text);
    if (parsed.ok) return { ok: true, format: 'json', value: parsed.value };
  } else {
    try {
      return { ok: true, format: 'json', value: JSON.parse(text) };
    } catch (_) { /* raw */ }
  }

  return { ok: true, format: 'raw', value: text };
}

/**
 * Build a Message from JSON: uses fromFields when a schema exists, else legacy JSON body.
 * @param {string} type
 * @param {object|string|Buffer} body
 * @param {object} [opts]
 * @returns {import('@fabric/core/types/message')}
 */
function messageFromJsonBody (type, body, opts = {}) {
  if (codec && body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    let fieldSource = body;
    if ((type === 'SIDECHAIN_STATE_PATCH' || type === 'SidechainStatePatch') &&
        Array.isArray(body.patches)) {
      fieldSource = rfc6902SidechainJsonToFields(body);
    }
    const schema = codec.getBodySchema(type);
    if (schema) {
      const fields = {};
      for (const def of schema) {
        let v = fieldSource[def.name];
        if (def.type === 'bytes32' && typeof v === 'string') {
          v = Buffer.from(v.replace(/^0x/, ''), 'hex');
        } else if ((def.type === 'bytes' || def.type === 'message') && typeof v === 'string' &&
            /^[0-9a-fA-F]*$/.test(v) && v.length % 2 === 0) {
          v = Buffer.from(v, 'hex');
        }
        fields[def.name] = v;
      }
      return Message.fromFields(type, fields, opts);
    }
  }
  const data = Buffer.isBuffer(body)
    ? body
    : (typeof body === 'string' ? body : JSON.stringify(body));
  return new Message(Object.assign({}, opts, { type, data }));
}

module.exports = {
  messageBodyToJson,
  messageFromJsonBody,
  rfc6902SidechainJsonToFields,
  registryFieldsToRfc6902Json
};
