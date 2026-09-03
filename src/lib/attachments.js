const ATTACHMENT_MARKER = /\n*<!-- issue-note-attachments:([A-Za-z0-9+/=]+) -->\s*$/;

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

export function parseNoteBody(value = '') {
  if (typeof value !== 'string') value = '';
  const match = value.match(ATTACHMENT_MARKER);
  if (!match) return { body: value, attachments: [] };

  try {
    const decoded = JSON.parse(decodeBase64(match[1]));
    const attachments = Array.isArray(decoded)
      ? decoded.filter((item) => item?.name && item?.path && item?.sha)
      : [];
    return {
      body: value.slice(0, match.index).replace(/\n+$/, ''),
      attachments
    };
  } catch {
    return { body: value, attachments: [] };
  }
}

export function composeNoteBody(body, attachments) {
  if (!attachments?.length) return body;
  const metadata = attachments.map(({ name, type, path, sha, size, url }) => ({
    name,
    type: type || '',
    path,
    sha,
    size: Number(size) || 0,
    url: url || ''
  }));
  const marker = `<!-- issue-note-attachments:${encodeBase64(JSON.stringify(metadata))} -->`;
  return body ? `${body.replace(/\n+$/, '')}\n\n${marker}` : marker;
}
