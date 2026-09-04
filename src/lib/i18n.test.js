import { describe, expect, it } from 'vitest';
import { dtrans } from './i18n.js';

describe('dtrans', () => {
  it('한국어 브라우저에는 첫 번째 인자를 반환한다', () => {
    expect(dtrans('목록', 'List', 'ko-KR')).toBe('목록');
    expect(dtrans('목록', 'List', 'ko')).toBe('목록');
  });

  it('그 밖의 언어와 언어 정보가 없는 환경에서는 영어를 반환한다', () => {
    expect(dtrans('목록', 'List', 'en-US')).toBe('List');
    expect(dtrans('목록', 'List', 'ja-JP')).toBe('List');
    expect(dtrans('목록', 'List', '')).toBe('List');
  });
});
