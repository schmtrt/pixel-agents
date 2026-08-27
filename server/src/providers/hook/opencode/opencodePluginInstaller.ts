/**
 * Installer for the OpenCode plugin file.
 *
 * OpenCode auto-discovers plugins in `{plugin,plugins}/*.{js,ts}` of every
 * config directory, which includes the global config home
 * (~/.config/opencode on a standard XDG setup). Installing therefore means
 * copying ONE file into ~/.config/opencode/plugin/ — no opencode config file
 * is parsed, rewritten, or backed up, which removes whole classes of the
 * corruption risks the Claude settings-file installer has to guard against.
 *
 * We still keep the "never delete what we did not author" rule: a file at
 * the target path is only ever removed if it carries our marker banner.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  OPENCODE_PLUGIN_DIR_NAME,
  OPENCODE_PLUGIN_FILENAME,
  OPENCODE_PLUGIN_MARKER,
  OPENCODE_PLUGIN_SCRIPT_NAME,
} from './constants.js';

/** ~/.config/opencode — opencode's global config home. Overridable for tests. */
export function getOpencodeConfigHome(env: NodeJS.ProcessEnv = process.env): string {
  if (env['XDG_CONFIG_HOME'] && env['XDG_CONFIG_HOME'].length > 0) {
    return path.join(env['XDG_CONFIG_HOME'], 'opencode');
  }
  return path.join(os.homedir(), '.config', 'opencode');
}

export function getPluginTargetPath(env?: NodeJS.ProcessEnv): string {
  return path.join(getOpencodeConfigHome(env), OPENCODE_PLUGIN_DIR_NAME, OPENCODE_PLUGIN_FILENAME);
}

function readHead(p: string, bytes = 512): string | null {
  try {
    const fd = fs.openSync(p, 'r');
    try {
      const buf = Buffer.alloc(bytes);
      const read = fs.readSync(fd, buf, 0, bytes, 0);
      return buf.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return null;
  }
}

/** True when the target exists AND is ours (carries the marker banner). */
function isOurPluginFile(p: string): boolean {
  if (!fs.existsSync(p)) return false;
  const head = readHead(p);
  return head !== null && head.includes(OPENCODE_PLUGIN_MARKER);
}

/**
 * Copy the bundled plugin from <packageRoot>/dist/hooks/ to the opencode
 * plugin auto-discovery directory. Returns true on success, false when the
 * source is missing or the copy failed — callers report the failure instead
 * of logging a false success (same contract as claude's copyHookScript).
 */
export function copyPluginScript(packageRoot: string): boolean {
  const src = path.join(packageRoot, 'dist', 'hooks', OPENCODE_PLUGIN_SCRIPT_NAME);
  const dst = getPluginTargetPath();
  const dstDir = path.dirname(dst);

  try {
    if (!fs.existsSync(src)) {
      console.warn(`[Pixel Agents] OpenCode plugin not found at ${src}`);
      return false;
    }
    if (!fs.existsSync(dstDir)) {
      fs.mkdirSync(dstDir, { recursive: true });
    }
    fs.copyFileSync(src, dst);
    fs.chmodSync(dst, 0o644);
    console.log(`[Pixel Agents] OpenCode plugin installed at ${dst}`);
    return true;
  } catch (e) {
    console.error(`[Pixel Agents] Failed to copy OpenCode plugin: ${e}`);
    return false;
  }
}

/**
 * Provider-side install: verify the staged plugin is in place. The actual
 * copy happens in the surface's copy step (cli.ts / VS Code adapter), which
 * is the only place that knows the package root.
 */
export async function installHooks(): Promise<void> {
  const dst = getPluginTargetPath();
  if (!isOurPluginFile(dst)) {
    throw new Error(
      `OpenCode plugin is not staged at ${dst} — the bundled copy step did not run. ` +
        `Re-run install from the pixel-agents CLI (the copy needs the dist/ directory).`,
    );
  }
}

/**
 * Remove the plugin file — but ONLY if it carries our marker. A user-authored
 * file (or a file another tool put there) at the same path is left in place.
 */
export async function uninstallHooks(): Promise<void> {
  const dst = getPluginTargetPath();
  if (!isOurPluginFile(dst)) return;
  fs.rmSync(dst, { force: true });
  console.log(`[Pixel Agents] OpenCode plugin removed from ${dst}`);
}

export function areHooksInstalled(): boolean {
  return isOurPluginFile(getPluginTargetPath());
}
