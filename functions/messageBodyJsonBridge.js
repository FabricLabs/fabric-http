'use strict';

/**
 * JSON bridge for Fabric Message field bodies (HTTP / browser edge).
 *
 * Core AMP bodies are C-like typed fields (`@fabric/core` messageBodyCodec).
 * This helper maps fields ↔ plain JSON objects for REST and SPA views.
 * UTF-8 JSON bodies (types with no schema, stored frames) parse via tryParseWireJson.
 *
 * @module functions/messageBodyJsonBridge
 * @see @fabric/core/docs/MESSAGE_BODY.md
 */

const Message = require('@fabric/core/types/message');
const codec = require('@fabric/core/functions/messageBodyCodec');
const wireJson = require('@fabric/core/functions/wireJson');

const RFC6902_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);

/**
 * @param {unknown} patches
 * @returns {object[]}
 */
function assertValidRfc6902Patches (patches) {
  if (!Array.isArray(patches)) {
    throw new TypeError('SIDECHAIN_STATE_PATCH patches must be an array');
  }
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (!p || typeof p !== 'object') {
      throw new TypeError(`SIDECHAIN_STATE_PATCH patches[${i}] must be an object`);
    }
    if (typeof p.op !== 'string' || !RFC6902_OPS.has(p.op)) {
      throw new TypeError(`SIDECHAIN_STATE_PATCH patches[${i}].op must be a valid RFC6902 op`);
    }
    if (typeof p.path !== 'string' || !p.path.startsWith('/')) {
      throw new TypeError(`SIDECHAIN_STATE_PATCH patches[${i}].path must be a JSON Pointer`);
    }
    if ((p.op === 'move' || p.op === 'copy') && (typeof p.from !== 'string' || !p.from.startsWith('/'))) {
      throw new TypeError(`SIDECHAIN_STATE_PATCH patches[${i}].from must be a JSON Pointer`);
    }
  }
  return patches;
}

/**
 * HTTP edge: RFC6902-shaped JSON `{ basisClock, basisDigest, patches }` → typed fields
 * (`basisClock`, `basisDigest`, `catalogCanonical`, `patchesCanonical`).
 * Multi-op sequences are preserved in `patchesCanonical`; `/registry` still seeds catalog.
 * @param {object} body
 * @returns {object}
 */
function rfc6902SidechainJsonToFields (body = {}) {
  const patches = assertValidRfc6902Patches(Array.isArray(body.patches) ? body.patches : []);
  const regOp = patches.find((p) => p && (p.path === '/registry' || p.path === '/registry/'));
  const catalog = regOp && regOp.value != null
    ? regOp.value
    : { version: 1, documents: {} };
  let basisDigest = body.basisDigest;
  if (typeof basisDigest === 'string') {
    basisDigest = Buffer.from(String(basisDigest).replace(/^0x/, ''), 'hex');
  }
  return {
    basisClock: body.basisClock != null ? Number(body.basisClock) : 0,
    basisDigest: basisDigest || Buffer.alloc(32),
    catalogCanonical: typeof catalog === 'string' ? catalog : JSON.stringify(catalog),
    patchesCanonical: patches.length ? JSON.stringify(patches) : ''
  };
}

/**
 * Typed fields → HTTP JSON including RFC6902 `patches` view for Hub RPC clients.
 * Prefers `patchesCanonical` when present for multi-op fidelity.
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

  const rawPatches = fieldsJson.patchesCanonical != null ? String(fieldsJson.patchesCanonical).trim() : '';
  if (rawPatches) {
    try {
      const patches = JSON.parse(rawPatches);
      if (Array.isArray(patches)) {
        return {
          type: 'SIDECHAIN_STATE_PATCH',
          basisClock: fieldsJson.basisClock != null ? Number(fieldsJson.basisClock) : 0,
          basisDigest: fieldsJson.basisDigest != null ? String(fieldsJson.basisDigest) : '',
          patches
        };
      }
    } catch (_) {
      /* fall through to catalog synthesis */
    }
  }

  return {
    type: 'SIDECHAIN_STATE_PATCH',
    basisClock: fieldsJson.basisClock != null ? Number(fieldsJson.basisClock) : 0,
    basisDigest: fieldsJson.basisDigest != null ? String(fieldsJson.basisDigest) : '',
    patches: [{ op: 'add', path: '/registry', value }]
  };
}

/**
 * Wire name when core maps this type's legacy JSON object onto fields.
 * @param {string|number} type
 * @returns {string|null}
 */
function legacyBodyType (type) {
  if (type == null) return null;
  const name = Message.canonicalTypeName(type);
  return name && Message.LEGACY_BODY_TYPES.includes(name) ? name : null;
}

/**
 * Legacy JSON object of a message body, from either encoding (JSON or fields).
 * @param {import('@fabric/core/types/message')} message
 * @returns {object|null}
 */
function legacyBodyOf (message) {
  if (!message) return null;
  if (!legacyBodyType(message.type)) return null;
  try {
    const parsed = Message.tryParseLegacyBody(message);
    return parsed && parsed.ok ? parsed.value : null;
  } catch (_) {
    return null;
  }
}

/**
 * Present a Message body as a JSON-safe value for HTTP/browser consumers.
 * For types core maps (`Message.LEGACY_BODY_TYPES`), `legacy` carries the
 * application JSON object whichever encoding the sender used.
 * @param {import('@fabric/core/types/message')|object} message Message instance or { type, data }
 * @returns {{ ok: boolean, format: 'fields'|'json'|'raw'|'empty', value: *, legacy?: object, error?: string }}
 */
function messageBodyToJson (message) {
  const view = messageBodyView(message);
  if (view.ok && view.format !== 'empty') {
    const legacy = legacyBodyOf(message);
    if (legacy) view.legacy = legacy;
  }
  return view;
}

/**
 * @private
 * @param {import('@fabric/core/types/message')|object} message
 * @returns {object}
 */
function messageBodyView (message) {
  if (!message) return { ok: false, format: 'empty', value: null, error: 'message required' };

  const type = message.type || message.wireType || null;
  const buf = Buffer.isBuffer(message.bodyBuffer)
    ? message.bodyBuffer
    : (Buffer.isBuffer(message.raw && message.raw.data)
      ? message.raw.data
      : Buffer.from(typeof message.data === 'string' ? message.data : '', 'utf8'));

  if (!buf.length) return { ok: true, format: 'empty', value: null };

  // A stored JSON frame of a schema type must not hit the field decoder.
  try {
    const parsed = Message.tryParseMessageBody(message);
    if (parsed && parsed.ok && parsed.encoding === 'json') {
      return { ok: true, format: 'json', value: parsed.value };
    }
  } catch (_) { /* fall through */ }

  if (typeof message.toFields === 'function') {
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
      /* fall through to the schema decoder */
    }
  }

  if (type) {
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
  const parsed = wireJson.tryParseWireJson(text);
  if (parsed.ok) return { ok: true, format: 'json', value: parsed.value };

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
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
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

/**
 * Build a Message from an application JSON object. Types core maps
 * (`Message.LEGACY_BODY_TYPES`) are field-encoded via `Message.fromLegacyBody`;
 * others fall back to {@link messageFromJsonBody}.
 * @param {string} type
 * @param {object} body Legacy JSON object (e.g. `{ contract, type, object }`).
 * @param {object} [opts]
 * @returns {import('@fabric/core/types/message')}
 */
function messageFromLegacyJson (type, body, opts = {}) {
  const name = legacyBodyType(type);
  if (name && body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    return Message.fromLegacyBody(name, body, opts);
  }
  return messageFromJsonBody(type, body, opts);
}

module.exports = {
  messageBodyToJson,
  messageFromJsonBody,
  messageFromLegacyJson,
  legacyBodyOf,
  rfc6902SidechainJsonToFields,
  registryFieldsToRfc6902Json,
  assertValidRfc6902Patches
};
