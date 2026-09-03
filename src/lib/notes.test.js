import { describe, expect, it } from 'vitest';
import { automaticTitle, markdownToPlainText } from './notes.js';

describe('automaticTitle', () => {
  it('첫 줄의 앞뒤 공백을 제거해 제목으로 사용한다', () => {
    expect(automaticTitle('  첫 줄이 제목  \n두 번째 줄')).toBe('첫 줄이 제목');
  });

  it('기본값으로 첫 줄을 50자까지 자른다', () => {
    expect(automaticTitle('가'.repeat(60))).toBe('가'.repeat(50));
  });

  it('이모지를 잘못된 UTF-16 문자로 나누지 않는다', () => {
    const title = automaticTitle('📝'.repeat(51));
    expect(Array.from(title)).toHaveLength(50);
    expect(title).toBe('📝'.repeat(50));
  });

  it('빈 본문에는 빈 제목을 반환한다', () => {
    expect(automaticTitle(null)).toBe('');
    expect(automaticTitle('   \n두 번째 줄')).toBe('');
  });
});

describe('markdownToPlainText', () => {
  it('목록용 텍스트에서 Markdown 문법을 제거한다', () => {
    expect(markdownToPlainText('# **제목**\n- [x] [링크](https://example.com)와 `코드`'))
      .toBe('제목 링크와 코드');
  });

  it('이미지는 주소 대신 대체 텍스트만 남긴다', () => {
    expect(markdownToPlainText('![풍경](https://example.com/image.png) 다음 문장'))
      .toBe('풍경 다음 문장');
  });
});
