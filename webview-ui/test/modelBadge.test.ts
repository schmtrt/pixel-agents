import { describe, expect, it } from 'vitest';

import { modelBadge } from '../src/office/modelBadge.js';

describe('modelBadge', () => {
  it('maps known model families', () => {
    expect(modelBadge('claude-opus-4-1-20250805')).toBe('claude');
    expect(modelBadge('anthropic/claude-sonnet-4-5')).toBe('claude');
    expect(modelBadge('qwen-vllm/RadixArk/Qwen3.8-27B-NVFP4-BF16-LMHead')).toBe('qwen');
    expect(modelBadge('Qwen2.5-72B-Instruct')).toBe('qwen');
    expect(modelBadge('gemini-2.5-flash')).toBe('gemini');
    expect(modelBadge('google/gemini-2.0-flash')).toBe('gemini');
    expect(modelBadge('gpt-5o')).toBe('gpt');
    expect(modelBadge('openai/gpt-4.1')).toBe('gpt');
    expect(modelBadge('mistral-large-latest')).toBe('mistral');
    expect(modelBadge('meta-llama/Llama-4')).toBe('llama');
  });

  it('never matches a family name inside an unrelated word', () => {
    expect(modelBadge('foo1')).not.toBe('gpt');
    expect(modelBadge('moonshot-kimi')).not.toBe('qwen');
  });

  it('falls back to the last path segment for unknown models', () => {
    expect(modelBadge('myvendor/my-super-custom-model')).toBe('my-super-cust…');
    expect(modelBadge('custom-model')).toBe('custom-model');
  });

  it('returns null for absent or empty models', () => {
    expect(modelBadge(undefined)).toBeNull();
    expect(modelBadge(null)).toBeNull();
    expect(modelBadge('')).toBeNull();
  });
});
