'use strict';

const crypto = require('crypto');
const pluralize = require('pluralize');
const Fabric = require('@fabric/core');
const Collection = require('@fabric/core/types/collection');
const Entity = require('@fabric/core/types/entity');

/**
 * A Fabric HTTP Resource.
 *
 * A single `define()` call on {@link FabricHTTPServer} produces one Resource.
 * The Resource owns its store, its schema, and every HTTP verb handler.
 * Nothing outside this class needs to know about schema layout or pagination rules.
 *
 * ## Quick start
 * ```js
 * server.define('Message', {
 *   description: 'A chat message',
 *   properties: {
 *     content:         { type: 'string', required: true, maxLength: 65536 },
 *     conversation_id: { type: 'string', required: true, index: true },
 *     role:            { type: 'string', enum: ['user', 'assistant', 'system'] },
 *     status:          { type: 'string', enum: ['ready', 'computing'], default: 'ready' }
 *   },
 *   auth:       { read: false, write: true },
 *   pagination: { default: 20, max: 100 },
 *   sort:       { field: 'created_at', order: 'desc' }
 * });
 * ```
 *
 * ## HTTP semantics
 * | Verb    | List path            | Item path            |
 * |---------|----------------------|----------------------|
 * | GET     | Paginated list       | Single item          |
 * | HEAD    | Count + page headers | ETag + exists        |
 * | POST    | Create (→ 303)       | —                    |
 * | PUT     | —                    | Full replace         |
 * | PATCH   | —                    | Merge-patch update   |
 * | DELETE  | —                    | Remove (204)         |
 * | SEARCH  | Body-driven filter   | —                    |
 * | OPTIONS | Full JSON-Schema     | Schema + Allow       |
 * | META    | Collection stats     | Fabric item identity |
 */
class Resource extends Fabric.Resource {
  /**
   * @param {String} name       Singular PascalCase, e.g. `"Message"`.
   * @param {Object} definition Resource descriptor (see class-level JSDoc).
   */
  constructor (name, definition = {}) {
    super(definition);

    this.name = name;
    this.definition = definition;
    this.plural = (definition.plural || pluralize(name)).toLowerCase();
    this.description = definition.description || '';

    // Route templates.
    this.routes = Object.assign({
      list: `/${this.plural}`,
      view: `/${this.plural}/:id`
    }, definition.routes || {});

    // Schema.
    this.properties = definition.properties || {};
    this.requiredFields = Object.keys(this.properties).filter(k => this.properties[k].required === true);
    this.readOnlyFields = Object.keys(this.properties).filter(k => this.properties[k].readOnly === true);
    this.indexedFields  = Object.keys(this.properties).filter(k => this.properties[k].index === true);

    // Auth: `true` = all verbs; `{ read, write }` = granular.
    this.auth = definition.auth || false;

    // Pagination defaults.
    this.pagination = Object.assign({ default: 20, max: 100 }, definition.pagination || {});

    // Default sort.
    this.sort = definition.sort || null;

    // In-memory Collection store.
    this.store = new Collection({
      name,
      routes: this.routes,
      type: Entity,
      data: {}
    });

    // Stable schema digest for caching/sync.
    this._schemaHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(this.properties))
      .digest('hex')
      .slice(0, 16);

    return this;
  }

  // ─── Schema helpers ────────────────────────────────────────────────────────

  /**
   * Full JSON-Schema–compatible descriptor returned by OPTIONS.
   * @returns {Object}
   */
  schema () {
    return {
      '@type': 'ResourceSchema',
      name: this.name,
      plural: this.plural,
      description: this.description,
      routes: this.routes,
      properties: this.properties,
      required: this.requiredFields,
      methods: this.allowedMethods(),
      pagination: this.pagination,
      sort: this.sort,
      auth: this.auth,
      schemaHash: this._schemaHash
    };
  }

  /** @returns {String[]} */
  allowedMethods () {
    return ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'SEARCH', 'OPTIONS', 'META'];
  }

  /**
   * Validate a body object against this resource's property schema.
   * @param {Object}  body
   * @param {Boolean} [requireAll=false]  Require all `required` fields to be present.
   * @returns {{ field: String, message: String }|null}  `null` on success.
   */
  validate (body, requireAll = false) {
    if (!body || typeof body !== 'object') {
      return { field: null, message: 'Request body must be a JSON object' };
    }

    if (requireAll) {
      for (const field of this.requiredFields) {
        if (body[field] === undefined || body[field] === null) {
          return { field, message: `"${field}" is required` };
        }
      }
    }

    for (const [field, schema] of Object.entries(this.properties)) {
      const val = body[field];
      if (val === undefined || val === null) continue;
      if (this.readOnlyFields.includes(field)) continue; // strip silently in handlers

      if (schema.type && schema.type !== 'array' && typeof val !== schema.type) {
        return { field, message: `"${field}" must be of type ${schema.type}` };
      }
      if (schema.type === 'array' && !Array.isArray(val)) {
        return { field, message: `"${field}" must be an array` };
      }
      if (schema.enum && !schema.enum.includes(val)) {
        return { field, message: `"${field}" must be one of: ${schema.enum.join(', ')}` };
      }
      if (schema.maxLength != null && typeof val === 'string' && val.length > schema.maxLength) {
        return { field, message: `"${field}" exceeds maximum length of ${schema.maxLength}` };
      }
      if (schema.minLength != null && typeof val === 'string' && val.length < schema.minLength) {
        return { field, message: `"${field}" must be at least ${schema.minLength} characters` };
      }
      if (schema.minimum != null && typeof val === 'number' && val < schema.minimum) {
        return { field, message: `"${field}" must be ≥ ${schema.minimum}` };
      }
      if (schema.maximum != null && typeof val === 'number' && val > schema.maximum) {
        return { field, message: `"${field}" must be ≤ ${schema.maximum}` };
      }
    }

    return null;
  }

  /** Strip read-only fields from a body before writing. */
  _stripReadOnly (body) {
    if (!this.readOnlyFields.length) return body;
    const out = Object.assign({}, body);
    for (const f of this.readOnlyFields) delete out[f];
    return out;
  }

  /** Apply defined `default` values for missing fields. */
  _applyDefaults (body) {
    const out = Object.assign({}, body);
    for (const [field, schema] of Object.entries(this.properties)) {
      if (schema.default !== undefined && out[field] === undefined) {
        out[field] = schema.default;
      }
    }
    return out;
  }

  // ─── Auth helpers ──────────────────────────────────────────────────────────

  requiresAuth (verb) {
    if (this.auth === true) return true;
    if (!this.auth || typeof this.auth !== 'object') return false;
    const reading = ['GET', 'HEAD', 'SEARCH', 'OPTIONS', 'META'].includes(verb);
    return reading ? !!this.auth.read : !!this.auth.write;
  }

  // ─── Pagination helpers ────────────────────────────────────────────────────

  _paginate (list, query) {
    const perPage = Math.min(
      parseInt(query.per_page || query.perPage || this.pagination.default, 10),
      this.pagination.max
    );
    const page = Math.max(1, parseInt(query.page || 1, 10));
    const total = list.length;
    const totalPages = Math.max(1, Math.ceil(total / perPage));
    const offset = (page - 1) * perPage;
    const items = list.slice(offset, offset + perPage);

    return { items, page, perPage, total, totalPages };
  }

  _sortList (list, query) {
    const field = query.sort || (this.sort && this.sort.field);
    if (!field) return list;
    const order = (query.order || (this.sort && this.sort.order) || 'asc').toLowerCase();
    return list.slice().sort((a, b) => {
      const av = a[field], bv = b[field];
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return order === 'desc' ? -cmp : cmp;
    });
  }

  _filterList (list, query) {
    // Any query param that maps to a known property is used as an equality filter.
    const known = new Set(Object.keys(this.properties));
    const reserved = new Set(['page', 'per_page', 'perPage', 'sort', 'order']);
    const filters = Object.fromEntries(
      Object.entries(query).filter(([k]) => known.has(k) && !reserved.has(k))
    );
    if (!Object.keys(filters).length) return list;
    return list.filter(item =>
      Object.entries(filters).every(([k, v]) => String(item[k]) === String(v))
    );
  }

  _setPaginationHeaders (res, { page, perPage, total, totalPages }, listPath) {
    res.set('X-Total-Count', String(total));
    res.set('X-Page', String(page));
    res.set('X-Per-Page', String(perPage));
    res.set('X-Total-Pages', String(totalPages));
    res.set('X-Schema-Hash', this._schemaHash);

    const links = [];
    if (page < totalPages) links.push(`<${listPath}?page=${page + 1}&per_page=${perPage}>; rel="next"`);
    if (page > 1)          links.push(`<${listPath}?page=${page - 1}&per_page=${perPage}>; rel="prev"`);
    links.push(`<${listPath}?page=1&per_page=${perPage}>; rel="first"`);
    links.push(`<${listPath}?page=${totalPages}&per_page=${perPage}>; rel="last"`);
    res.set('Link', links.join(', '));
  }

  // ─── HTTP verb handlers ────────────────────────────────────────────────────
  // Each handler receives (req, res, server) where server is the FabricHTTPServer.

  async GET (req, res, server) {
    const isView = this._isView(req.path);

    if (isView) {
      const result = await server._GET(req.path);
      if (!result) return res.status(404).json({ status: 'error', message: `${this.name} not found` });
      return res.json(result);
    }

    // List.
    let raw = await server._GET(req.path);
    let list = raw ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];

    list = this._filterList(list, req.query);
    list = this._sortList(list, req.query);
    const paged = this._paginate(list, req.query);
    this._setPaginationHeaders(res, paged, this.routes.list);
    return res.json(paged.items);
  }

  async HEAD (req, res, server) {
    const isView = this._isView(req.path);

    if (isView) {
      const result = await server._GET(req.path);
      if (!result) return res.status(404).end();
      const etag = `"${crypto.createHash('md5').update(JSON.stringify(result)).digest('hex')}"`;
      res.set('ETag', etag);
      res.set('X-Schema-Hash', this._schemaHash);
      return res.status(200).end();
    }

    // List: return count + pagination headers only.
    const raw = await server._GET(req.path);
    const list = raw ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];
    const filtered = this._filterList(list, req.query);
    const paged = this._paginate(filtered, req.query);
    this._setPaginationHeaders(res, paged, this.routes.list);
    return res.status(200).end();
  }

  async POST (req, res, server) {
    let body = this._applyDefaults(this._stripReadOnly(req.body || {}));

    const err = this.validate(body, true);
    if (err) return res.status(422).json({ status: 'error', field: err.field, message: err.message });

    const location = await server._POST(this.routes.list, body);
    if (!location) return res.status(500).json({ status: 'error', message: 'Create failed' });

    server._notifySubscribers(this.routes.list, body);
    return res.redirect(303, location);
  }

  async PUT (req, res, server) {
    let body = this._stripReadOnly(req.body || {});

    const err = this.validate(body, false);
    if (err) return res.status(422).json({ status: 'error', field: err.field, message: err.message });

    const result = await server._PUT(req.path, body);
    server._notifySubscribers(req.path, body);
    return res.json(result);
  }

  async PATCH (req, res, server) {
    let body = this._stripReadOnly(req.body || {});

    const err = this.validate(body, false);
    if (err) return res.status(422).json({ status: 'error', field: err.field, message: err.message });

    const result = await server._PATCH(req.path, body);
    server._notifySubscribers(req.path, body);
    return res.json(result);
  }

  async DELETE (req, res, server) {
    await server._DELETE(req.path);
    server._notifySubscribers(req.path, null);
    return res.sendStatus(204);
  }

  async SEARCH (req, res, server) {
    const { filter = {}, sort, order, page, per_page } = (req.body && typeof req.body === 'object') ? req.body : {};

    let raw = await server._GET(this.routes.list);
    let list = raw ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];

    // Body filter: each key/value is an equality (or array-includes) test.
    const filterKeys = Object.keys(filter);
    if (filterKeys.length) {
      list = list.filter(item =>
        filterKeys.every(k => {
          if (Array.isArray(filter[k])) return filter[k].includes(item[k]);
          return item[k] === filter[k];
        })
      );
    }

    const query = { sort, order, page, per_page };
    list = this._sortList(list, query);
    const paged = this._paginate(list, query);
    this._setPaginationHeaders(res, paged, this.routes.list);
    return res.json(paged.items);
  }

  async OPTIONS (req, res) {
    const isView = this._isView(req.path);
    const response = this.schema();

    if (isView) {
      response.scope = 'item';
      response.methods = ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'META'];
    } else {
      response.scope = 'collection';
    }

    res.set('Allow', response.methods.join(', '));
    return res.json(response);
  }

  async META (req, res, server) {
    const isView = this._isView(req.path);

    if (isView) {
      const result = await server._GET(req.path);
      if (!result) return res.status(404).json({ status: 'error', message: `${this.name} not found` });

      const body = JSON.stringify(result);
      const hash = crypto.createHash('sha256').update(body).digest('hex');
      return res.json({
        '@type': 'FabricItemMeta',
        '@resource': this.name,
        '@path': req.path,
        '@size': Buffer.byteLength(body),
        '@hash': hash,
        '@schema': this._schemaHash
      });
    }

    // Collection-level META.
    const raw = await server._GET(this.routes.list);
    const list = raw ? (Array.isArray(raw) ? raw : Object.values(raw)) : [];
    const body = JSON.stringify(list);
    const merkle = crypto.createHash('sha256').update(body).digest('hex');

    return res.json({
      '@type': 'FabricCollectionMeta',
      '@resource': this.name,
      '@path': this.routes.list,
      '@count': list.length,
      '@merkle': merkle,
      '@schema': this._schemaHash,
      '@routes': this.routes
    });
  }

  // ─── Internal ──────────────────────────────────────────────────────────────

  _isView (path) {
    // A view path has a segment after the plural base.
    return path !== this.routes.list && path.startsWith(`/${this.plural}/`);
  }
}

module.exports = Resource;
