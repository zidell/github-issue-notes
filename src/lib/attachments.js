const ATTACHMENT_COMMENT_MARKER = /\n*<!-- issue-note-attachment:([A-Za-z0-9+/=]+) -->\s*$/;

function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function markdownText(value) {
  return String(value).replace(/\s+/g, ' ').replace(/[\\[\]]/g, '\\$&');
}

function encodedPath(value) {
  return value.split('/').map(encodeURIComponent).join('/');
}

function isImage(attachment) {
  return attachment?.type?.startsWith('image/')
    || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(attachment?.name || '');
}

export function composeAttachmentComment(repo, attachment) {
  const fileUrl = `https://github.com/${repo}/raw/HEAD/${encodedPath(attachment.path)}`;
  const label = markdownText(attachment.name);
  const preview = isImage(attachment)
    ? `![${label}](${fileUrl})`
    : `[📎 ${label}](${fileUrl})`;
  const metadata = {
    version: 1,
    name: attachment.name,
    type: attachment.type || '',
    path: attachment.path,
    sha: attachment.sha,
    size: Number(attachment.size) || 0
  };
  return `${preview}\n\n<!-- issue-note-attachment:${encodeBase64(JSON.stringify(metadata))} -->`;
}

export function parseAttachmentComment(comment) {
  const match = String(comment?.body || '').match(ATTACHMENT_COMMENT_MARKER);
  if (!match) return null;

  try {
    const metadata = JSON.parse(decodeBase64(match[1]));
    if (metadata?.version !== 1 || !metadata.name || !metadata.path) return null;
    return {
      ...metadata,
      commentId: comment.id,
      commentUrl: comment.html_url
    };
  } catch {
    return null;
  }
}
