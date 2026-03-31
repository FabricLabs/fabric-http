'use strict';

const { JSDOM } = require('jsdom');

/**
 * Asserts the string is parseable HTML with a document that looks like HTML5.
 * Does not replace a full W3C validator; catches missing doctype / broken structure.
 * @param {string} html
 * @param {Object} [options]
 * @param {boolean} [options.requireDoctype=true]
 * @throws {Error} if checks fail
 */
function assertHtml5LikeDocument (html, options = {}) {
  const requireDoctype = options.requireDoctype !== false;
  if (typeof html !== 'string' || !html.trim()) {
    throw new Error('HTML body is empty');
  }
  if (requireDoctype && !/<!DOCTYPE\s+html/i.test(html)) {
    throw new Error('Expected <!DOCTYPE html> for HTML5 documents');
  }
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  if (!doc || !doc.documentElement) {
    throw new Error('Document has no documentElement');
  }
  const root = doc.documentElement;
  if (root.tagName !== 'HTML') {
    throw new Error(`Expected <html> root, got <${root.tagName}>`);
  }
  return doc;
}

module.exports = { assertHtml5LikeDocument };
