'use strict';

/**
 * Main package export (`require('@fabric/http')`):
 * - **Server** — `FabricHTTPServer` class; the same module also exports `resolveFabricHttpPackageAssetsDir`
 *   and `acceptFirstHtmlNavigation` (Fomantic **Fabric** theme `assets/`, SPA HTML `Accept` gate) — re-exported here.
 * - **resolveAppAssetsDir** — path to an app’s static `assets/` (not the package tree); for app wiring only.
 * - **constants** — numeric and string literals from `constants.js` (no functions).
 */
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
  const normalizedSub = String(sub).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  if (!normalizedSub || normalizedSub.includes('..') || normalizedSub.includes('\0')) {
    throw new Error('resolveAppAssetsDir: subdir must be a relative safe path segment');
  }
  const envRoot = process.env[ev] ? String(process.env[ev]) : '';
  const rawBase = (envRoot || `${String(moduleDirname).replace(/\\/g, '/')}/..`).replace(/\/+$/g, '');
  const segments = rawBase.split('/').filter(Boolean);
  const reduced = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg === '.' || seg === '') continue;
    if (seg === '..') {
      reduced.pop();
      continue;
    }
    reduced.push(seg);
  }
  const prefix = rawBase.startsWith('/') ? '/' : '';
  const base = `${prefix}${reduced.join('/')}`;
  return `${base}/${normalizedSub}`;
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
  resolveAppAssetsDir,
  resolveFabricHttpPackageAssetsDir: Server.resolveFabricHttpPackageAssetsDir,
  acceptFirstHtmlNavigation: Server.acceptFirstHtmlNavigation
};
