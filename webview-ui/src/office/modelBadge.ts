/**
 * Map a provider-reported model id to the short badge shown on a character.
 * Pure and DOM-free so it stays unit-testable without a canvas.
 */
export function modelBadge(model: string | null | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.includes('qwen')) return 'qwen';
  if (m.includes('claude') || m.includes('anthropic')) return 'claude';
  if (m.includes('gemini') || m.includes('gemma')) return 'gemini';
  if (m.includes('gpt') || m.includes('openai')) return 'gpt';
  if (m.includes('mistral')) return 'mistral';
  if (m.includes('llama')) return 'llama';
  const seg = m.split('/').pop() ?? m;
  return seg.length > 14 ? `${seg.slice(0, 13)}…` : seg;
}
