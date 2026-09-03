const API_ROOT = 'https://api.github.com';

function headers(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function request(path, token, options = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    cache: 'no-store',
    ...options,
    headers: {
      ...headers(token),
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    let message = '';
    try {
      const payload = await response.json();
      message = payload.message || '';
    } catch {
      // GitHub가 빈 응답을 보내는 경우 상태 문구를 사용한다.
    }

    const error = new Error(message || response.statusText || 'GitHub 요청에 실패했습니다.');
    error.status = response.status;
    error.remaining = response.headers.get('x-ratelimit-remaining');
    error.reset = response.headers.get('x-ratelimit-reset');
    throw error;
  }

  if (response.status === 204) return null;
  return response.json();
}

function normalizeRepo(value) {
  const cleaned = value
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '');

  if (!/^[^/\s]+\/[^/\s]+$/.test(cleaned)) {
    throw new Error('저장소를 owner/repository 형식으로 입력해주세요.');
  }
  return cleaned;
}

function issueOnly(items) {
  return items.filter((item) => !item.pull_request);
}

export async function verifyConnection(token, repoInput) {
  const repo = normalizeRepo(repoInput);
  const [user, repository] = await Promise.all([
    request('/user', token),
    request(`/repos/${repo}`, token)
  ]);
  return { user, repository, repo };
}

export async function listIssues(token, repoInput, state = 'open') {
  const repo = normalizeRepo(repoInput);
  const data = await request(
    `/repos/${repo}/issues?state=${state}&sort=updated&direction=desc&per_page=100`,
    token
  );
  return issueOnly(data);
}

export async function searchIssues(token, repoInput, state, term) {
  const repo = normalizeRepo(repoInput);
  const query = `${term.trim()} repo:${repo} is:issue is:${state} in:title,body`;
  const data = await request(
    `/search/issues?q=${encodeURIComponent(query)}&sort=updated&order=desc&per_page=100`,
    token
  );
  return issueOnly(data.items);
}

export function createIssue(token, repoInput, note) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues`, token, {
    method: 'POST',
    body: JSON.stringify({ title: note.title, body: note.body })
  });
}

export function updateIssue(token, repoInput, issueNumber, note) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/${issueNumber}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ title: note.title, body: note.body })
  });
}

export function setIssueState(token, repoInput, issueNumber, state) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/${issueNumber}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ state })
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function safeFileName(name) {
  return name
    .normalize('NFC')
    .replace(/[\\/:*?"<>|#%]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'attachment';
}

export async function uploadAttachment(token, repoInput, file) {
  const repo = normalizeRepo(repoInput);
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const unique = crypto.randomUUID();
  const path = `.issue-note-assets/${year}/${month}/${unique}-${safeFileName(file.name)}`;
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const content = arrayBufferToBase64(await file.arrayBuffer());

  const result = await request(`/repos/${repo}/contents/${encodedPath}`, token, {
    method: 'PUT',
    body: JSON.stringify({
      message: `Add Issue Note attachment: ${file.name}`,
      content
    })
  });

  return {
    name: file.name,
    type: file.type,
    path,
    url: result.content.html_url
  };
}
