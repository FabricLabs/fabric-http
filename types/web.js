'use strict';

/**
 * Main package export (`require('@fabric/http')`):
 * - **Server** — `FabricHTTPServer` class; all framework helpers are `static` methods on it (Accept / SPA,
 *   package `assets/`, sample `OPTIONS` probe).
 * - **resolveAppAssetsDir** — path to an app’s static `assets/` (not the package tree); for app wiring only.
 * - **constants** — numeric and string literals from `constants.js` (no functions).
 */
const path = require('path');
const Server = require('./server');
const Client = require('./client');
const SPA = require('./spa');
const Avatar = require('./avatar');
const FabricAvatar = require('../components/FabricAvatar');

/**
 * Resolves a static `assets/` directory for apps that ship next to a Node entry (e.g. `services/hub.js`).
 * Prefer an explicit app root from the environment (packaged apps, test overrides) so `process.cwd()` does not
 * have to be the repository root.
 *
 * @param {string} moduleDirname - `__dirname` of the file that is one segment below the repo root
 * @param {{ envVar?: string, subdir?: string }} [opts] - `envVar` names `process.env[envVar]` as the app root; `subdir` is appended (default `assets`).
 * @returns {string}
 */
function resolveAppAssetsDir (moduleDirname, opts) {
  const o = opts || {};
  const ev = o.envVar != null ? String(o.envVar) : 'FABRIC_APP_ROOT';
  const sub = o.subdir != null ? String(o.subdir) : 'assets';
  if (process.env[ev]) {
    return path.join(String(process.env[ev]), sub);
  }
  return path.join(path.resolve(moduleDirname), '..', sub);
}

module.exports = {
  Server: Server,
  Client: Client,
  Avatar: Avatar,
  FabricAvatar: FabricAvatar,
  App: SPA,
  SPA: SPA,
  Site: SPA,
  constants: require('../constants'),
  resolveAppAssetsDir
};
