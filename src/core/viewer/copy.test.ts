import { describe, expect, it } from 'vitest';
import { VIEW_COPY } from './copy.js';

describe('VIEW_COPY', () => {
  it('contains only non-empty strings at every leaf', () => {
    const visit = (value: unknown): void => {
      if (typeof value === 'string') {
        expect(value.trim().length).toBeGreaterThan(0);
        return;
      }
      expect(value).toBeTypeOf('object');
      expect(value).not.toBeNull();
      for (const child of Object.values(value as Record<string, unknown>)) visit(child);
    };

    visit(VIEW_COPY);
  });

  it('keeps representative list, detail, and error copy from the fixed table', () => {
    expect(VIEW_COPY.list.title).toBe('Runs');
    expect(VIEW_COPY.list.emptyState.line2).toBe('Run a test: ambercast run');
    expect(VIEW_COPY.detail.failedStep.screenshotOmitted).toBe('Screenshot omitted: secret detected');
    expect(VIEW_COPY.errorPages.forbidden.message).toBe('Host header not allowed');
  });
});
