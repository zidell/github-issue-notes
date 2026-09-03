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

export async function listIssues(token, repoInput, state = 'open', label = '') {
  const repo = normalizeRepo(repoInput);
  const params = new URLSearchParams({
    state,
    sort: 'updated',
    direction: 'desc',
    per_page: '100'
  });
  if (label) params.set('labels', label);
  const data = await request(
    `/repos/${repo}/issues?${params}`,
    token
  );
  return issueOnly(data);
}

export async function searchIssues(token, repoInput, state, term, label = '') {
  const repo = normalizeRepo(repoInput);
  const labelQuery = label ? ` label:${JSON.stringify(label)}` : '';
  const query = `${term.trim()} repo:${repo} is:issue is:${state} in:title,body${labelQuery}`;
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
    body: JSON.stringify({ title: note.title, body: note.body, labels: note.labels || [] })
  });
}

export function updateIssue(token, repoInput, issueNumber, note) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/issues/${issueNumber}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ title: note.title, body: note.body, labels: note.labels || [] })
  });
}

export async function listLabels(token, repoInput) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/labels?per_page=100`, token);
}

export async function createLabel(token, repoInput, name) {
  const repo = normalizeRepo(repoInput);
  try {
    return await request(`/repos/${repo}/labels`, token, {
      method: 'POST',
      body: JSON.stringify({ name, color: '4f46e5' })
    });
  } catch (reason) {
    // 라벨 목록이 오래된 동안 다른 창에서 같은 라벨을 만든 경우 기존 라벨을 사용한다.
    if (reason?.status === 422) {
      return request(`/repos/${repo}/labels/${encodeURIComponent(name)}`, token);
    }
    throw reason;
  }
}

export async function renameLabel(token, repoInput, currentName, newName) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/labels/${encodeURIComponent(currentName)}`, token, {
    method: 'PATCH',
    body: JSON.stringify({ new_name: newName })
  });
}

export async function removeLabel(token, repoInput, name) {
  const repo = normalizeRepo(repoInput);
  return request(`/repos/${repo}/labels/${encodeURIComponent(name)}`, token, {
    method: 'DELETE'
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

function issueAttachmentDirectory(issueNumber) {
  const normalizedNumber = Number(issueNumber);
  if (!Number.isInteger(normalizedNumber) || normalizedNumber <= 0) {
    throw new Error('첨부하기 전에 이슈 번호가 필요합니다.');
  }
  return `.issue-note-assets/issues/${normalizedNumber}`;
}

export async function uploadAttachment(token, repoInput, issueNumber, file) {
  const repo = normalizeRepo(repoInput);
  const unique = crypto.randomUUID();
  const path = `${issueAttachmentDirectory(issueNumber)}/${unique}-${safeFileName(file.name)}`;
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
    sha: result.content.sha,
    size: result.content.size,
    url: result.content.html_url
  };
}

export async function listIssueAttachmentFiles(token, repoInput, issueNumber) {
  const repo = normalizeRepo(repoInput);
  const directory = issueAttachmentDirectory(issueNumber);
  const encodedPath = directory.split('/').map(encodeURIComponent).join('/');
  try {
    const result = await request(`/repos/${repo}/contents/${encodedPath}`, token);
    return Array.isArray(result)
      ? result.filter((item) => item.type === 'file').map((item) => ({
          name: item.name,
          path: item.path,
          sha: item.sha,
          size: item.size,
          url: item.html_url
        }))
      : [];
  } catch (reason) {
    if (reason?.status === 404) return [];
    throw reason;
  }
}

export async function downloadAttachment(token, repoInput, attachment) {
  const repo = normalizeRepo(repoInput);
  const encodedPath = attachment.path.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`${API_ROOT}/repos/${repo}/contents/${encodedPath}`, {
    cache: 'no-store',
    headers: {
      ...headers(token),
      Accept: 'application/vnd.github.raw+json'
    }
  });

  if (!response.ok) {
    const error = new Error(response.statusText || '첨부 파일을 불러오지 못했습니다.');
    error.status = response.status;
    throw error;
  }
  return response.blob();
}

export async function deleteAttachment(token, repoInput, attachment) {
  const repo = normalizeRepo(repoInput);
  const encodedPath = attachment.path.split('/').map(encodeURIComponent).join('/');
  return request(`/repos/${repo}/contents/${encodedPath}`, token, {
    method: 'DELETE',
    body: JSON.stringify({
      message: `Delete Issue Note attachment: ${attachment.name}`,
      sha: attachment.sha
    })
  });
}
