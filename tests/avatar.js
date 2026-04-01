'use strict';

const assert = require('assert');
const Avatar = require('../types/avatar');
const Web = require('../types/web');
const FabricAvatar = require('../components/FabricAvatar');

describe('@fabric/http/types/avatar', function () {
  it('exports Avatar on web aggregate', function () {
    assert.strictEqual(typeof Web.Avatar, 'function');
    assert.strictEqual(typeof Web.FabricAvatar, 'function');
  });

  it('is deterministic for the same input', function () {
    const a = new Avatar('alice@example.edu', { size: 96 });
    const b = new Avatar('alice@example.edu', { size: 96 });
    assert.strictEqual(a.toSVG(), b.toSVG());
  });

  it('changes output for different identities', function () {
    const a = new Avatar('alice@example.edu', { size: 96 });
    const b = new Avatar('bob@example.edu', { size: 96 });
    assert.notStrictEqual(a.toSVG(), b.toSVG());
  });

  it('produces an SVG and data URI', function () {
    const avatar = new Avatar('fabric://peer/test', { size: 72 });
    const svg = avatar.toSVG();
    const uri = avatar.toDataURI();
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('Fabric Avatar'));
    assert.ok(svg.includes('width="72"'));
    assert.ok(uri.startsWith('data:image/svg+xml;utf8,'));
  });

  it('renders consumable HTML img snippet', function () {
    const avatar = new Avatar('fabric://peer/test', { size: 64 });
    const html = avatar.render();
    assert.ok(html.startsWith('<img'));
    assert.ok(html.includes('class="fabric-avatar"'));
    assert.ok(html.includes('data:image/svg+xml;utf8,'));
  });

  it('supports direct svg snippet rendering', function () {
    const avatar = new Avatar('fabric://peer/test', { size: 64 });
    const html = avatar.render({ format: 'svg' });
    assert.ok(html.startsWith('<svg'));
  });

  it('provides deterministic ASCII output for text-side comparison', function () {
    const a = new Avatar('alice@example.edu', { cells: 9, steps: 96 });
    const b = new Avatar('alice@example.edu', { cells: 9, steps: 96 });
    const c = new Avatar('bob@example.edu', { cells: 9, steps: 96 });

    const asciiA = a.toASCII();
    const asciiB = b.toASCII();
    const asciiC = c.toASCII();

    assert.strictEqual(asciiA, asciiB);
    assert.notStrictEqual(asciiA, asciiC);
    assert.ok(asciiA.includes('\n'));
  });

  it('exposes board values for academic visual-hash inspection', function () {
    const avatar = Avatar.from('did:fabric:abc123', { cells: 9, steps: 64 });
    const board = avatar.board;
    assert.strictEqual(Array.isArray(board), true);
    assert.strictEqual(board.length, 9);
    assert.strictEqual(board[0].length, 9);
    // origin should always be marked
    assert.ok(board[4][4] > 0);
  });

  it('exports FabricAvatar component class', function () {
    assert.strictEqual(typeof FabricAvatar, 'function');
  });
});
