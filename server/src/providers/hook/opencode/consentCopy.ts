/**
 * OpenCode's first-run consent disclosure. The strings are served verbatim
 * through the provider's consentDisclosure() into the Intro; keep them
 * factual (what we write, where, what data flows, how to undo).
 */

export const CONSENT_INSTALL_HEADLINE = 'OpenCode integration';

export const CONSENT_DISCLOSURE = [
  'What we will do:',
  '',
  '• Copy one plugin file to ~/.config/opencode/plugin/pixel-agents.js',
  '  (opencode auto-loads plugins from that directory; no opencode config',
  '  file is edited or rewritten).',
  '',
  'What that plugin reports to the local pixel-agents server (127.0.0.1,',
  'bearer-token authenticated, never any other host):',
  '',
  '• when an opencode session starts or ends (session id + working directory)',
  '• which tool the agent runs and with which arguments (file paths, commands)',
  '• when a permission prompt is shown and when a turn ends (waiting for input)',
  '',
  'No prompts, conversation text, model output, or secrets are sent.',
  '',
  'Undo: toggle this setting off in pixel-agents Settings (deletes the file),',
  'or delete ~/.config/opencode/plugin/pixel-agents.js yourself.',
].join('\n');
