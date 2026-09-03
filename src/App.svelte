<script>
  import { onMount } from 'svelte';
  import {
    createIssue,
    listIssues,
    searchIssues,
    setIssueState,
    uploadAttachment,
    updateIssue,
    verifyConnection
  } from './lib/github.js';

  const STORAGE_KEY = 'issue-note.settings.v1';

  let token = '';
  let repo = '';
  let rememberToken = true;
  let connected = false;
  let user = null;
  let repository = null;
  let issues = [];
  let state = 'open';
  let query = '';
  let loading = false;
  let connecting = false;
  let saving = false;
  let error = '';
  let notice = '';
  let editorOpen = false;
  let editingIssue = null;
  let draftTitle = '';
  let draftBody = '';
  let editorError = '';
  let uploading = 0;
  let bodyTextarea;
  let fileInput;

  $: emptyMessage = query
    ? '검색 결과가 없습니다.'
    : state === 'open'
      ? '아직 작성한 노트가 없습니다.'
      : '휴지통이 비어 있습니다.';

  onMount(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      repo = saved.repo || '';
      token = saved.token || '';
      rememberToken = Boolean(saved.token);
      if (token && repo) connect(false);
    } catch {
      localStorage.removeItem(STORAGE_KEY);
    }
  });

  function persistSettings(normalizedRepo) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ repo: normalizedRepo, token: rememberToken ? token : '' })
    );
  }

  function friendlyError(reason) {
    if (reason?.status === 401) return 'PAT가 올바르지 않거나 폐기되었습니다.';
    if (reason?.status === 404) return '저장소를 찾을 수 없습니다. 이름과 PAT 권한을 확인해주세요.';
    if (reason?.status === 403 && reason?.remaining === '0') {
      return 'GitHub API 요청 한도에 도달했습니다. 잠시 후 다시 시도해주세요.';
    }
    if (reason?.status === 403) return '이 작업에 필요한 저장소 권한이 없습니다.';
    return reason?.message || '알 수 없는 오류가 발생했습니다.';
  }

  async function connect(showSuccess = true) {
    error = '';
    notice = '';
    connecting = true;
    try {
      const result = await verifyConnection(token.trim(), repo);
      token = token.trim();
      repo = result.repo;
      user = result.user;
      repository = result.repository;
      persistSettings(result.repo);
      connected = true;
      if (showSuccess) notice = 'GitHub 저장소에 연결했습니다.';
      await loadIssues();
    } catch (reason) {
      connected = false;
      error = friendlyError(reason);
    } finally {
      connecting = false;
    }
  }

  async function loadIssues() {
    error = '';
    loading = true;
    try {
      issues = query.trim()
        ? await searchIssues(token, repo, state, query)
        : await listIssues(token, repo, state);
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      loading = false;
    }
  }

  async function changeState(nextState) {
    if (state === nextState) return;
    state = nextState;
    query = '';
    await loadIssues();
  }

  function newNote() {
    editingIssue = null;
    draftTitle = '';
    draftBody = '';
    editorOpen = true;
    error = '';
    editorError = '';
  }

  function editNote(issue) {
    editingIssue = issue;
    draftTitle = issue.title;
    draftBody = issue.body || '';
    editorOpen = true;
    error = '';
    editorError = '';
  }

  function closeEditor() {
    if (saving || uploading) return;
    editorOpen = false;
    editingIssue = null;
  }

  async function saveNote() {
    if (!draftTitle.trim()) {
      editorError = '제목을 입력해주세요.';
      return;
    }

    saving = true;
    editorError = '';
    try {
      const note = { title: draftTitle.trim(), body: draftBody };
      if (editingIssue) {
        await updateIssue(token, repo, editingIssue.number, note);
        notice = '노트를 저장했습니다.';
      } else {
        await createIssue(token, repo, note);
        notice = '새 노트를 만들었습니다.';
      }
      editorOpen = false;
      editingIssue = null;
      await loadIssues();
    } catch (reason) {
      editorError = friendlyError(reason);
    } finally {
      saving = false;
    }
  }

  function markdownForAttachment(attachment) {
    const isImage = attachment.type.startsWith('image/');
    const label = attachment.name.replace(/[\[\]]/g, '');
    return isImage
      ? `![${label}](${attachment.url}?raw=1)`
      : `[${label}](${attachment.url})`;
  }

  function insertAtCursor(text) {
    const start = bodyTextarea?.selectionStart ?? draftBody.length;
    const end = bodyTextarea?.selectionEnd ?? start;
    const prefix = start > 0 && draftBody[start - 1] !== '\n' ? '\n\n' : '';
    const suffix = end < draftBody.length && draftBody[end] !== '\n' ? '\n\n' : '\n';
    const inserted = `${prefix}${text}${suffix}`;
    draftBody = `${draftBody.slice(0, start)}${inserted}${draftBody.slice(end)}`;

    requestAnimationFrame(() => {
      const cursor = start + inserted.length;
      bodyTextarea?.focus();
      bodyTextarea?.setSelectionRange(cursor, cursor);
    });
  }

  async function uploadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;

    editorError = '';
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        editorError = `“${file.name}”은 10MB를 초과하여 올리지 않았습니다.`;
        continue;
      }

      uploading += 1;
      try {
        const attachment = await uploadAttachment(token, repo, file);
        insertAtCursor(markdownForAttachment(attachment));
      } catch (reason) {
        editorError = reason?.status === 403
          ? '첨부하려면 PAT에 Contents: Read and write 권한이 필요합니다.'
          : friendlyError(reason);
      } finally {
        uploading -= 1;
      }
    }
    if (fileInput) fileInput.value = '';
  }

  function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    uploadFiles(files);
  }

  async function moveIssue(issue, nextState) {
    const action = nextState === 'closed' ? '휴지통으로 이동' : '복원';
    if (!confirm(`“${issue.title}” 노트를 ${action}할까요?`)) return;

    error = '';
    try {
      await setIssueState(token, repo, issue.number, nextState);
      issues = issues.filter((item) => item.id !== issue.id);
      notice = nextState === 'closed' ? '노트를 휴지통으로 이동했습니다.' : '노트를 복원했습니다.';
    } catch (reason) {
      error = friendlyError(reason);
    }
  }

  function openSettings() {
    connected = false;
    error = '';
    notice = '';
  }

  function forgetSettings() {
    if (!confirm('이 브라우저에 저장된 PAT와 저장소 설정을 삭제할까요?')) return;
    localStorage.removeItem(STORAGE_KEY);
    token = '';
    repo = '';
    user = null;
    repository = null;
    issues = [];
    connected = false;
    notice = '브라우저에 저장된 설정을 삭제했습니다.';
  }

  function excerpt(body) {
    const text = (body || '').replace(/\s+/g, ' ').trim();
    return text || '내용이 없습니다.';
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(value));
  }
</script>

{#if !connected}
  <main class="setup-shell container py-4 py-md-5">
    <section class="setup-card card border-0 shadow-sm mx-auto overflow-hidden">
      <div class="row g-0">
        <div class="col-lg-5 setup-intro p-4 p-md-5 text-white">
          <div class="brand-mark mb-4">IN</div>
          <p class="text-uppercase small fw-semibold opacity-75 mb-2">Serverless notes</p>
          <h1 class="display-6 fw-bold mb-3">Issue Note</h1>
          <p class="lead opacity-75 mb-0">
            GitHub Issues를 나만의 노트 저장소로 사용합니다.
          </p>
        </div>

        <div class="col-lg-7 bg-white p-4 p-md-5">
          <h2 class="h4 fw-bold mb-2">GitHub 저장소 연결</h2>
          <p class="text-secondary mb-4">
            PAT는 이 브라우저에서 GitHub API로만 전송됩니다.
          </p>

          {#if error}
            <div class="alert alert-danger" role="alert">{error}</div>
          {/if}
          {#if notice}
            <div class="alert alert-success" role="status">{notice}</div>
          {/if}

          <form on:submit|preventDefault={() => connect(true)}>
            <div class="mb-3">
              <label for="repo" class="form-label fw-semibold">노트 저장소</label>
              <input
                id="repo"
                class="form-control form-control-lg"
                bind:value={repo}
                placeholder="owner/repository"
                autocomplete="off"
                required
              />
            </div>

            <div class="mb-3">
              <label for="token" class="form-label fw-semibold">Fine-grained PAT</label>
              <input
                id="token"
                type="password"
                class="form-control form-control-lg font-monospace"
                bind:value={token}
                placeholder="github_pat_..."
                autocomplete="off"
                spellcheck="false"
                required
              />
              <div class="form-text">
                Issues 읽기·쓰기가 필요합니다. 파일 첨부를 사용하려면 Contents 읽기·쓰기도
                선택하세요.
              </div>
            </div>

            <div class="form-check mb-4">
              <input
                id="remember"
                class="form-check-input"
                type="checkbox"
                bind:checked={rememberToken}
              />
              <label class="form-check-label" for="remember">이 브라우저에 PAT 기억하기</label>
            </div>

            <button class="btn btn-primary btn-lg w-100" disabled={connecting}>
              {connecting ? '연결 확인 중…' : '연결하고 시작하기'}
            </button>
          </form>

          {#if localStorage.getItem(STORAGE_KEY)}
            <button class="btn btn-link text-danger w-100 mt-3" on:click={forgetSettings}>
              저장된 설정 삭제
            </button>
          {/if}
        </div>
      </div>
    </section>
  </main>
{:else}
  <div class="app-shell min-vh-100">
    <header class="navbar bg-white border-bottom sticky-top">
      <div class="container-fluid app-container py-2">
        <a class="navbar-brand fw-bold d-flex align-items-center gap-2" href="./">
          <span class="brand-mark brand-mark-sm">IN</span>
          Issue Note
        </a>
        <div class="d-flex align-items-center gap-2">
          <a
            class="btn btn-light btn-sm d-none d-sm-inline-flex"
            href={repository?.html_url}
            target="_blank"
            rel="noreferrer"
          >
            {repo}
          </a>
          <button class="btn btn-outline-secondary btn-sm" on:click={openSettings}>설정</button>
          {#if user}
            <img class="avatar" src={user.avatar_url} alt={user.login} />
          {/if}
        </div>
      </div>
    </header>

    <main class="container-fluid app-container py-4 py-md-5">
      <div class="d-flex flex-column flex-md-row align-items-md-end justify-content-between gap-3 mb-4">
        <div>
          <p class="eyebrow mb-1">{state === 'open' ? 'MY NOTES' : 'TRASH'}</p>
          <h1 class="h2 fw-bold mb-1">{state === 'open' ? '모든 노트' : '휴지통'}</h1>
          <p class="text-secondary mb-0">
            {state === 'open' ? '최근 수정한 노트부터 표시합니다.' : '닫힌 이슈를 보관합니다.'}
          </p>
        </div>
        {#if state === 'open'}
          <button class="btn btn-primary btn-lg px-4" on:click={newNote}>＋ 새 노트</button>
        {/if}
      </div>

      {#if error}
        <div class="alert alert-danger alert-dismissible" role="alert">
          {error}
          <button class="btn-close" aria-label="닫기" on:click={() => (error = '')}></button>
        </div>
      {/if}
      {#if notice}
        <div class="alert alert-success alert-dismissible" role="status">
          {notice}
          <button class="btn-close" aria-label="닫기" on:click={() => (notice = '')}></button>
        </div>
      {/if}

      <section class="toolbar card border-0 shadow-sm mb-4">
        <div class="card-body p-2 d-flex flex-column flex-md-row gap-2">
          <div class="btn-group flex-shrink-0" role="group" aria-label="노트 상태">
            <button
              class:active={state === 'open'}
              class="btn btn-light"
              on:click={() => changeState('open')}
            >노트</button>
            <button
              class:active={state === 'closed'}
              class="btn btn-light"
              on:click={() => changeState('closed')}
            >휴지통</button>
          </div>
          <form class="search-form flex-grow-1 d-flex gap-2" on:submit|preventDefault={loadIssues}>
            <input
              class="form-control border-0 bg-light"
              type="search"
              bind:value={query}
              placeholder="제목과 본문 검색"
              aria-label="노트 검색"
            />
            <button class="btn btn-dark px-4" disabled={loading}>검색</button>
            {#if query}
              <button
                type="button"
                class="btn btn-light"
                on:click={() => {
                  query = '';
                  loadIssues();
                }}
              >초기화</button>
            {/if}
          </form>
        </div>
      </section>

      {#if loading}
        <div class="empty-state text-center py-5">
          <div class="spinner-border text-primary mb-3" role="status"></div>
          <p class="text-secondary">GitHub에서 노트를 가져오는 중…</p>
        </div>
      {:else if issues.length === 0}
        <div class="empty-state card border-0 text-center py-5 px-3">
          <div class="empty-icon mx-auto mb-3">{state === 'open' ? '✎' : '♲'}</div>
          <h2 class="h5 fw-bold">{emptyMessage}</h2>
          {#if state === 'open' && !query}
            <p class="text-secondary mb-3">첫 번째 생각을 GitHub Issue에 기록해보세요.</p>
            <div><button class="btn btn-primary" on:click={newNote}>새 노트 작성</button></div>
          {/if}
        </div>
      {:else}
        <div class="notes-grid">
          {#each issues as issue (issue.id)}
            <article class="note-card card border-0 shadow-sm">
              <div class="card-body p-4 d-flex flex-column">
                <div class="d-flex align-items-start justify-content-between gap-3 mb-3">
                  <span class="issue-number">#{issue.number}</span>
                  <span class="small text-secondary">{formatDate(issue.updated_at)}</span>
                </div>
                <h2 class="h5 fw-bold mb-3">{issue.title}</h2>
                <p class="note-excerpt text-secondary mb-4">{excerpt(issue.body)}</p>
                <div class="mt-auto d-flex gap-2">
                  {#if state === 'open'}
                    <button class="btn btn-sm btn-primary flex-grow-1" on:click={() => editNote(issue)}>
                      열기
                    </button>
                    <button
                      class="btn btn-sm btn-outline-secondary"
                      title="휴지통으로 이동"
                      on:click={() => moveIssue(issue, 'closed')}
                    >휴지통</button>
                  {:else}
                    <button
                      class="btn btn-sm btn-outline-primary flex-grow-1"
                      on:click={() => moveIssue(issue, 'open')}
                    >복원</button>
                    <a
                      class="btn btn-sm btn-light"
                      href={issue.html_url}
                      target="_blank"
                      rel="noreferrer"
                    >GitHub</a>
                  {/if}
                </div>
              </div>
            </article>
          {/each}
        </div>
      {/if}
    </main>
  </div>
{/if}

{#if editorOpen}
  <div class="editor-backdrop" role="presentation" on:click={closeEditor}></div>
  <aside class="editor-panel shadow-lg" aria-label="노트 편집기">
    <form class="h-100 d-flex flex-column" on:submit|preventDefault={saveNote}>
      <header class="p-3 p-md-4 border-bottom d-flex align-items-center justify-content-between">
        <div>
          <p class="eyebrow mb-1">{editingIssue ? `ISSUE #${editingIssue.number}` : 'NEW ISSUE'}</p>
          <h2 class="h5 fw-bold mb-0">{editingIssue ? '노트 편집' : '새 노트'}</h2>
        </div>
        <button type="button" class="btn-close" aria-label="편집기 닫기" on:click={closeEditor}></button>
      </header>

      <div class="editor-fields flex-grow-1 d-flex flex-column p-3 p-md-4 gap-3">
        {#if editorError}
          <div class="alert alert-danger py-2 mb-0" role="alert">{editorError}</div>
        {/if}
        <input
          class="form-control form-control-lg border-0 px-0 fw-bold editor-title"
          bind:value={draftTitle}
          placeholder="노트 제목"
          aria-label="노트 제목"
          maxlength="256"
        />
        <textarea
          bind:this={bodyTextarea}
          class="form-control border-0 px-0 flex-grow-1 editor-body"
          bind:value={draftBody}
          on:paste={handlePaste}
          placeholder="Markdown으로 내용을 작성하세요…"
          aria-label="노트 본문"
        ></textarea>
        <div class="attachment-bar d-flex align-items-center justify-content-between gap-3">
          <div>
            <input
              bind:this={fileInput}
              class="visually-hidden"
              type="file"
              id="attachment-input"
              multiple
              on:change={(event) => uploadFiles(event.currentTarget.files)}
            />
            <label class="btn btn-sm btn-outline-secondary" for="attachment-input">
              {uploading ? `업로드 중 (${uploading})…` : '파일 첨부'}
            </label>
          </div>
          <span class="small text-secondary">이미지는 클립보드에서 바로 붙여넣을 수 있습니다.</span>
        </div>
      </div>

      <footer class="p-3 p-md-4 border-top d-flex align-items-center justify-content-between gap-3">
        <span class="small text-secondary">GitHub Issue에 바로 저장됩니다.</span>
        <div class="d-flex gap-2">
          <button type="button" class="btn btn-light" on:click={closeEditor} disabled={uploading}>취소</button>
          <button class="btn btn-primary px-4" disabled={saving || uploading || !draftTitle.trim()}>
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </footer>
    </form>
  </aside>
{/if}
