<script>
  import { onMount } from 'svelte';
  import { createStackRouter } from 'spa-stack-router';
  import NoteEditor from './lib/NoteEditor.svelte';
  import TagSettings from './lib/TagSettings.svelte';
  import {
    createIssue,
    createLabel,
    listIssues,
    listLabels,
    removeLabel,
    renameLabel,
    searchIssues,
    setIssueState,
    verifyConnection
  } from './lib/github.js';

  const STORAGE_KEY = 'issue-note.settings.v1';
  const BACKGROUND_REFRESH_MS = 60 * 60 * 1000;
  const router = createStackRouter({ mode: 'hashbang', escToBack: true });

  let token = '';
  let repo = '';
  let rememberToken = true;
  let appState = 'booting';
  let user = null;
  let repository = null;
  let issues = [];
  let repositoryLabels = [];
  let selectedIssue = null;
  let pendingNote = null;
  let pendingAllocation = null;
  let state = 'open';
  let query = '';
  let activeLabel = '';
  let loading = false;
  let error = '';
  let notice = '';
  let routeStack = [];
  let titleMode = 'first-line';
  let editorFont = 'system';
  let editorFontSize = 16;
  let editorLineHeight = 1.7;
  let settingsSnapshot = null;
  let backgroundRefreshTimer;
  let labelBusy = '';
  let labelMutation = null;
  let labelMutationSequence = 0;
  let labelRenameDrafts = [];
  let settingsRouteOverride = '';

  $: emptyMessage = query
    ? '검색 결과가 없습니다.'
    : state === 'open'
      ? '아직 작성한 노트가 없습니다.'
      : '휴지통이 비어 있습니다.';
  $: patCreationUrl = makePatCreationUrl(repo);
  $: guideRepository = repositoryName(repo);
  $: mcpRepository = repository?.full_name || guideRepository?.fullName || repo.trim();
  $: mcpUsagePrompt = `${mcpRepository || 'owner/repository'} 저장소의 GitHub Issues를 노트로 사용해줘. 열린 이슈는 일반 노트, 닫힌 이슈는 휴지통이며 라벨은 태그야. 각 첨부파일은 .issue-note-assets/issues/{이슈 번호}/ 폴더에 저장되고, 해당 이슈에는 <!-- issue-note-attachment:... --> 마커가 있는 전용 댓글 하나가 연결돼. 이 댓글은 앱이 첨부파일 목록과 GitHub 미리보기를 관리하는 내부 레코드이므로 일반 댓글로 해석하거나 수정·삭제하지 말아줘. 이슈 본문은 첨부 메타데이터 없이 노트 내용만 들어 있어.`;
  $: topRoute = routeStack.at(-1);
  $: contentRoutes = routeStack.filter((route) => ['note', 'new'].includes(route.screen));
  $: contentRoute = contentRoutes.at(-1);
  $: isNewRoute = contentRoute?.screen === 'new';
  $: pendingMatchesLabel = !activeLabel || hasIssueLabel(pendingNote, activeLabel);
  $: visibleIssues = pendingNote && state === 'open' && !query && pendingMatchesLabel
    ? [pendingNote, ...issues]
    : issues;

  onMount(() => {
    router.init();
    const unsubscribe = router.subscribe((stack) => {
      const wasInSettings = routeStack.at(-1)?.screen === 'settings';
      const isInSettings = stack.at(-1)?.screen === 'settings';
      const previousLabel = labelFromRoutes(routeStack);
      const nextLabel = labelFromRoutes(stack);
      routeStack = stack;
      activeLabel = nextLabel;
      if (wasInSettings && !isInSettings) {
        if (settingsSnapshot) restoreSettingsSnapshot();
        if (appState === 'connecting') appState = 'ready';
        if (settingsRouteOverride) {
          const target = settingsRouteOverride;
          settingsRouteOverride = '';
          router.navigate(`/${target}`);
          return;
        }
      }
      applyRoute();
      if (previousLabel !== nextLabel && appState === 'ready' && !isInSettings) loadIssues();
    });

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      repo = saved.repo || '';
      token = saved.token || '';
      rememberToken = Boolean(saved.token);
      titleMode = saved.preferences?.titleMode || 'first-line';
      editorFont = saved.preferences?.editorFont || 'system';
      editorFontSize = Number(saved.preferences?.editorFontSize) || 16;
      editorLineHeight = Number(saved.preferences?.editorLineHeight) || 1.7;
      if (token && repo) {
        connect(false, true);
      } else {
        appState = 'setup';
      }
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      appState = 'setup';
    }

    backgroundRefreshTimer = setInterval(() => {
      if (appState === 'ready' && topRoute?.screen !== 'settings') loadIssues(true);
    }, BACKGROUND_REFRESH_MS);

    return () => {
      clearInterval(backgroundRefreshTimer);
      unsubscribe();
      router.destroy();
    };
  });

  function applyRoute() {
    const route = [...routeStack].reverse().find((item) => ['note', 'new'].includes(item.screen));
    const issueNumber = Number(route?.value);

    if (route?.screen === 'note') {
      selectedIssue = issues.find((issue) => issue.number === issueNumber) || null;
      return;
    }

    if (route?.screen === 'new') {
      selectedIssue = pendingNote;
      return;
    }

    selectedIssue = null;
  }

  function issueForRoute(route) {
    if (route.screen === 'new') return null;
    const issueNumber = Number(route.value);
    return issues.find((issue) => issue.number === issueNumber) || null;
  }

  function labelFromRoutes(routes) {
    const route = routes.find((item) => item.screen === 'tag');
    if (!route?.value) return '';
    try {
      return decodeURIComponent(route.value);
    } catch {
      return route.value;
    }
  }

  function persistSettings(normalizedRepo) {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        repo: normalizedRepo,
        token: rememberToken ? token : '',
        preferences: { titleMode, editorFont, editorFontSize, editorLineHeight }
      })
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

  async function copyMcpText(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
      notice = successMessage;
      error = '';
    } catch {
      error = '클립보드에 복사하지 못했습니다.';
    }
  }

  async function connect(showSuccess = true, restoring = false) {
    const fromSettings = routeStack.at(-1)?.screen === 'settings' && Boolean(settingsSnapshot);
    const requestedToken = token.trim();
    const requestedRepo = repo;
    error = '';
    notice = '';
    appState = restoring ? 'restoring' : 'connecting';
    try {
      const result = await verifyConnection(requestedToken, requestedRepo);
      if (fromSettings && routeStack.at(-1)?.screen !== 'settings') return;
      token = requestedToken;
      repo = result.repo;
      user = result.user;
      repository = result.repository;
      persistSettings(result.repo);
      if (showSuccess) notice = 'GitHub 저장소에 연결했습니다.';
      await Promise.all([loadIssues(), loadRepositoryLabels()]);
      appState = 'ready';
      if (fromSettings) {
        settingsSnapshot = null;
        router.pop();
      }
    } catch (reason) {
      if (fromSettings && routeStack.at(-1)?.screen !== 'settings') return;
      appState = fromSettings ? 'ready' : 'setup';
      error = friendlyError(reason);
    }
  }

  async function loadIssues(background = false) {
    if (background && loading) return;
    const requestedQuery = query;
    const requestedState = state;
    const requestedLabel = activeLabel;
    if (!background) {
      error = '';
      loading = true;
    }
    try {
      const nextIssues = requestedQuery.trim()
        ? await searchIssues(token, repo, requestedState, requestedQuery, requestedLabel)
        : await listIssues(token, repo, requestedState, requestedLabel);
      if (
        requestedQuery !== query
        || requestedState !== state
        || requestedLabel !== activeLabel
      ) return;
      issues = nextIssues;
      applyRoute();
    } catch (reason) {
      if (!background) error = friendlyError(reason);
    } finally {
      if (!background) loading = false;
    }
  }

  async function submitSearch() {
    const tagQuery = query.trim().match(/^#(.+)$/)?.[1]?.trim();
    if (tagQuery) {
      const exactLabel = repositoryLabels.find(
        (label) => label.name.toLocaleLowerCase() === tagQuery.toLocaleLowerCase()
      );
      if (exactLabel) {
        openLabel(exactLabel.name);
        return;
      }
    }
    await loadIssues();
  }

  async function loadRepositoryLabels() {
    try {
      repositoryLabels = await listLabels(token, repo);
    } catch (reason) {
      error = friendlyError(reason);
    }
  }

  async function changeState(nextState) {
    if (state === nextState) return;
    state = nextState;
    query = '';
    selectedIssue = null;
    const labelWillChange = Boolean(activeLabel);
    if (router.getDepth()) router.navigate('/');
    if (!labelWillChange) await loadIssues();
  }

  function newNote() {
    error = '';
    const hadQuery = Boolean(query.trim());
    query = '';
    if (!pendingNote) {
      pendingNote = {
        id: 'local-new-note',
        number: null,
        title: '새 노트',
        body: '',
        labels: activeLabel ? [{ name: activeLabel }] : [],
        updated_at: new Date().toISOString(),
        local: true,
        allocation: 'creating'
      };
      pendingAllocation = allocatePendingIssue(pendingNote);
    }
    selectedIssue = pendingNote;
    router.navigate('new');
    if (hadQuery) loadIssues();
  }

  async function allocatePendingIssue(localNote) {
    try {
      const created = await createIssue(token, repo, {
        title: '새 노트',
        body: '',
        labels: localNote.labels.map((label) => label.name)
      });
      if (pendingNote === localNote || pendingNote?.id === localNote.id) {
        pendingNote = {
          ...pendingNote,
          number: created.number,
          allocatedIssue: created,
          allocation: 'ready'
        };
        if (isNewRoute) selectedIssue = pendingNote;
      }
      return created;
    } catch (reason) {
      if (pendingNote === localNote || pendingNote?.id === localNote.id) {
        pendingNote = { ...pendingNote, allocation: 'failed' };
        if (isNewRoute) selectedIssue = pendingNote;
      }
      error = `새 노트 번호를 만들지 못했습니다. ${friendlyError(reason)}`;
      return null;
    }
  }

  function selectNote(issue) {
    router.navigate(issue.local ? 'new' : `note.${issue.number}`);
  }

  function noteSaved(savedIssue) {
    issues = [savedIssue, ...issues.filter((issue) => issue.id !== savedIssue.id)];
    const savedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === savedIssue.number;
    if (savedIssueIsActive) selectedIssue = savedIssue;
    if (savedIssueIsActive && activeLabel && !hasIssueLabel(savedIssue, activeLabel)) {
      router.navigate(`/note.${savedIssue.number}`);
    }
  }

  function noteRefreshed(refreshedIssue) {
    issues = issues.map((issue) => issue.id === refreshedIssue.id ? refreshedIssue : issue);
    const refreshedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === refreshedIssue.number;
    if (refreshedIssueIsActive) selectedIssue = refreshedIssue;
  }

  function noteCreated(savedIssue) {
    const newNoteIsActive = contentRoute?.screen === 'new';
    error = '';
    query = '';
    state = 'open';
    issues = [savedIssue, ...issues.filter((issue) => issue.id !== savedIssue.id)];
    pendingNote = null;
    pendingAllocation = null;
    if (newNoteIsActive) selectedIssue = savedIssue;
    if (newNoteIsActive && activeLabel && !hasIssueLabel(savedIssue, activeLabel)) {
      router.navigate(`/note.${savedIssue.number}`);
    } else {
      const nextStack = routeStack.map((route) => route.screen === 'new'
        ? `note.${savedIssue.number}`
        : route.segment);
      router.navigate(`/${nextStack.join('/')}`);
    }
  }

  function hasIssueLabel(issue, labelName) {
    return issue.labels?.some(
      (label) => label.name.toLocaleLowerCase() === labelName.toLocaleLowerCase()
    );
  }

  function labelColor(label) {
    return label?.color
      || repositoryLabels.find(
        (item) => item.name.toLocaleLowerCase() === label?.name?.toLocaleLowerCase()
      )?.color
      || '4f46e5';
  }

  function pendingNoteChanged(draft) {
    if (!pendingNote) return;
    pendingNote = { ...pendingNote, ...draft };
    if (isNewRoute) selectedIssue = pendingNote;
  }

  function mergeRepositoryLabels(nextLabels) {
    const labelsByName = new Map(
      [...repositoryLabels, ...nextLabels].map((label) => [label.name.toLocaleLowerCase(), label])
    );
    repositoryLabels = [...labelsByName.values()].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
  }

  function replaceLabelInIssue(issue, currentName, nextName = '') {
    if (!issue) return issue;
    const nextLabels = (issue.labels || [])
      .filter((label) => nextName || label.name.toLocaleLowerCase() !== currentName.toLocaleLowerCase())
      .map((label) => label.name.toLocaleLowerCase() === currentName.toLocaleLowerCase()
        ? { ...label, name: nextName }
        : label);
    return { ...issue, labels: nextLabels };
  }

  function updateDraftLabels(repoName, currentName, nextName = '') {
    const draftsKey = 'issue-note.drafts.v1';
    try {
      const store = JSON.parse(localStorage.getItem(draftsKey) || '{}');
      const repoDrafts = store[repoName];
      if (!repoDrafts) return;
      for (const draft of Object.values(repoDrafts)) {
        if (!Array.isArray(draft.labels)) continue;
        draft.labels = draft.labels
          .filter((name) => nextName || name.toLocaleLowerCase() !== currentName.toLocaleLowerCase())
          .map((name) => name.toLocaleLowerCase() === currentName.toLocaleLowerCase() ? nextName : name);
      }
      localStorage.setItem(draftsKey, JSON.stringify(store));
    } catch {
      // 손상된 초안 저장소는 편집기가 자체적으로 무시한다.
    }
  }

  function rewriteActiveTagRoute(nextName = '') {
    const nextSegments = routeStack
      .filter((route) => route.screen !== 'settings')
      .filter((route) => nextName || route.screen !== 'tag')
      .map((route) => route.screen === 'tag'
        ? `tag.${encodeURIComponent(nextName)}`
        : route.segment);
    settingsRouteOverride = nextSegments.join('/');
    router.navigate(`/${[...nextSegments, 'settings'].join('/')}`);
  }

  async function renameRepositoryLabel(label, nextName) {
    if (labelBusy) return false;
    const normalizedName = Array.from(nextName.trim()).slice(0, 50).join('');
    if (!normalizedName || normalizedName === label.name) return true;
    labelBusy = label.name;
    error = '';
    try {
      const connectedToken = settingsSnapshot?.token || token;
      const connectedRepo = repository?.full_name || settingsSnapshot?.repo || repo;
      const savedLabel = await renameLabel(connectedToken, connectedRepo, label.name, normalizedName);
      repositoryLabels = repositoryLabels
        .map((item) => item.name === label.name ? savedLabel : item)
        .sort((a, b) => a.name.localeCompare(b.name, 'ko'));
      issues = issues.map((issue) => replaceLabelInIssue(issue, label.name, savedLabel.name));
      pendingNote = replaceLabelInIssue(pendingNote, label.name, savedLabel.name);
      selectedIssue = replaceLabelInIssue(selectedIssue, label.name, savedLabel.name);
      updateDraftLabels(connectedRepo, label.name, savedLabel.name);
      labelMutation = { id: ++labelMutationSequence, from: label.name, to: savedLabel.name };
      notice = `#${label.name} 태그를 #${savedLabel.name}(으)로 변경했습니다.`;
      if (activeLabel.toLocaleLowerCase() === label.name.toLocaleLowerCase()) {
        rewriteActiveTagRoute(savedLabel.name);
      }
      return true;
    } catch (reason) {
      error = friendlyError(reason);
      return false;
    } finally {
      labelBusy = '';
    }
  }

  async function applyLabelRenameDrafts() {
    for (const draft of labelRenameDrafts) {
      const label = repositoryLabels.find((item) => item.id === draft.label.id);
      if (!label) continue;
      if (!draft.nextName) {
        error = `#${label.name} 태그 이름을 비워둘 수 없습니다.`;
        return false;
      }
      if (!await renameRepositoryLabel(label, draft.nextName)) return false;
    }
    labelRenameDrafts = [];
    return true;
  }

  function connectionSettingsChanged() {
    if (!settingsSnapshot) return true;
    const requestedRepo = repositoryName(repo)?.fullName || repo.trim();
    const savedRepo = repositoryName(settingsSnapshot.repo)?.fullName || settingsSnapshot.repo.trim();
    return token.trim() !== settingsSnapshot.token.trim()
      || requestedRepo.toLocaleLowerCase() !== savedRepo.toLocaleLowerCase();
  }

  function finishLocalSettingsSave() {
    token = token.trim();
    repo = repository?.full_name || repositoryName(repo)?.fullName || repo.trim();
    persistSettings(repo);
    settingsSnapshot = null;
    labelRenameDrafts = [];
    appState = 'ready';
    notice = '';
    router.pop();
  }

  async function saveConfiguration() {
    if (topRoute?.screen !== 'settings') {
      await connect(true);
      return;
    }

    error = '';
    notice = '';
    const needsConnectionCheck = connectionSettingsChanged();
    if (!needsConnectionCheck && labelRenameDrafts.length === 0) {
      finishLocalSettingsSave();
      return;
    }

    appState = 'connecting';
    if (!await applyLabelRenameDrafts()) {
      appState = 'ready';
      return;
    }
    if (needsConnectionCheck) await connect(false);
    else finishLocalSettingsSave();
  }

  async function createRepositoryLabel(name) {
    if (labelBusy) return;
    const normalizedName = Array.from(name.trim()).slice(0, 50).join('');
    if (!normalizedName) return;
    labelBusy = normalizedName;
    error = '';
    try {
      const connectedToken = settingsSnapshot?.token || token;
      const connectedRepo = repository?.full_name || settingsSnapshot?.repo || repo;
      const savedLabel = await createLabel(connectedToken, connectedRepo, normalizedName);
      mergeRepositoryLabels([savedLabel]);
      notice = `#${savedLabel.name} 태그를 추가했습니다.`;
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      labelBusy = '';
    }
  }

  async function deleteRepositoryLabel(label) {
    if (labelBusy) return;
    labelBusy = label.name;
    error = '';
    try {
      const connectedToken = settingsSnapshot?.token || token;
      const connectedRepo = repository?.full_name || settingsSnapshot?.repo || repo;
      await removeLabel(connectedToken, connectedRepo, label.name);
      repositoryLabels = repositoryLabels.filter((item) => item.name !== label.name);
      issues = issues.map((issue) => replaceLabelInIssue(issue, label.name));
      pendingNote = replaceLabelInIssue(pendingNote, label.name);
      selectedIssue = replaceLabelInIssue(selectedIssue, label.name);
      updateDraftLabels(connectedRepo, label.name);
      labelMutation = { id: ++labelMutationSequence, from: label.name, to: '' };
      notice = `#${label.name} 태그를 삭제했습니다.`;
      if (activeLabel.toLocaleLowerCase() === label.name.toLocaleLowerCase()) rewriteActiveTagRoute();
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      labelBusy = '';
    }
  }

  function openLabel(labelName) {
    query = '';
    selectedIssue = null;
    const route = `tag.${encodeURIComponent(labelName)}`;
    if (routeStack.some((item) => item.screen === 'tag')) router.navigate(route);
    else if (['note', 'new'].includes(topRoute?.screen)) router.navigate(`/${route}`);
    else router.push(route);
  }

  function clearLabel() {
    if (topRoute?.screen === 'tag') router.pop();
    else router.navigate('/');
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
    settingsRouteOverride = '';
    settingsSnapshot = {
      token,
      repo,
      rememberToken,
      titleMode,
      editorFont,
      editorFontSize,
      editorLineHeight
    };
    error = '';
    notice = '';
    labelRenameDrafts = [];
    router.push('settings');
  }

  function restoreSettingsSnapshot() {
    if (!settingsSnapshot) return;
    ({
      token,
      repo,
      rememberToken,
      titleMode,
      editorFont,
      editorFontSize,
      editorLineHeight
    } = settingsSnapshot);
    settingsSnapshot = null;
    labelRenameDrafts = [];
    error = '';
  }

  function closeSettings() {
    router.pop();
  }

  function forgetSettings() {
    if (!confirm('이 브라우저에 저장된 PAT와 저장소 설정을 삭제할까요?')) return;
    localStorage.removeItem(STORAGE_KEY);
    token = '';
    repo = '';
    user = null;
    repository = null;
    issues = [];
    repositoryLabels = [];
    pendingNote = null;
    selectedIssue = null;
    settingsSnapshot = null;
    settingsRouteOverride = '';
    appState = 'setup';
    router.navigate('/');
    notice = '브라우저에 저장된 설정을 삭제했습니다.';
  }

  function excerpt(body) {
    const text = String(body || '').replace(/\s+/g, ' ').trim();
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
{:else}
  {#if appState === 'setup' || appState === 'connecting' || topRoute?.screen === 'settings'}
  <main
    class="setup-shell container py-4 py-md-5"
    class:settings-overlay={topRoute?.screen === 'settings'}
  >
    <section class="setup-card card border-0 shadow-sm mx-auto overflow-hidden">
      <div class="row g-0">
        <div class="col-12 bg-white p-4 p-md-5">
          <div class="d-flex align-items-start justify-content-between gap-3 mb-4">
            <div>
              <h2 class="h4 fw-bold mb-2">
                {topRoute?.screen === 'settings' ? '환경설정' : 'GitHub 저장소 연결'}
              </h2>
              <p class="text-secondary mb-0">
                PAT는 이 브라우저에서 GitHub API로만 전송됩니다.
              </p>
            </div>
            {#if topRoute?.screen === 'settings'}
              <button
                class="btn btn-sm btn-outline-secondary flex-shrink-0"
                aria-label="환경설정 닫기"
                disabled={appState === 'connecting'}
                on:click={closeSettings}
              ><i class="bi bi-x-lg" aria-hidden="true"></i> 닫기</button>
            {/if}
          </div>

          {#if error}
            <div class="alert alert-danger" role="alert">{error}</div>
          {/if}
          {#if notice}
            <div class="alert alert-success" role="status">{notice}</div>
          {/if}

          <form on:submit|preventDefault={saveConfiguration}>
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
              <div class="form-text text-warning">
                <i class="bi bi-lock-fill" aria-hidden="true"></i>
                개인 노트가 공개되지 않도록 저장소는 반드시 Private으로 설정하세요.
              </div>
            </div>

            {#if topRoute?.screen !== 'settings'}
              <details class="pat-guide mb-3">
                <summary class="d-flex align-items-center justify-content-between gap-3">
                  <span>
                    <strong>사용할 저장소가 아직 없나요?</strong>
                    <small class="d-block text-secondary mt-1">노트 전용 비공개 저장소 만들기</small>
                  </span>
                  <span class="guide-chevron" aria-hidden="true">⌄</span>
                </summary>
                <div class="pat-guide-body border-top">
                  <ol class="pat-steps mb-3">
                    <li>
                      <strong>GitHub의 새 저장소 화면을 엽니다.</strong>
                      <span>로그인이 필요하면 먼저 GitHub 계정으로 로그인하세요.</span>
                    </li>
                    <li>
                      <strong>Owner와 Repository name을 정합니다.</strong>
                      <span>예: 저장소 이름을 issue-notes로 지정합니다.</span>
                    </li>
                    <li>
                      <strong>Visibility에서 반드시 Private을 선택하고 생성합니다.</strong>
                      <span>Public 저장소에는 노트와 첨부파일이 모두 공개됩니다. 생성 후 위 입력칸에 owner/issue-notes 형식으로 입력하세요.</span>
                    </li>
                  </ol>
                  <a class="btn btn-outline-primary w-100" href="https://github.com/new" target="_blank" rel="noreferrer">
                    <i class="bi bi-github" aria-hidden="true"></i> GitHub에서 비공개 저장소 만들기
                  </a>
                </div>
              </details>
            {/if}

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
                선택하세요. 토큰은 앱 서버로 전송되지 않고 이 디바이스의 브라우저에만
                저장됩니다.
              </div>
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
                  <i class="bi bi-key" aria-hidden="true"></i>
                  {guideRepository ? `${guideRepository.name}용 PAT 발급하기` : 'PAT 발급 화면 열기'}
                </a>
                <p class="small text-secondary mt-2 mb-0">
                  GitHub 발급 화면에서 저장소 선택은 직접 한 번 확인해야 합니다.
                </p>
              </div>
            </details>

            <div class="form-check mb-4">
              <input
                id="remember"
                class="form-check-input"
                type="checkbox"
                bind:checked={rememberToken}
              />
              <label class="form-check-label" for="remember">이 브라우저에 PAT 기억하기</label>
            </div>

            <fieldset class="editor-settings mb-4">
              <legend>편집기 설정</legend>
              <div class="mb-3">
                <label class="form-label" for="title-mode">제목 방식</label>
                <select id="title-mode" class="form-select" bind:value={titleMode}>
                  <option value="first-line">본문 첫 줄의 앞 50자를 제목으로 사용</option>
                  <option value="separate">제목을 별도 입력</option>
                </select>
              </div>
              <div class="row g-2">
                <div class="col-sm-6">
                  <label class="form-label" for="editor-font">글꼴</label>
                  <select id="editor-font" class="form-select" bind:value={editorFont}>
                    <option value="system">시스템 기본</option>
                    <option value="sans">고딕</option>
                    <option value="serif">명조</option>
                    <option value="mono">고정폭</option>
                  </select>
                </div>
                <div class="col-6 col-sm-3">
                  <label class="form-label" for="font-size">크기</label>
                  <input id="font-size" class="form-control" type="number" min="12" max="32" step="1" bind:value={editorFontSize} />
                </div>
                <div class="col-6 col-sm-3">
                  <label class="form-label" for="line-height">줄간격</label>
                  <input id="line-height" class="form-control" type="number" min="1.2" max="2.5" step="0.1" bind:value={editorLineHeight} />
                </div>
              </div>
            </fieldset>

            {#if topRoute?.screen === 'settings'}
              <TagSettings
                labels={repositoryLabels}
                busy={labelBusy || (appState === 'connecting' ? 'connecting' : '')}
                onCreate={createRepositoryLabel}
                onRenameDrafts={(drafts) => { labelRenameDrafts = drafts; }}
                onDelete={deleteRepositoryLabel}
              />

              <details class="pat-guide mcp-guide mb-4">
                <summary class="d-flex align-items-center justify-content-between gap-3">
                  <span>
                    <strong><i class="bi bi-robot me-2" aria-hidden="true"></i>MCP로 노트 사용하기</strong>
                    <small class="d-block text-secondary mt-1">AI 도구에서 같은 GitHub Issues 읽기·쓰기</small>
                  </span>
                  <span class="guide-chevron" aria-hidden="true">⌄</span>
                </summary>
                <div class="pat-guide-body border-top">
                  <p class="small text-secondary">
                    이 앱 전용 MCP 서버는 필요하지 않습니다. MCP 클라이언트에 GitHub의 공식
                    MCP Server를 연결하면 같은 저장소의 이슈를 노트로 읽고 수정할 수 있습니다.
                  </p>

                  <div class="mcp-repository mb-3">
                    <span class="small text-secondary">대상 저장소</span>
                    <div class="input-group input-group-sm mt-1">
                      <input class="form-control font-monospace" value={mcpRepository} readonly aria-label="MCP 대상 저장소" />
                      <button
                        type="button"
                        class="btn btn-outline-secondary"
                        on:click={() => copyMcpText(mcpRepository, 'MCP 대상 저장소를 복사했습니다.')}
                        disabled={!mcpRepository}
                      ><i class="bi bi-copy" aria-hidden="true"></i> 복사</button>
                    </div>
                  </div>

                  <ol class="pat-steps mb-3">
                    <li>
                      <strong>MCP 클라이언트에 공식 GitHub MCP Server를 추가합니다.</strong>
                      <span>Remote URL은 https://api.githubcopilot.com/mcp/이며, 지원하지 않는 클라이언트는 로컬 서버를 사용할 수 있습니다.</span>
                    </li>
                    <li>
                      <strong>GitHub 인증과 저장소 접근을 허용합니다.</strong>
                      <span>노트 편집에는 Issues 읽기·쓰기, 첨부파일에는 Contents 읽기·쓰기가 필요합니다.</span>
                    </li>
                    <li>
                      <strong>issues와 repos 도구 모음을 사용합니다.</strong>
                      <span>본문·라벨은 이슈에, 첨부파일은 저장소 파일과 전용 이슈 댓글에 저장됩니다. 브라우저 PAT는 공유되지 않으므로 OAuth 또는 별도 PAT로 인증해야 합니다.</span>
                    </li>
                  </ol>

                  <p class="small text-secondary">
                    첨부 댓글에는 GitHub에서 바로 볼 수 있는 이미지 또는 파일 링크와
                    <code>&lt;!-- issue-note-attachment:... --&gt;</code> 마커가 함께 들어갑니다.
                    AI가 노트 본문을 편집할 때 이 전용 댓글은 그대로 두어야 합니다.
                  </p>

                  <label class="form-label small" for="mcp-usage-prompt">AI에게 처음 전달할 안내</label>
                  <textarea id="mcp-usage-prompt" class="form-control form-control-sm mcp-prompt mb-2" readonly value={mcpUsagePrompt}></textarea>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary w-100 mb-2"
                    on:click={() => copyMcpText(mcpUsagePrompt, 'MCP용 노트 안내를 복사했습니다.')}
                  ><i class="bi bi-copy" aria-hidden="true"></i> 안내 문구 복사</button>
                  <a
                    class="btn btn-sm btn-outline-secondary w-100"
                    href="https://github.com/github/github-mcp-server"
                    target="_blank"
                    rel="noreferrer"
                  ><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> 공식 설치 안내 열기</a>
                </div>
              </details>
            {/if}

            <button class="btn btn-primary btn-lg w-100" disabled={appState === 'connecting'}>
              <i
                class={`bi ${topRoute?.screen === 'settings' ? 'bi-check-lg' : 'bi-link-45deg'}`}
                aria-hidden="true"
              ></i>
              {appState === 'connecting'
                ? topRoute?.screen === 'settings' ? '설정 저장 중…' : '연결 확인 중…'
                : topRoute?.screen === 'settings' ? '설정 저장' : '연결하고 시작하기'}
            </button>
          </form>

          {#if localStorage.getItem(STORAGE_KEY)}
            <button class="btn btn-link text-danger w-100 mt-3" on:click={forgetSettings}>
              <i class="bi bi-trash3" aria-hidden="true"></i> 저장된 설정 삭제
            </button>
          {/if}
        </div>
      </div>
    </section>
  </main>
  {/if}
  {#if appState === 'ready' || topRoute?.screen === 'settings'}
  <div
    class="app-shell"
    class:mobile-detail-active={Boolean(contentRoute)}
  >
    <main class="note-workspace">
      <aside class="note-sidebar">
        <div class="sidebar-heading">
          <div class="sidebar-heading-main">
            {#if user}
              <button class="sidebar-profile" on:click={openSettings} aria-label="환경설정 열기">
                <img class="avatar" src={user.avatar_url} alt={user.login} />
              </button>
            {/if}
            <div class="sidebar-heading-title">
              <h1>{activeLabel ? `#${activeLabel}` : state === 'open' ? '노트' : '휴지통'}</h1>
              <span>{visibleIssues.length}개</span>
            </div>
          </div>
          {#if state === 'open'}
            <button class="btn btn-sm btn-primary" on:click={newNote}>
              <i class="bi bi-plus-lg" aria-hidden="true"></i> 새 노트
            </button>
          {/if}
        </div>

        <div class="sidebar-tools">
          <div class="state-tabs" role="group" aria-label="노트 상태">
            <button class:active={state === 'open'} on:click={() => changeState('open')}>
              <i class="bi bi-journal-text" aria-hidden="true"></i> 노트
            </button>
            <button class:active={state === 'closed'} on:click={() => changeState('closed')}>
              <i class="bi bi-trash3" aria-hidden="true"></i> 휴지통
            </button>
          </div>
          <form class="sidebar-search" on:submit|preventDefault={submitSearch}>
            <input
              type="search"
              bind:value={query}
              placeholder="검색 또는 #태그"
              aria-label="노트 또는 태그 검색"
              list="sidebar-label-suggestions"
            />
            <datalist id="sidebar-label-suggestions">
              {#each repositoryLabels as label (label.id || label.name)}
                <option value={`#${label.name}`}></option>
              {/each}
            </datalist>
            <button disabled={loading}><i class="bi bi-search" aria-hidden="true"></i> 검색</button>
            {#if query}
              <button
                type="button"
                on:click={() => {
                  query = '';
                  loadIssues();
                }}
              ><i class="bi bi-x-lg" aria-hidden="true"></i> 지우기</button>
            {/if}
          </form>
          {#if activeLabel}
            <div class="active-label-filter">
              <span>#{activeLabel}</span>
              <button type="button" on:click={clearLabel} aria-label={`${activeLabel} 필터 해제`}>
                <i class="bi bi-x-lg" aria-hidden="true"></i>
              </button>
            </div>
          {/if}
        </div>

        {#if error}
          <div class="sidebar-message text-danger">{error}</div>
        {/if}
        {#if notice}
          <div class="sidebar-message text-success">{notice}</div>
        {/if}

        <div class="note-list" class:is-loading={loading}>
          <div class="note-list-scroll">
            {#if !loading && visibleIssues.length === 0}
              <div class="list-status">{emptyMessage}</div>
            {:else}
              {#each visibleIssues as issue (issue.id)}
              <article
                class="note-list-row"
                class:active={selectedIssue?.id === issue.id}
              >
                <button
                  class="note-row-hit-area"
                  on:click={() => selectNote(issue)}
                  aria-label={`${issue.title} 노트 열기`}
                ></button>
                <div class="note-row-content">
                  {#if titleMode === 'separate'}
                    <span class="note-row-title">{issue.title}</span>
                  {/if}
                  <span class="note-row-preview">{excerpt(issue.body)}</span>
                  <span class="note-row-meta">
                    {issue.local ? '로컬 초안' : `#${issue.number} · ${formatDate(issue.updated_at)}`}
                  </span>
                </div>
                {#if issue.labels?.length}
                  <div class="note-row-labels">
                    {#each issue.labels as label (label.id || label.name)}
                      <button
                        type="button"
                        style={`--tag-color:#${labelColor(label)}`}
                        on:click={() => openLabel(label.name)}
                      >#{label.name}</button>
                    {/each}
                  </div>
                {/if}
              </article>
              {/each}
            {/if}
          </div>
          {#if loading}
            <div class="list-api-overlay" aria-label="목록 불러오는 중">
              <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
            </div>
          {/if}
        </div>
      </aside>

      <section class="note-detail">
        {#if contentRoutes.length}
          {#each contentRoutes as route (route.segment)}
            {@const routeIssue = issueForRoute(route)}
            {#if route.screen === 'new' || routeIssue}
            <div
              class="note-detail-layer"
              class:active={route === contentRoute}
              aria-hidden={route !== contentRoute}
            >
            <NoteEditor
              {token}
              {repo}
              issue={routeIssue}
              allocatedIssue={route.screen === 'new' ? pendingNote?.allocatedIssue : null}
              allocationPromise={route.screen === 'new' ? pendingAllocation : null}
              editorId={route.segment.replace(/[^a-zA-Z0-9_-]/g, '-')}
              archived={state === 'closed'}
              {titleMode}
              font={editorFont}
              fontSize={editorFontSize}
              lineHeight={editorLineHeight}
              paused={topRoute?.screen === 'settings' || route !== contentRoute}
              availableLabels={repositoryLabels}
              {labelMutation}
              onSaved={noteSaved}
              onRefreshed={noteRefreshed}
              onCreated={noteCreated}
              onDraftChange={pendingNoteChanged}
              onLabelsAvailable={mergeRepositoryLabels}
              onMove={(issue) => moveIssue(issue, state === 'open' ? 'closed' : 'open')}
              onBack={() => router.pop()}
            />
            </div>
            {/if}
          {/each}
        {:else}
          <div class="detail-empty">
            <p>왼쪽 목록에서 노트를 선택하세요.</p>
          </div>
        {/if}
      </section>
    </main>
  </div>
  {/if}
{/if}
