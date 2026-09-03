'use strict';

/**
 * Resolve `--wallet` / `--wallet=` from argv before Commander parse.
 * Scanning stops at a standalone `--` terminator. Empty `--wallet=` falls
 * back to `fallback`. `--wallet --flag` / `--wallet -p` is not a path.
 * Dash-prefixed filenames still work via `--wallet=VALUE`.
 *
 * @param {string[]} argv
 * @param {string} fallback
 * @returns {string}
 */
function walletPathFromArgv (argv, fallback) {
  const list = Array.isArray(argv) ? argv : [];
  const terminator = list.indexOf('--');
  const scan = terminator >= 0 ? list.slice(0, terminator) : list;
  const def = fallback == null ? '' : String(fallback);
  const inline = scan.find((a) => String(a).startsWith('--wallet='));
  if (inline) {
    const v = String(inline).slice('--wallet='.length);
    return v || def;
  }
  const i = scan.indexOf('--wallet');
  if (i >= 0 && i + 1 < scan.length) {
    const next = String(scan[i + 1]);
    if (!next.startsWith('-')) return next;
  }
  return def;
}

module.exports = {
  walletPathFromArgv
};
