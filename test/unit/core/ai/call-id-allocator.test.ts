import { describe, expect, it } from 'vitest';
import { createCallIdAllocator } from '../../../../src/core/ai/call-id-allocator.js';

describe('createCallIdAllocator()', () => {
  it('starts each command-scoped sequence at ai-1', () => {
    const allocateCallId = createCallIdAllocator();

    expect(allocateCallId()).toBe('ai-1');
  });

  it('allocates monotonically increasing decimal identifiers', () => {
    const allocateCallId = createCallIdAllocator();

    expect(Array.from({ length: 12 }, () => allocateCallId())).toEqual([
      'ai-1',
      'ai-2',
      'ai-3',
      'ai-4',
      'ai-5',
      'ai-6',
      'ai-7',
      'ai-8',
      'ai-9',
      'ai-10',
      'ai-11',
      'ai-12',
    ]);
  });

  it('keeps independent allocator instances isolated', () => {
    const firstCommand = createCallIdAllocator();
    const secondCommand = createCallIdAllocator();

    expect(firstCommand()).toBe('ai-1');
    expect(firstCommand()).toBe('ai-2');
    expect(secondCommand()).toBe('ai-1');
    expect(firstCommand()).toBe('ai-3');
    expect(secondCommand()).toBe('ai-2');
  });
});
