import { describe, expect, it } from 'vitest';
import { createId } from './create-id.js';

describe('createId', () => {
  it('is unique, prefixed, and a valid CSS identifier', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => createId('ms-option')));
    expect(ids.size).toBe(1000);
    for (const id of ids) {
      expect(id).toMatch(/^ms-option-[a-z0-9]+$/);
      expect(id).toMatch(/^[a-z][a-z0-9-]*$/); // starts with a letter: a valid CSS identifier
    }
    expect(createId()).toMatch(/^km-/);
  });
});
