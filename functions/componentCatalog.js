'use strict';

/**
 * Handle → component class catalog.
 * Requiring a component module registers its handle. Page Jade names those
 * handles; it does not restate the component's markup.
 */

const catalog = new Map();

/**
 * @param {Function} Component
 * @param {string} handle
 * @param {Object} [defaults]
 * @returns {Function}
 */
function registerComponent (Component, handle, defaults) {
  if (typeof Component !== 'function') {
    throw new TypeError('registerComponent: Component must be a function');
  }
  if (!handle) throw new TypeError('registerComponent: handle is required');
  const name = String(handle);
  catalog.set(name, {
    Component: Component,
    defaults: Object.assign({ handle: name }, defaults || {})
  });
  return Component;
}

/**
 * @param {string} handle
 * @returns {{ Component: Function, defaults: Object }|null}
 */
function getComponent (handle) {
  if (!handle) return null;
  return catalog.get(String(handle)) || null;
}

/**
 * @param {Object} [definition]
 * @param {Object} [definition.components]
 * @param {string} [definition.components.list]
 * @param {string} [definition.components.view]
 */
function assertKnownComponents (definition) {
  const components = definition && definition.components;
  if (!components || typeof components !== 'object') return;
  for (const key of ['list', 'view']) {
    const handle = components[key];
    if (!handle) continue;
    if (!catalog.has(String(handle))) {
      throw new Error('Unknown component: ' + handle);
    }
  }
}

/**
 * @param {*} value
 * @returns {string}
 */
function escapeHtml (value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = {
  assertKnownComponents,
  escapeHtml,
  getComponent,
  registerComponent
};
