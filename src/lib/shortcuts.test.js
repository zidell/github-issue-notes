import { describe, expect, it } from 'vitest';
import { isNewNoteShortcut } from './shortcuts.js';

describe('isNewNoteShortcut', () => {
  it('accepts platform shortcuts and the browser-safe Alt variant', () => {
    expect(isNewNoteShortcut({ key: 'n', code: 'KeyN', ctrlKey: true })).toBe(true);
    expect(isNewNoteShortcut({ key: 'n', code: 'KeyN', metaKey: true })).toBe(true);
    expect(isNewNoteShortcut({ key: 'Dead', code: 'KeyN', metaKey: true, altKey: true })).toBe(true);
  });

  it('rejects modified, repeated, and unrelated input', () => {
    expect(isNewNoteShortcut({ key: 'n', code: 'KeyN' })).toBe(false);
    expect(isNewNoteShortcut({ key: 'n', code: 'KeyN', metaKey: true, shiftKey: true })).toBe(false);
    expect(isNewNoteShortcut({ key: 'n', code: 'KeyN', metaKey: true, repeat: true })).toBe(false);
    expect(isNewNoteShortcut({ key: 's', code: 'KeyS', metaKey: true })).toBe(false);
  });
});
