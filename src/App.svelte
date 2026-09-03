<script>
  import { onMount } from 'svelte';
  import { createStackRouter } from 'spa-stack-router';
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
  const router = createStackRouter({ mode: 'hashbang', escToBack: true });

  let token = '';
  let repo = '';
  let rememberToken = true;
  let appState = 'booting';
  let user = null;
  let repository = null;
  let issues = [];
  let selectedIssue = null;
  let state = 'open';
  let query = '';
  let loading = false;
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
  let routeStack = [];
  let activeEditorRoute = '';

  $: emptyMessage = query
    ? '검색 결과가 없습니다.'
    : state === 'open'
      ? '아직 작성한 노트가 없습니다.'
      : '휴지통이 비어 있습니다.';
  $: patCreationUrl = makePatCreationUrl(repo);
  $: guideRepository = repositoryName(repo);

  onMount(() => {
    router.init();
    const unsubscribe = router.subscribe((stack) => {
      routeStack = stack;
      applyRoute();
    });

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      repo = saved.repo || '';
      token = saved.token || '';
      rememberToken = Boolean(saved.token);
      if (token && repo) {
        connect(false, true);
      } else {
        appState = 'setup';
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      appState = 'setup';
    }

    return () => {
      unsubscribe();
      router.destroy();
    };
  });

  function applyRoute() {
    const top = routeStack.at(-1);
    const issueNumber = Number(top?.value);

    if (top?.screen === 'note') {
      selectedIssue = issues.find((issue) => issue.number === issueNumber) || null;
      editorOpen = false;
      editingIssue = null;
      activeEditorRoute = '';
      return;
    }

    if (top?.screen === 'edit') {
      const issue = issues.find((item) => item.number === issueNumber);
      if (!issue) return;
      selectedIssue = issue;
      const signature = `edit.${issue.number}`;
      if (activeEditorRoute !== signature) {
        editingIssue = issue;
        draftTitle = issue.title;
        draftBody = issue.body || '';
        editorError = '';
        activeEditorRoute = signature;
      }
      editorOpen = true;
      return;
    }

    if (top?.screen === 'new') {
      if (activeEditorRoute !== 'new') {
        editingIssue = null;
        draftTitle = '';
        draftBody = '';
        editorError = '';
        activeEditorRoute = 'new';
      }
      editorOpen = true;
      return;
    }

    selectedIssue = null;
    editorOpen = false;
    editingIssue = null;
    activeEditorRoute = '';
  }

  function persistSettings(normalizedRepo) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ repo: normalizedRepo, token: rememberToken ? token : '' })
    );
  }

  function repositoryName(value) {
    const cleaned = value
      .trim()
      .replace(/^https?:\/\/github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/^\/+|\/+$/g, '');
    const parts = cleaned.split('/');
    return parts.length === 2 && parts.every(Boolean)
      ? { owner: parts[0], name: parts[1], fullName: cleaned }
      : null;
  }

  function makePatCreationUrl(value) {
    const selected = repositoryName(value);
    const url = new URL('https://github.com/settings/personal-access-tokens/new');
    url.searchParams.set('name', `Issue Note${selected ? ` - ${selected.name}` : ''}`.slice(0, 40));
    url.searchParams.set(
      'description',
      selected ? `Issue Note access for ${selected.fullName}` : 'Issue Note repository access'
    );
    url.searchParams.set('expires_in', 'none');
    url.searchParams.set('issues', 'write');
    url.searchParams.set('contents', 'write');
    if (selected) url.searchParams.set('target_name', selected.owner);
    return url.toString();
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

  async function connect(showSuccess = true, restoring = false) {
    error = '';
    notice = '';
    appState = restoring ? 'restoring' : 'connecting';
    try {
      const result = await verifyConnection(token.trim(), repo);
      token = token.trim();
      repo = result.repo;
      user = result.user;
      repository = result.repository;
      persistSettings(result.repo);
      if (showSuccess) notice = 'GitHub 저장소에 연결했습니다.';
      await loadIssues();
      appState = 'ready';
    } catch (reason) {
      appState = 'setup';
      error = friendlyError(reason);
    }
  }

  async function loadIssues() {
    error = '';
    loading = true;
    try {
      const nextIssues = query.trim()
        ? await searchIssues(token, repo, state, query)
        : await listIssues(token, repo, state);
      issues = nextIssues;
      applyRoute();
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
    selectedIssue = null;
    if (router.getDepth()) router.popTo(0);
    await loadIssues();
  }

  function newNote() {
    error = '';
    router.push('new');
  }

  function editNote(issue) {
    error = '';
    router.push(`edit.${issue.number}`);
  }

  function selectNote(issue) {
    router.navigate(`note.${issue.number}`);
  }

  function closeEditor() {
    if (saving || uploading) return;
    router.pop();
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
        const savedIssue = await updateIssue(token, repo, editingIssue.number, note);
        issues = issues.map((issue) => issue.id === savedIssue.id ? savedIssue : issue);
        selectedIssue = savedIssue;
        notice = '노트를 저장했습니다.';
        router.pop();
      } else {
        const savedIssue = await createIssue(token, repo, note);
        query = '';
        state = 'open';
        issues = [savedIssue, ...issues.filter((issue) => issue.id !== savedIssue.id)];
        selectedIssue = savedIssue;
        notice = '새 노트를 만들었습니다.';
        router.replace(`note.${savedIssue.number}`);
      }
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
      if (selectedIssue?.id === issue.id) {
        selectedIssue = null;
        if (router.getDepth()) router.popTo(0);
      }
      notice = nextState === 'closed' ? '노트를 휴지통으로 이동했습니다.' : '노트를 복원했습니다.';
    } catch (reason) {
      error = friendlyError(reason);
    }
  }

  function openSettings() {
    appState = 'setup';
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
    selectedIssue = null;
    appState = 'setup';
    router.navigate('/');
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

{#if appState === 'booting' || appState === 'restoring'}
  <main class="boot-screen">
    <span class="brand-mark brand-mark-sm">IN</span>
    <span class="text-secondary small">
      {appState === 'restoring' ? '노트를 불러오는 중…' : '시작하는 중…'}
    </span>
  </main>
{:else if appState === 'setup' || appState === 'connecting'}
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

            <details class="pat-guide mb-4">
              <summary class="d-flex align-items-center justify-content-between gap-3">
                <span>
                  <strong>PAT 발급이 처음인가요?</strong>
                  <small class="d-block text-secondary mt-1">저장소 하나만 허용하는 방법</small>
                </span>
                <span class="guide-chevron" aria-hidden="true">⌄</span>
              </summary>
              <div class="pat-guide-body border-top">
                <ol class="pat-steps mb-4">
                  <li>
                    <strong>GitHub 발급 화면을 엽니다.</strong>
                    <span>아래 버튼은 만료 없음과 필요한 권한을 미리 입력합니다.</span>
                  </li>
                  <li>
                    <strong>Resource owner를 확인합니다.</strong>
                    <span>
                      {guideRepository
                        ? `${guideRepository.owner} 계정이 선택되어야 합니다.`
                        : '저장소 소유자 계정을 선택하세요.'}
                    </span>
                  </li>
                  <li>
                    <strong>Repository access에서 Only select repositories를 고릅니다.</strong>
                    <span>
                      {guideRepository
                        ? `${guideRepository.fullName} 저장소 하나만 선택하세요.`
                        : '위에 입력할 노트 저장소 하나만 선택하세요.'}
                    </span>
                  </li>
                  <li>
                    <strong>Repository permissions를 확인합니다.</strong>
                    <span>Issues와 Contents가 Read and write이면 됩니다.</span>
                  </li>
                  <li>
                    <strong>Generate token을 누르고 즉시 복사합니다.</strong>
                    <span>생성된 PAT는 GitHub에서 다시 보여주지 않습니다.</span>
                  </li>
                </ol>
                <a
                  class="btn btn-outline-primary w-100"
                  href={patCreationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {guideRepository ? `${guideRepository.name}용 PAT 발급하기` : 'PAT 발급 화면 열기'}
                </a>
                <p class="small text-secondary mt-2 mb-0">
                  GitHub 발급 화면에서 저장소 선택은 직접 한 번 확인해야 합니다.
                </p>
              </div>
            </details>

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

            <button class="btn btn-primary btn-lg w-100" disabled={appState === 'connecting'}>
              {appState === 'connecting' ? '연결 확인 중…' : '연결하고 시작하기'}
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
  <div
    class="app-shell"
    class:mobile-detail-active={routeStack.at(-1)?.screen === 'note'}
  >
    <header class="top-toolbar">
      <div class="toolbar-brand">
        <span class="brand-mark brand-mark-sm">IN</span>
        <strong>Issue Note</strong>
      </div>
      <div class="toolbar-actions">
        <a href={repository?.html_url} target="_blank" rel="noreferrer">{repo}</a>
        <button class="btn btn-sm btn-outline-secondary" on:click={openSettings}>설정</button>
        {#if user}<img class="avatar" src={user.avatar_url} alt={user.login} />{/if}
      </div>
    </header>

    <main class="note-workspace">
      <aside class="note-sidebar">
        <div class="sidebar-heading">
          <div>
            <h1>{state === 'open' ? '노트' : '휴지통'}</h1>
            <span>{issues.length}개</span>
          </div>
          {#if state === 'open'}
            <button class="btn btn-sm btn-primary" on:click={newNote}>새 노트</button>
          {/if}
        </div>

        <div class="sidebar-tools">
          <div class="state-tabs" role="group" aria-label="노트 상태">
            <button class:active={state === 'open'} on:click={() => changeState('open')}>노트</button>
            <button class:active={state === 'closed'} on:click={() => changeState('closed')}>휴지통</button>
          </div>
          <form class="sidebar-search" on:submit|preventDefault={loadIssues}>
            <input type="search" bind:value={query} placeholder="검색" aria-label="노트 검색" />
            <button disabled={loading}>검색</button>
            {#if query}
              <button
                type="button"
                on:click={() => {
                  query = '';
                  loadIssues();
                }}
              >지우기</button>
            {/if}
          </form>
        </div>

        {#if error}
          <div class="sidebar-message text-danger">{error}</div>
        {/if}
        {#if notice}
          <div class="sidebar-message text-success">{notice}</div>
        {/if}

        <div class="note-list">
          {#if loading}
            <div class="list-status">
              <span class="spinner-border spinner-border-sm" aria-hidden="true"></span>
              불러오는 중…
            </div>
          {:else if issues.length === 0}
            <div class="list-status">{emptyMessage}</div>
          {:else}
            {#each issues as issue (issue.id)}
              <button
                class="note-list-row"
                class:active={selectedIssue?.id === issue.id}
                on:click={() => selectNote(issue)}
              >
                <span class="note-row-title">{issue.title}</span>
                <span class="note-row-preview">{excerpt(issue.body)}</span>
                <span class="note-row-meta">#{issue.number} · {formatDate(issue.updated_at)}</span>
              </button>
            {/each}
          {/if}
        </div>
      </aside>

      <section class="note-detail">
        {#if selectedIssue}
          <div class="detail-toolbar">
            <button class="mobile-back" on:click={() => router.pop()} aria-label="목록으로 돌아가기">‹ 목록</button>
            <span>#{selectedIssue.number}</span>
            <div class="ms-auto d-flex gap-2">
              {#if state === 'open'}
                <button class="btn btn-sm btn-outline-secondary" on:click={() => editNote(selectedIssue)}>수정</button>
                <button class="btn btn-sm btn-outline-secondary" on:click={() => moveIssue(selectedIssue, 'closed')}>휴지통</button>
              {:else}
                <button class="btn btn-sm btn-outline-secondary" on:click={() => moveIssue(selectedIssue, 'open')}>복원</button>
              {/if}
              <a class="btn btn-sm btn-outline-secondary" href={selectedIssue.html_url} target="_blank" rel="noreferrer">GitHub</a>
            </div>
          </div>
          <article class="note-reader">
            <h2>{selectedIssue.title}</h2>
            <div class="reader-meta">마지막 수정 {formatDate(selectedIssue.updated_at)}</div>
            <div class="note-body">{selectedIssue.body || '내용이 없습니다.'}</div>
          </article>
        {:else}
          <div class="detail-empty">
            <p>왼쪽 목록에서 노트를 선택하세요.</p>
          </div>
        {/if}
      </section>
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
