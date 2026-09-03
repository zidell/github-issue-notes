import { describe, expect, it } from 'vitest';
import { composeAttachmentComment, parseAttachmentComment } from './attachments.js';

const imageAttachment = {
  name: '여행 사진 [1].png',
  type: 'image/png',
  path: '.issue-note-assets/issues/31/id-여행 사진.png',
  sha: 'abc123',
  size: 2048
};

describe('attachment comment metadata', () => {
  it('이미지 미리보기와 메타데이터를 담은 댓글을 만든다', () => {
    const body = composeAttachmentComment('owner/private-notes', imageAttachment);

    expect(body).toContain('![여행 사진 \\[1\\].png]');
    expect(body).toContain('owner/private-notes/raw/HEAD/');
    expect(body).toContain('%EC%97%AC%ED%96%89%20%EC%82%AC%EC%A7%84.png');
    expect(body).toMatch(/<!-- issue-note-attachment:[A-Za-z0-9+/=]+ -->$/);
  });

  it('일반 파일은 링크로 표시한다', () => {
    const body = composeAttachmentComment('owner/repo', {
      ...imageAttachment,
      name: 'plan.pdf',
      type: 'application/pdf'
    });

    expect(body).toContain('[📎 plan.pdf](');
    expect(body).not.toContain('![plan.pdf](');
  });

  it('생성한 댓글을 첨부 정보로 손실 없이 복원한다', () => {
    const parsed = parseAttachmentComment({
      id: 987,
      html_url: 'https://github.com/owner/repo/issues/31#issuecomment-987',
      body: composeAttachmentComment('owner/repo', imageAttachment)
    });

    expect(parsed).toEqual({
      version: 1,
      ...imageAttachment,
      commentId: 987,
      commentUrl: 'https://github.com/owner/repo/issues/31#issuecomment-987'
    });
  });

  it('손상되거나 지원하지 않는 마커는 무시한다', () => {
    const wrongVersion = btoa(JSON.stringify({
      version: 2,
      name: 'photo.png',
      path: '.issue-note-assets/issues/31/photo.png'
    }));

    expect(parseAttachmentComment({ body: '일반 댓글' })).toBeNull();
    expect(parseAttachmentComment({ body: '<!-- issue-note-attachment:not-base64! -->' })).toBeNull();
    expect(parseAttachmentComment({ body: `<!-- issue-note-attachment:${wrongVersion} -->` })).toBeNull();
  });

  it('마커 뒤에 다른 본문이 있으면 전용 첨부 댓글로 보지 않는다', () => {
    const body = `${composeAttachmentComment('owner/repo', imageAttachment)}\n추가 문장`;
    expect(parseAttachmentComment({ body })).toBeNull();
  });
});
