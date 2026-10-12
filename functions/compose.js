'use strict';

const fs = require('fs');
const path = require('path');

const pug = require('pug');
const lexer = require('pug-lexer');

const { getComponent } = require('./componentCatalog');

const PATH_EXPRESSION = /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/;
const FORBIDDEN_PATH = /(^|\.)(__proto__|constructor|prototype)(\.|$)/;

/** Tags that describe layout, not a required component module. */
const STRUCTURAL = new Set([
  'a', 'article', 'body', 'button', 'code', 'div', 'doctype', 'em', 'footer',
  'form', 'h1', 'h2', 'h3', 'head', 'header', 'html', 'i', 'li', 'link', 'meta',
  'nav', 'p', 'script', 'section', 'span', 'strong', 'title', 'ul',
  'fabric-application', 'fabric-column', 'fabric-grid', 'fabric-site',
  'box', 'grid', 'list', 'screen', 'textbox'
]);

const REJECTED_TOKENS = new Set([
  'case', 'call', 'each-else', 'else', 'else-if', 'filter', 'if', 'mixin', 'when', 'while'
]);

function renderPug (source, locals) {
  const warn = console.warn;
  console.warn = function () {
    const text = Array.prototype.join.call(arguments, ' ');
    if (text.includes('.jade extension is deprecated')) return;
    return warn.apply(console, arguments);
  };
  try {
    return pug.render(source, locals);
  } finally {
    console.warn = warn;
  }
}

/**
 * Compile a Jade/Pug template to HTML.
 * Unbuffered code, unescaped interpolation, filters, and includes outside
 * `basedir` are rejected. `script` bodies cannot interpolate state. Script
 * tags in the document body are placed after the bundle script.
 *
 * @param {string} source
 * @param {Object} [state]
 * @param {Object} [options]
 * @param {string} [options.basedir]
 * @param {string} [options.filename]
 * @returns {string}
 */
function compose (source, state, options) {
  if (typeof source !== 'string') throw new TypeError('compose: source must be a string');
  const opts = options || {};
  const basedir = path.resolve(opts.basedir || process.cwd());
  const filename = path.resolve(opts.filename || path.join(basedir, 'inline.jade'));
  lintSource(source, filename, basedir, new Set([filename]));

  const locals = Object.assign(Object.create(null), state || {});
  locals.filename = filename;
  locals.basedir = basedir;
  locals.compileDebug = false;
  locals.cache = false;
  locals.self = false;

  const html = renderPug(source, locals);
  return hoistScripts(fillComponents(html, state || {}));
}

/**
 * @param {string} filename
 * @param {Object} [state]
 * @param {Object} [options]
 * @returns {string}
 */
function composeFile (filename, state, options) {
  const abs = path.resolve(filename);
  const basedir = path.resolve((options && options.basedir) || path.dirname(abs));
  return compose(fs.readFileSync(abs, 'utf8'), state, Object.assign({}, options, {
    basedir: basedir,
    filename: abs
  }));
}

/**
 * Replace the resource slot, leaving sibling regions in place.
 * @param {Document|Element} root
 * @param {string} html
 * @returns {Element|null}
 */
function fillContentSlot (root, html) {
  if (!root || typeof root.querySelector !== 'function') return null;
  const slot = root.querySelector('[data-slot="content"]');
  if (!slot) return null;
  slot.innerHTML = html;
  return slot;
}

/**
 * Load the reference UI components so their handles resolve.
 * Safe to call more than once.
 */
function loadReferenceComponents () {
  ensureDom();
  require('../components/history');
  require('../components/prompt');
  require('../components/peer-list');
  require('../components/menu');
  require('../components/debug');
  require('../components/button');
  require('../components/log-list');
  require('../components/resource-list');
  require('../components/resource-view');
}

function ensureDom () {
  if (typeof global.HTMLElement === 'function') return;
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  if (typeof global.window === 'undefined') global.window = dom.window;
  if (typeof global.document === 'undefined') global.document = dom.window.document;
  global.HTMLElement = dom.window.HTMLElement;
}

function lintSource (source, filename, basedir, seen) {
  assertInside(basedir, filename);
  let tokens;
  try {
    tokens = lexer(source, { filename: filename });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    throw new Error('compose: ' + error.message);
  }

  let scriptTag = false;
  let inScriptBody = false;

  for (const token of tokens) {
    if (REJECTED_TOKENS.has(token.type)) {
      throw new Error('compose: ' + token.type + ' is not allowed');
    }
    if (token.type === 'tag') {
      scriptTag = token.val === 'script';
      inScriptBody = false;
    }
    if (token.type === 'start-pipeless-text' && scriptTag) inScriptBody = true;
    if (token.type === 'end-pipeless-text') inScriptBody = false;

    if (token.type === 'code') {
      if (!token.buffer) throw new Error('compose: unbuffered code is not allowed');
      if (token.mustEscape === false) throw new Error('compose: unescaped interpolation is not allowed');
      assertPath(token.val);
    }
    if (token.type === 'interpolated-code') {
      if (token.mustEscape === false) throw new Error('compose: unescaped interpolation is not allowed');
      if (inScriptBody) throw new Error('compose: interpolation inside a script body is not allowed');
      assertPath(token.val);
    }
    if (token.type === 'text' && inScriptBody && String(token.val).includes('#{')) {
      throw new Error('compose: interpolation inside a script body is not allowed');
    }
    if (token.type === 'attribute') assertAttribute(token.val);
    if (token.type === 'each') assertPath(token.code);
    if (token.type === 'path') {
      const resolved = resolveInclude(filename, token.val, basedir);
      assertInside(basedir, resolved);
      if (!seen.has(resolved)) {
        seen.add(resolved);
        lintSource(fs.readFileSync(resolved, 'utf8'), resolved, basedir, seen);
      }
    }
  }
}

function assertPath (value) {
  const expr = String(value || '').trim();
  if (!PATH_EXPRESSION.test(expr) || FORBIDDEN_PATH.test(expr)) {
    throw new Error('compose: only property paths are allowed in expressions');
  }
}

function assertAttribute (value) {
  const expr = String(value == null ? '' : value).trim();
  if (isStringLiteral(expr)) return;
  assertPath(expr);
}

function isStringLiteral (expr) {
  if (expr.length < 2) return false;
  const quote = expr[0];
  if (quote !== '"' && quote !== "'") return false;
  if (expr[expr.length - 1] !== quote) return false;
  const body = expr.slice(1, -1);
  if (body.includes(quote)) return false;
  return true;
}

function resolveInclude (fromFile, request, basedir) {
  const raw = String(request || '').trim();
  const candidates = [];
  const add = (target) => {
    candidates.push(target);
    if (!target.endsWith('.jade') && !target.endsWith('.pug')) {
      candidates.push(target + '.jade');
      candidates.push(target + '.pug');
    }
  };
  if (path.isAbsolute(raw)) add(raw);
  else {
    add(path.resolve(path.dirname(fromFile), raw));
    add(path.resolve(basedir, raw));
  }
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  return path.resolve(candidates[0]);
}

function assertInside (basedir, filename) {
  const root = path.resolve(basedir);
  const target = path.resolve(filename);
  const rel = path.relative(root, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('compose: include outside basedir: ' + target);
  }
}

function fillComponents (html, state) {
  const replace = (match, name, attrs) => {
    if (STRUCTURAL.has(name)) return match;
    const entry = getComponent(name);
    if (!entry) throw new Error('Unknown component: ' + name);
    const inner = renderInner(entry, state);
    return '<' + name + (attrs || '') + '>' + inner + '</' + name + '>';
  };
  return html
    .replace(/<([A-Za-z][\w-]*)([^>]*)\/>/g, replace)
    .replace(/<([A-Za-z][\w-]*)([^>]*)>\s*<\/\1>/g, replace);
}

function renderInner (entry, state) {
  const settings = Object.assign({}, entry.defaults);
  let instance;
  try {
    instance = new entry.Component(settings);
  } catch (err) {
    instance = Object.create(entry.Component.prototype);
    instance.settings = settings;
    instance.items = [];
    instance._state = state || {};
  }
  if (!instance.settings) instance.settings = settings;
  if (typeof instance._getInnerHTML === 'function') {
    return String(instance._getInnerHTML.call(instance, state || {}));
  }
  if (typeof instance.render === 'function') {
    return String(instance.render.call(instance));
  }
  return '';
}

function hoistScripts (html) {
  const bodyMatch = html.match(/<body\b[^>]*>[\s\S]*<\/body>/i);
  if (!bodyMatch) return hoistFragment(html);
  const body = bodyMatch[0];
  const scripts = [];
  const stripped = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
    scripts.push(tag);
    return '';
  });
  if (!scripts.length) return html;
  const bundle = [];
  const rest = [];
  for (const tag of scripts) {
    if (/bundles\/browser(\.min)?\.js/.test(tag)) bundle.push(tag);
    else rest.push(tag);
  }
  const rebuilt = stripped.replace(/<\/body>/i, bundle.concat(rest).join('\n') + '\n</body>');
  return html.replace(body, rebuilt);
}

function hoistFragment (html) {
  const scripts = [];
  const stripped = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, (tag) => {
    scripts.push(tag);
    return '';
  });
  if (!scripts.length) return html;
  const bundle = [];
  const rest = [];
  for (const tag of scripts) {
    if (/bundles\/browser(\.min)?\.js/.test(tag)) bundle.push(tag);
    else rest.push(tag);
  }
  return stripped + bundle.concat(rest).join('\n');
}

module.exports = {
  compose,
  composeFile,
  fillContentSlot,
  loadReferenceComponents
};
