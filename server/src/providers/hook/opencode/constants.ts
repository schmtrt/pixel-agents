/**
 * OpenCode-specific constants.
 *
 * Keep provider constants in their own directory so a
 * future single-provider `server/` build doesn't accidentally depend on
 * another provider's constants.
 *
 * Adding another provider? Create its own `providers/<kind>/<name>/constants.ts`.
 */

/** Wire provider id (must match the URL segment in POST /api/hooks/:providerId). */
export const OPENCODE_PROVIDER_ID = 'opencode';

/** Terminal name prefix used when the VS Code surface launches agents. */
export const OPENCODE_TERMINAL_NAME_PREFIX = 'OpenCode';

/** Global plugin auto-discovery directory name under opencode's config home. */
export const OPENCODE_PLUGIN_DIR_NAME = 'plugin';

/** Plugin file name inside the auto-discovery directory. */
export const OPENCODE_PLUGIN_FILENAME = 'pixel-agents.js';

/** Bundled build artifact name (dist/hooks/<name>). */
export const OPENCODE_PLUGIN_SCRIPT_NAME = 'opencode-plugin.js';

/** Marker the installer checks before treating a file at the target path as ours. */
export const OPENCODE_PLUGIN_MARKER = 'pixel-agents opencode plugin';
