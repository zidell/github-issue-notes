import { describe, expect, it } from 'vitest';
import { tagColorForName } from './colors.js';

describe('tagColorForName', () => {
  it('같은 태그 이름에는 항상 같은 GitHub hex 색상을 만든다', () => {
    expect(tagColorForName('여행')).toBe(tagColorForName('여행'));
    expect(tagColorForName('여행')).toMatch(/^[0-9a-f]{6}$/);
  });

  it('글자와 순서가 다른 태그를 색상환에 분산한다', () => {
    const colors = ['여행', '업무', '아이디어', '읽을거리', '개인'].map(tagColorForName);
    expect(new Set(colors).size).toBe(colors.length);
    expect(tagColorForName('ab')).not.toBe(tagColorForName('ba'));
  });
});
