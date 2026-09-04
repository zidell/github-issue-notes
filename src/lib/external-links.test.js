import { afterEach, describe, expect, it, vi } from 'vitest';
import { externalLinkTarget, isStandaloneWebApp } from './external-links.js';

const originalWindow = globalThis.window;

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow
  });
});

function setWebAppEnvironment(matches) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      navigator: { standalone: false },
      matchMedia: vi.fn(() => ({ matches }))
    }
  });
}

describe('standalone web app links', () => {
  it('standalone display mode에서는 새 탭 대상을 지정하지 않는다', () => {
    setWebAppEnvironment(true);

    expect(isStandaloneWebApp()).toBe(true);
    expect(externalLinkTarget()).toBeUndefined();
  });

  it('일반 브라우저에서는 새 탭으로 연다', () => {
    setWebAppEnvironment(false);

    expect(isStandaloneWebApp()).toBe(false);
    expect(externalLinkTarget()).toBe('_blank');
  });
});
