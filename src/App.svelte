<script>
  import { onMount, tick } from 'svelte';
  import { createStackRouter } from 'spa-stack-router';
  import NoteEditor from './lib/NoteEditor.svelte';
  import TagSettings from './lib/TagSettings.svelte';
  import { tagColorForName } from './lib/colors.js';
  import { _, locale as activeLocale } from 'svelte-i18n';
  import { LOCALE_OPTIONS, setAppLocale } from './lib/i18n.js';
  import { firstLinePreview, markdownToPlainText } from './lib/notes.js';
  import {
    createIssue,
    createLabel,
    listExpiredClosedIssues,
    listIssuesPage,
    listLabels,
    removeLabel,
    renameLabel,
    purgeIssueAttachments,
    searchIssuesPage,
    setIssueState,
    verifyConnection
  } from './lib/github.js';

  const STORAGE_KEY = 'issue-note.settings.v1';
  const ATTACHMENT_PRUNE_STORAGE_KEY = 'issue-note.attachment-prune.v1';
  const BACKGROUND_REFRESH_MS = 60 * 60 * 1000;
  const ATTACHMENT_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const router = createStackRouter({ mode: 'hashbang', escToBack: true });

  let token = '';
  let tokenInputValue = '';
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
  let externalPasteRequest = null;
  let pasteRequestSequence = 0;
  let pruningExpiredAttachments = false;
  let state = 'open';
  let query = '';
  let activeLabel = '';
  let loading = false;
  let loadingMore = false;
  let issuePage = 1;
  let hasMoreIssues = false;
  let totalIssues = 0;
  let error = '';
  let notice = '';
  let routeStack = [];
  let titleMode = 'first-line';
  let editorFont = 'system';
  let editorFontSize = 16;
  let editorLineHeight = 1.7;
  let autoSaveSeconds = 5;
  let issuePageSize = 30;
  let languagePreference = 'auto';
  let settingsSnapshot = null;
  let backgroundRefreshTimer;
  let labelBusy = '';
  let labelMutation = null;
  let labelMutationSequence = 0;
  let labelRenameDrafts = [];
  let settingsRouteOverride = '';
  let sidebarToolsElement;
  let sidebarToolsOffset = 0;
  let sidebarToolsRevealing = false;
  let lastSidebarScrollTop = 0;
  let issueRefreshSequence = 0;
  let issueRefreshRequests = {};
  let refreshingIssueNumber = null;
  let pendingRouteTransition = null;
  let tokenInput;

  $: emptyMessage = query
    ? $_("m.e9cc6d0e9a")
    : state === 'open'
      ? $_("m.f5dd983c9d")
      : $_("m.123eda8d5e");
  $: patCreationUrl = makePatCreationUrl(repo);
  $: guideRepository = repositoryName(repo);
  $: mcpRepository = repository?.full_name || guideRepository?.fullName || repo.trim();
  $: mcpUsagePrompt = $_('dynamic.mcpPrompt', {
    values: { repo: mcpRepository || 'owner/repository', issueNumber: '{issue number}' }
  });
  $: topRoute = routeStack.at(-1);
  $: contentRoutes = routeStack.filter((route) => ['note', 'new'].includes(route.screen));
  $: contentRoute = contentRoutes.at(-1);
  $: isNewRoute = contentRoute?.screen === 'new';
  $: pendingMatchesLabel = !activeLabel || hasIssueLabel(pendingNote, activeLabel);
  $: visibleIssues = pendingNote && state === 'open' && !query && pendingMatchesLabel
    ? [pendingNote, ...issues.filter((issue) => issue.number !== pendingNote.number)]
    : issues;
  $: displayedIssueCount = pendingNote && state === 'open' && !query && pendingMatchesLabel
    ? Math.max(totalIssues, pendingNote.countBaseline + 1)
    : totalIssues;

  onMount(() => {
    router.init();
    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('paste', handleGlobalPaste);
    const unsubscribe = router.subscribe((stack) => {
      const targetSignature = stack.map((route) => route.segment).join('/');
      if (targetSignature === pendingRouteTransition) return;
      const hadContent = routeStack.some((route) => ['note', 'new'].includes(route.screen));
      const hasContent = stack.some((route) => ['note', 'new'].includes(route.screen));
      const transitionDirection = !hadContent && hasContent
        ? 'forward'
        : hadContent && !hasContent ? 'backward' : '';

      if (shouldAnimateNoteTransition(transitionDirection)) {
        pendingRouteTransition = targetSignature;
        document.documentElement.dataset.noteTransition = transitionDirection;
        const transition = document.startViewTransition(async () => {
          updateRouteStack(stack);
          await tick();
        });
        const clearTransitionDirection = () => {
          if (pendingRouteTransition !== targetSignature) return;
          pendingRouteTransition = null;
          delete document.documentElement.dataset.noteTransition;
        };
        transition.finished.then(clearTransitionDirection, clearTransitionDirection);
        return;
      }

      updateRouteStack(stack);
    });

    function updateRouteStack(stack) {
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
    }

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      repo = saved.repo || '';
      token = saved.token || '';
      rememberToken = Boolean(saved.token);
      titleMode = saved.preferences?.titleMode || 'first-line';
      editorFont = saved.preferences?.editorFont || 'system';
      editorFontSize = Number(saved.preferences?.editorFontSize) || 16;
      editorLineHeight = Number(saved.preferences?.editorLineHeight) || 1.7;
      autoSaveSeconds = clampNumber(saved.preferences?.autoSaveSeconds, 3, 30, 5);
      issuePageSize = clampNumber(saved.preferences?.issuePageSize, 10, 100, 30);
      const savedLanguage = saved.preferences?.language || 'auto';
      languagePreference = LOCALE_OPTIONS.some((option) => option.value === savedLanguage) ? savedLanguage : 'auto';
      setAppLocale(languagePreference);
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
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('paste', handleGlobalPaste);
      unsubscribe();
      router.destroy();
    };
  });

  function shouldAnimateNoteTransition(direction) {
    return Boolean(
      direction
      && appState === 'ready'
      && document.startViewTransition
      && matchMedia('(max-width: 991.98px)').matches
    );
  }

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
        preferences: { titleMode, editorFont, editorFontSize, editorLineHeight, autoSaveSeconds, issuePageSize, language: languagePreference }
      })
    );
  }

  function clampNumber(value, minimum, maximum, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(maximum, Math.max(minimum, number));
  }

  function shouldPruneExpiredAttachments() {
    try {
      const lastPruned = Number(JSON.parse(localStorage.getItem(ATTACHMENT_PRUNE_STORAGE_KEY) || '{}')[repo]);
      return !Number.isFinite(lastPruned) || Date.now() - lastPruned >= ATTACHMENT_PRUNE_INTERVAL_MS;
    } catch {
      return true;
    }
  }

  function markExpiredAttachmentsPruned() {
    try {
      const prunedByRepository = JSON.parse(localStorage.getItem(ATTACHMENT_PRUNE_STORAGE_KEY) || '{}');
      prunedByRepository[repo] = Date.now();
      localStorage.setItem(ATTACHMENT_PRUNE_STORAGE_KEY, JSON.stringify(prunedByRepository));
    } catch {
      // 정리 완료 시각을 기록하지 못해도 다음 연결 시 안전하게 다시 확인한다.
    }
  }

  async function pruneExpiredAttachments() {
    if (pruningExpiredAttachments || !shouldPruneExpiredAttachments()) return;
    pruningExpiredAttachments = true;
    const requestedToken = token;
    const requestedRepo = repo;
    try {
      const expiredIssues = await listExpiredClosedIssues(requestedToken, requestedRepo);
      for (const expiredIssue of expiredIssues) {
        if (selectedIssue?.number === expiredIssue.number) continue;
        await purgeIssueAttachments(requestedToken, requestedRepo, expiredIssue.number);
      }
      if (token === requestedToken && repo === requestedRepo) markExpiredAttachmentsPruned();
    } catch {
      // 백그라운드 정리 실패는 노트 사용 흐름을 방해하지 않고 다음 연결 때 재시도한다.
    } finally {
      pruningExpiredAttachments = false;
    }
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

  function normalizeToken(value) {
    return String(value || '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
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
    if (reason?.status === 401) return $_("m.faea518485");
    if (reason?.status === 404) return $_("m.ff34a34522");
    if (reason?.status === 403 && reason?.remaining === '0') {
      return $_("m.27ef201e27");
    }
    if (reason?.status === 403) return $_("m.26096781ad");
    return reason?.message || $_("m.285cc7fd9a");
  }

  async function copyMcpText(value, successMessage) {
    try {
      await navigator.clipboard.writeText(value);
      notice = successMessage;
      error = '';
    } catch {
      error = $_("m.da21b2386d");
    }
  }

  async function connect(showSuccess = true, restoring = false) {
    const fromSettings = routeStack.at(-1)?.screen === 'settings' && Boolean(settingsSnapshot);
    const replacementToken = normalizeToken(tokenInput?.value || tokenInputValue);
    const requestedToken = replacementToken || (fromSettings ? settingsSnapshot.token : token);
    const requestedRepo = repo;
    error = '';
    notice = '';
    appState = restoring ? 'restoring' : 'connecting';
    try {
      const result = await verifyConnection(requestedToken, requestedRepo);
      if (fromSettings && routeStack.at(-1)?.screen !== 'settings') return;
      token = requestedToken;
      tokenInputValue = '';
      repo = result.repo;
      user = result.user;
      repository = result.repository;
      persistSettings(result.repo);
      if (showSuccess) notice = $_("m.2273eb0763");
      await Promise.all([loadIssues(), loadRepositoryLabels()]);
      appState = 'ready';
      pruneExpiredAttachments();
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
      const result = requestedQuery.trim()
        ? await searchIssuesPage(token, repo, requestedState, requestedQuery, requestedLabel, 1, Date.now(), issuePageSize)
        : await listIssuesPage(token, repo, requestedState, requestedLabel, 1, Date.now(), issuePageSize);
      if (
        requestedQuery !== query
        || requestedState !== state
        || requestedLabel !== activeLabel
      ) return;
      if (background && issuePage > 1) {
        const refreshedIds = new Set(result.items.map((issue) => issue.id));
        issues = [...result.items, ...issues.filter((issue) => !refreshedIds.has(issue.id))];
      } else {
        issues = result.items;
        issuePage = 1;
        hasMoreIssues = result.hasMore;
      }
      if (result.totalCount !== null) totalIssues = result.totalCount;
      applyRoute();
    } catch (reason) {
      if (!background) error = friendlyError(reason);
    } finally {
      if (!background) loading = false;
    }
  }

  async function loadMoreIssues() {
    if (loading || loadingMore || !hasMoreIssues) return;
    const requestedQuery = query;
    const requestedState = state;
    const requestedLabel = activeLabel;
    const nextPage = issuePage + 1;
    loadingMore = true;
    error = '';
    try {
      const result = requestedQuery.trim()
        ? await searchIssuesPage(token, repo, requestedState, requestedQuery, requestedLabel, nextPage, Date.now(), issuePageSize)
        : await listIssuesPage(token, repo, requestedState, requestedLabel, nextPage, Date.now(), issuePageSize);
      if (
        requestedQuery !== query
        || requestedState !== state
        || requestedLabel !== activeLabel
      ) return;
      const knownIds = new Set(issues.map((issue) => issue.id));
      issues = [...issues, ...result.items.filter((issue) => !knownIds.has(issue.id))];
      issuePage = nextPage;
      hasMoreIssues = result.hasMore;
      if (result.totalCount !== null) totalIssues = result.totalCount;
      applyRoute();
    } catch (reason) {
      error = friendlyError(reason);
    } finally {
      loadingMore = false;
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

  function handleSidebarScroll(event) {
    const nextScrollTop = Math.max(0, event.currentTarget.scrollTop);
    const delta = nextScrollTop - lastSidebarScrollTop;
    const toolsHeight = sidebarToolsElement?.offsetHeight || 0;

    if (nextScrollTop <= 0) {
      sidebarToolsOffset = 0;
      sidebarToolsRevealing = true;
    } else if (delta > 0) {
      sidebarToolsRevealing = false;
      sidebarToolsOffset = Math.min(toolsHeight, sidebarToolsOffset + delta);
    } else if (delta < 0) {
      sidebarToolsOffset = 0;
      sidebarToolsRevealing = true;
    }
    lastSidebarScrollTop = nextScrollTop;
  }

  function newNote(initialBody = '', { ignoreRecoveredDraft = false } = {}) {
    const pastedBody = typeof initialBody === 'string' ? initialBody : '';
    error = '';
    const stateChanged = state !== 'open';
    const hadQuery = Boolean(query.trim());
    state = 'open';
    query = '';
    if (!pendingNote) {
      pendingNote = {
        id: 'local-new-note',
        number: null,
        title: $_("m.2b7b05c002"),
        body: pastedBody,
        ignoreRecoveredDraft,
        labels: activeLabel ? [{ name: activeLabel }] : [],
        updated_at: new Date().toISOString(),
        local: true,
        countBaseline: totalIssues,
        allocation: 'creating'
      };
      pendingAllocation = allocatePendingIssue(pendingNote);
    }
    selectedIssue = pendingNote;
    router.navigate('new');
    if (hadQuery || stateChanged) loadIssues();
  }

  function handleGlobalKeydown(event) {
    if (
      appState !== 'ready'
      || topRoute?.screen === 'settings'
      || event.repeat
      || event.altKey
      || event.shiftKey
      || (!event.ctrlKey && !event.metaKey)
      || event.key.toLocaleLowerCase() !== 'n'
    ) return;
    event.preventDefault();
    newNote();
  }

  function handleGlobalPaste(event) {
    if (appState !== 'ready' || topRoute?.screen === 'settings' || isEditableElement(event.target)) return;

    const files = Array.from(event.clipboardData?.files || []);
    const text = event.clipboardData?.getData('text/plain') || '';
    if (!files.length && !text) return;

    event.preventDefault();
    if (contentRoute) {
      if (files.length && state === 'open') {
        notice = '';
        queueExternalPaste(files);
      }
      else if (text) notice = $_('dynamic.pasteLocationRequired');
      return;
    }

    notice = '';
    newNote(text, { ignoreRecoveredDraft: true });
    if (files.length) queueExternalPaste(files);
  }

  function isEditableElement(element) {
    return element instanceof HTMLTextAreaElement
      || element instanceof HTMLInputElement
      || Boolean(element?.isContentEditable);
  }

  function queueExternalPaste(files) {
    externalPasteRequest = { id: ++pasteRequestSequence, files };
  }

  function externalPasteHandled(id) {
    if (externalPasteRequest?.id === id) externalPasteRequest = null;
  }

  async function allocatePendingIssue(localNote) {
    try {
      const created = await createIssue(token, repo, {
        title: $_("m.2b7b05c002"),
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
      error = $_('dynamic.allocateFailed', { values: { error: friendlyError(reason) } });
      return null;
    }
  }

  function selectNote(issue) {
    if (!issue.local) {
      refreshingIssueNumber = issue.number;
      issueRefreshRequests = {
        ...issueRefreshRequests,
        [issue.number]: ++issueRefreshSequence
      };
    }
    router.navigate(issue.local ? 'new' : `note.${issue.number}`);
  }

  function noteRefreshStateChanged(issueNumber, active) {
    if (active) refreshingIssueNumber = issueNumber;
    else if (refreshingIssueNumber === issueNumber) refreshingIssueNumber = null;
  }

  function noteSaved(savedIssue, localDraft = null) {
    const displayedIssue = localDraft ? { ...savedIssue, ...localDraft } : savedIssue;
    issues = issues.map((issue) => issue.id === savedIssue.id ? displayedIssue : issue);
    const savedIssueIsActive = contentRoute?.screen === 'note'
      && Number(contentRoute.value) === savedIssue.number;
    if (savedIssueIsActive) selectedIssue = displayedIssue;
    if (savedIssueIsActive && activeLabel && !hasIssueLabel(displayedIssue, activeLabel)) {
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
    totalIssues = Math.max(totalIssues, (pendingNote?.countBaseline ?? totalIssues) + 1);
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
    return tagColorForName(label?.name);
  }

  function noteDraftChanged(sourceIssue, draft) {
    if (!sourceIssue) {
      if (!pendingNote) return;
      pendingNote = { ...pendingNote, ...draft };
      if (isNewRoute) selectedIssue = pendingNote;
      return;
    }

    issues = issues.map((issue) => issue.id === sourceIssue.id ? { ...issue, ...draft } : issue);
    if (selectedIssue?.id === sourceIssue.id) selectedIssue = { ...selectedIssue, ...draft };
  }

  function mergeRepositoryLabels(nextLabels) {
    const labelsByName = new Map(
      [...repositoryLabels, ...nextLabels].map((label) => [label.name.toLocaleLowerCase(), label])
    );
    repositoryLabels = [...labelsByName.values()].sort((a, b) => a.name.localeCompare(b.name, $activeLocale));
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
        .sort((a, b) => a.name.localeCompare(b.name, $activeLocale));
      issues = issues.map((issue) => replaceLabelInIssue(issue, label.name, savedLabel.name));
      pendingNote = replaceLabelInIssue(pendingNote, label.name, savedLabel.name);
      selectedIssue = replaceLabelInIssue(selectedIssue, label.name, savedLabel.name);
      updateDraftLabels(connectedRepo, label.name, savedLabel.name);
      labelMutation = { id: ++labelMutationSequence, from: label.name, to: savedLabel.name };
      notice = $_('dynamic.tagRenamed', { values: { from: label.name, to: savedLabel.name } });
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
        error = $_('dynamic.tagNameRequired', { values: { name: label.name } });
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
    return Boolean(normalizeToken(tokenInput?.value || tokenInputValue))
      || requestedRepo.toLocaleLowerCase() !== savedRepo.toLocaleLowerCase();
  }

  function finishLocalSettingsSave() {
    const pageSizeChanged = issuePageSize !== settingsSnapshot?.issuePageSize;
    tokenInputValue = '';
    repo = repository?.full_name || repositoryName(repo)?.fullName || repo.trim();
    autoSaveSeconds = clampNumber(autoSaveSeconds, 3, 30, 5);
    issuePageSize = Math.round(clampNumber(issuePageSize, 10, 100, 30));
    persistSettings(repo);
    settingsSnapshot = null;
    labelRenameDrafts = [];
    appState = 'ready';
    notice = '';
    router.pop();
    if (pageSizeChanged) loadIssues();
  }

  async function saveConfiguration() {
    if (topRoute?.screen !== 'settings') {
      await connect(true);
      return;
    }

    error = '';
    notice = '';
    autoSaveSeconds = clampNumber(autoSaveSeconds, 3, 30, 5);
    issuePageSize = Math.round(clampNumber(issuePageSize, 10, 100, 30));
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
      notice = $_('dynamic.tagAdded', { values: { name: savedLabel.name } });
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
      notice = $_('dynamic.tagDeleted', { values: { name: label.name } });
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
    const confirmKey = nextState === 'closed' ? 'dynamic.moveToTrashConfirm' : 'dynamic.restoreConfirm';
    if (!confirm($_(confirmKey, { values: { title: issue.title } }))) return;

    error = '';
    try {
      await setIssueState(token, repo, issue.number, nextState);
      issues = issues.filter((item) => item.id !== issue.id);
      totalIssues = Math.max(0, totalIssues - 1);
      if (selectedIssue?.id === issue.id) {
        selectedIssue = null;
        if (router.getDepth()) router.popTo(0);
      }
      notice = nextState === 'closed'
        ? $_("m.1fe3b7e75f")
        : $_("m.a480a954e7");
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
      editorLineHeight,
      autoSaveSeconds,
      issuePageSize,
      languagePreference
    };
    error = '';
    notice = '';
    labelRenameDrafts = [];
    tokenInputValue = '';
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
      editorLineHeight,
      autoSaveSeconds,
      issuePageSize,
      languagePreference
    } = settingsSnapshot);
    setAppLocale(languagePreference);
    tokenInputValue = '';
    settingsSnapshot = null;
    labelRenameDrafts = [];
    error = '';
  }

  function closeSettings() {
    router.pop();
  }

  function forgetSettings() {
    if (!confirm($_("m.ad0db93efe"))) return;
    localStorage.removeItem(STORAGE_KEY);
    token = '';
    tokenInputValue = '';
    repo = '';
    user = null;
    repository = null;
    issues = [];
    totalIssues = 0;
    repositoryLabels = [];
    pendingNote = null;
    selectedIssue = null;
    settingsSnapshot = null;
    settingsRouteOverride = '';
    appState = 'setup';
    router.navigate('/');
    notice = $_("m.b5f846b636");
  }

  function excerpt(body) {
    const text = markdownToPlainText(body);
    return text || $_("m.0c3fd88e60");
  }

  function autoTitleExcerpt(body) {
    return firstLinePreview(body) || $_("m.0c3fd88e60");
  }

  function formatDate(value) {
    return new Intl.DateTimeFormat($activeLocale, {
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
      {appState === 'restoring' ? $_("m.dc21c1787a") : $_("m.e5f58095ac")}
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
                {topRoute?.screen === 'settings' ? $_("m.c7f73bb54d") : $_("m.3fc1eae89b")}
              </h2>
              <p class="text-secondary mb-0">
                {$_("m.5353b36687")}
              </p>
            </div>
            {#if topRoute?.screen === 'settings'}
              <button
                class="btn btn-sm btn-outline-secondary flex-shrink-0"
                aria-label={$_("m.6bf9c432ba")}
                disabled={appState === 'connecting'}
                on:click={closeSettings}
              ><i class="bi bi-x-lg" aria-hidden="true"></i> {$_("m.bbfa773e5a")}</button>
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
              <label for="repo" class="form-label fw-semibold">{$_("m.4fb2726ea2")}</label>
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
                {$_("m.8aee94f673")}
              </div>
            </div>

            {#if topRoute?.screen !== 'settings'}
              <details class="pat-guide mb-3">
                <summary class="d-flex align-items-center justify-content-between gap-3">
                  <span>
                    <strong>{$_("m.5b39a43d96")}</strong>
                    <small class="d-block text-secondary mt-1">{$_("m.ba93cbcae9")}</small>
                  </span>
                  <span class="guide-chevron" aria-hidden="true">⌄</span>
                </summary>
                <div class="pat-guide-body border-top">
                  <ol class="pat-steps mb-3">
                    <li>
                      <strong>{$_("m.9427a3c386")}</strong>
                      <span>{$_("m.3a6af7cffb")}</span>
                    </li>
                    <li>
                      <strong>{$_("m.cd2ebdde1e")}</strong>
                      <span>{$_("m.1e1d9278a9")}</span>
                    </li>
                    <li>
                      <strong>{$_("m.7cbd5de99f")}</strong>
                      <span>{$_("m.173f95f145")}</span>
                    </li>
                  </ol>
                  <a class="btn btn-outline-primary w-100" href="https://github.com/new" target="_blank" rel="noreferrer">
                    <i class="bi bi-github" aria-hidden="true"></i> {$_("m.ca57d50f39")}
                  </a>
                </div>
              </details>
            {/if}

            <div class="mb-3">
              <label for="token" class="form-label fw-semibold">Fine-grained PAT</label>
              <input
                bind:this={tokenInput}
                id="token"
                type="password"
                class="form-control form-control-lg font-monospace"
                bind:value={tokenInputValue}
                placeholder={topRoute?.screen === 'settings' ? $_('settings.patReplacementPlaceholder') : 'github_pat_...'}
                autocomplete="off"
                autocorrect="off"
                autocapitalize="none"
                inputmode="text"
                spellcheck="false"
                required={topRoute?.screen !== 'settings'}
              />
              <div class="form-text">
                {$_("m.4abc5f6e21")}
              </div>
            </div>

            <details class="pat-guide mb-4">
              <summary class="d-flex align-items-center justify-content-between gap-3">
                <span>
                  <strong>{$_("m.21cbbd1140")}</strong>
                  <small class="d-block text-secondary mt-1">{$_("m.d04fed6bcf")}</small>
                </span>
                <span class="guide-chevron" aria-hidden="true">⌄</span>
              </summary>
              <div class="pat-guide-body border-top">
                <ol class="pat-steps mb-4">
                  <li>
                    <strong>{$_("m.db62fae7da")}</strong>
                    <span>{$_("m.0b0c013e12")}</span>
                  </li>
                  <li>
                    <strong>{$_("m.b96aa5e1b1")}</strong>
                    <span>
                      {guideRepository
                        ? $_('dynamic.selectOwner', { values: { owner: guideRepository.owner } })
                        : $_("m.29fa6a570b")}
                    </span>
                  </li>
                  <li>
                    <strong>{$_("m.3325d60301")}</strong>
                    <span>
                      {guideRepository
                        ? $_('dynamic.selectRepository', { values: { repo: guideRepository.fullName } })
                        : $_("m.d1b62c70da")}
                    </span>
                  </li>
                  <li>
                    <strong>{$_("m.5703d9fc46")}</strong>
                    <span>{$_("m.04228b3615")}</span>
                  </li>
                  <li>
                    <strong>{$_("m.3561bf447a")}</strong>
                    <span>{$_("m.070e34fd3a")}</span>
                  </li>
                </ol>
                <a
                  class="btn btn-outline-primary w-100"
                  href={patCreationUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <i class="bi bi-key" aria-hidden="true"></i>
                  {guideRepository
                    ? $_('dynamic.createPat', { values: { name: guideRepository.name } })
                    : $_("m.619a5ff1e5")}
                </a>
                <p class="small text-secondary mt-2 mb-0">
                  {$_("m.6ae25506ba")}
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
              <label class="form-check-label" for="remember">{$_("m.75912b5db6")}</label>
            </div>

            <fieldset class="editor-settings mb-4">
              <legend>{$_("m.cf8e8136d8")}</legend>
              <div class="mb-3">
                <label class="form-label" for="language">{$_('settings.language')}</label>
                <select
                  id="language"
                  class="form-select"
                  bind:value={languagePreference}
                  on:change={() => setAppLocale(languagePreference)}
                >
                  {#each LOCALE_OPTIONS as option (option.value)}
                    <option value={option.value}>{option.label}</option>
                  {/each}
                </select>
              </div>
              <div class="mb-3">
                <label class="form-label" for="title-mode">{$_("m.871b7ed110")}</label>
                <select id="title-mode" class="form-select" bind:value={titleMode}>
                  <option value="first-line">{$_("m.7358ee0f0a")}</option>
                  <option value="separate">{$_("m.4a13beb6d6")}</option>
                </select>
              </div>
              <div class="row g-2">
                <div class="col-sm-6">
                  <label class="form-label" for="editor-font">{$_("m.b97c4d4cdd")}</label>
                  <select id="editor-font" class="form-select" bind:value={editorFont}>
                    <option value="system">{$_("m.9d8d380806")}</option>
                    <option value="sans">{$_("m.ecc39dc539")}</option>
                    <option value="serif">{$_("m.a5c78a86fa")}</option>
                    <option value="mono">{$_("m.216fcddff2")}</option>
                  </select>
                </div>
                <div class="col-6 col-sm-3">
                  <label class="form-label" for="font-size">{$_("m.b7152342a2")}</label>
                  <input id="font-size" class="form-control" type="number" min="12" max="32" step="1" bind:value={editorFontSize} />
                </div>
                <div class="col-6 col-sm-3">
                  <label class="form-label" for="line-height">{$_("m.65be5133e7")}</label>
                  <input id="line-height" class="form-control" type="number" min="1.2" max="2.5" step="0.1" bind:value={editorLineHeight} />
                </div>
              </div>
              <div class="row g-2 mt-1">
                <div class="col-6">
                  <label class="form-label" for="auto-save-seconds">{$_("Auto-save delay")}</label>
                  <div class="input-group">
                    <input id="auto-save-seconds" class="form-control" type="number" min="3" max="30" step="1" bind:value={autoSaveSeconds} />
                    <span class="input-group-text">{$_("sec")}</span>
                  </div>
                </div>
                <div class="col-6">
                  <label class="form-label" for="issue-page-size">{$_("Notes per page")}</label>
                  <input id="issue-page-size" class="form-control" type="number" min="10" max="100" step="1" bind:value={issuePageSize} />
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
                    <strong><i class="bi bi-robot me-2" aria-hidden="true"></i>{$_("m.5fe5834eaa")}</strong>
                    <small class="d-block text-secondary mt-1">{$_("m.5d80d297c5")}</small>
                  </span>
                  <span class="guide-chevron" aria-hidden="true">⌄</span>
                </summary>
                <div class="pat-guide-body border-top">
                  <p class="small text-secondary">
                    {$_("m.e83c891d49")}
                  </p>

                  <div class="mcp-repository mb-3">
                    <span class="small text-secondary">{$_("m.4b3f74b117")}</span>
                    <div class="input-group input-group-sm mt-1">
                      <input class="form-control font-monospace" value={mcpRepository} readonly aria-label={$_("m.d53b2b9304")} />
                      <button
                        type="button"
                        class="btn btn-outline-secondary"
                        on:click={() => copyMcpText(mcpRepository, $_("m.f200511c62"))}
                        disabled={!mcpRepository}
                      ><i class="bi bi-copy" aria-hidden="true"></i> {$_("m.af74f7c536")}</button>
                    </div>
                  </div>

                  <ol class="pat-steps mb-3">
                    <li>
                      <strong>{$_("m.3bfe3b4ca9")}</strong>
                      <span>{$_("m.a361d3f1f3")}</span>
                    </li>
                    <li>
                      <strong>{$_("m.d011f1e8c4")}</strong>
                      <span>{$_("m.b7aa3105c9")}</span>
                    </li>
                    <li>
                      <strong>{$_("m.7eb30a2712")}</strong>
                      <span>{$_("m.bbd3fa2b66")}</span>
                    </li>
                  </ol>

                  <p class="small text-secondary">
                    {$_("m.178f58ebdd")}
                    {' '}<code>&lt;!-- issue-note-attachment:... --&gt;</code>{' '}
                    {$_("m.fbdd445070")}
                  </p>

                  <label class="form-label small" for="mcp-usage-prompt">{$_("m.2838abde9d")}</label>
                  <textarea id="mcp-usage-prompt" class="form-control form-control-sm mcp-prompt mb-2" readonly value={mcpUsagePrompt}></textarea>
                  <button
                    type="button"
                    class="btn btn-sm btn-outline-primary w-100 mb-2"
                    on:click={() => copyMcpText(mcpUsagePrompt, $_("m.bacaacbf86"))}
                  ><i class="bi bi-copy" aria-hidden="true"></i> {$_("m.81979baa04")}</button>
                  <a
                    class="btn btn-sm btn-outline-secondary w-100"
                    href="https://github.com/github/github-mcp-server"
                    target="_blank"
                    rel="noreferrer"
                  ><i class="bi bi-box-arrow-up-right" aria-hidden="true"></i> {$_("m.6b45c11893")}</a>
                </div>
              </details>
            {/if}

            <button class="btn btn-primary btn-lg w-100" disabled={appState === 'connecting'}>
              <i
                class={`bi ${topRoute?.screen === 'settings' ? 'bi-check-lg' : 'bi-link-45deg'}`}
                aria-hidden="true"
              ></i>
              {appState === 'connecting'
                ? topRoute?.screen === 'settings' ? $_("m.984f7f9989") : $_("m.7bf98200dd")
                : topRoute?.screen === 'settings' ? $_("m.913aba9f96") : $_("m.9151e7b39d")}
            </button>
          </form>

          {#if localStorage.getItem(STORAGE_KEY)}
            <button class="btn btn-link text-danger w-100 mt-3" on:click={forgetSettings}>
              <i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.da4c8914b3")}
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
              <button class="sidebar-profile" on:click={openSettings} aria-label={$_("m.fd7108f831")}>
                <img class="avatar" src={user.avatar_url} alt={user.login} />
              </button>
            {/if}
            <div class="sidebar-heading-title">
              <h1>{activeLabel ? `#${activeLabel}` : state === 'open' ? $_("m.70440046a3") : $_("m.e3bf62bb7f")}</h1>
              <span>{$_('dynamic.noteCount', { values: { count: displayedIssueCount } })}</span>
            </div>
          </div>
          <button class="btn btn-primary responsive-toolbar-button" on:click={newNote}>
            <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_("m.2b7b05c002")}
          </button>
        </div>

        {#if error}
          <div class="sidebar-message text-danger">{error}</div>
        {/if}
        {#if notice}
          <div class="sidebar-message text-success">{notice}</div>
        {/if}

        <div class="note-list" class:is-loading={loading}>
          <div class="note-list-scroll" on:scroll={handleSidebarScroll}>
            <div
              class="sidebar-tools"
              class:is-revealing={sidebarToolsRevealing}
              bind:this={sidebarToolsElement}
              style={`--sidebar-tools-offset:${sidebarToolsOffset}px`}
            >
              <div class="state-tabs" role="group" aria-label={$_("m.cd9fe96e05")}>
                <button class:active={state === 'open'} on:click={() => changeState('open')}>
                  <i class="bi bi-journal-text" aria-hidden="true"></i> {$_("m.70440046a3")}
                </button>
                <button class:active={state === 'closed'} on:click={() => changeState('closed')}>
                  <i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.e3bf62bb7f")}
                </button>
              </div>
              <form class="sidebar-search" on:submit|preventDefault={submitSearch}>
                <input
                  type="search"
                  bind:value={query}
                  placeholder={$_("m.55a302a1a9")}
                  aria-label={$_("m.2bca6e4c82")}
                  list="sidebar-label-suggestions"
                />
                <datalist id="sidebar-label-suggestions">
                  {#each repositoryLabels as label (label.id || label.name)}
                    <option value={`#${label.name}`}></option>
                  {/each}
                </datalist>
                <button disabled={loading}><i class="bi bi-search" aria-hidden="true"></i> {$_("m.bce0641417")}</button>
                {#if query}
                  <button
                    type="button"
                    on:click={() => {
                      query = '';
                      loadIssues();
                    }}
                  ><i class="bi bi-x-lg" aria-hidden="true"></i> {$_("m.719ea396ad")}</button>
                {/if}
              </form>
              {#if activeLabel}
                <div class="active-label-filter">
                  <span>#{activeLabel}</span>
                  <button type="button" on:click={clearLabel} aria-label={$_('dynamic.clearFilter', { values: { label: activeLabel } })}>
                    <i class="bi bi-x-lg" aria-hidden="true"></i>
                  </button>
                </div>
              {/if}
            </div>
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
                  aria-label={$_('dynamic.openNote', { values: { title: issue.title } })}
                ></button>
                <div class="note-row-content">
                  {#if titleMode === 'separate'}
                    <span class="note-row-title">{markdownToPlainText(issue.title)}</span>
                  {/if}
                  <span
                    class="note-row-preview"
                    class:auto-title-preview={titleMode === 'first-line'}
                  >{titleMode === 'first-line' ? autoTitleExcerpt(issue.body) : excerpt(issue.body)}</span>
                  <span class="note-row-meta">
                    {issue.local ? $_("m.6f65454664") : `#${issue.number} · ${formatDate(issue.updated_at)}`}
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
                {#if refreshingIssueNumber === issue.number}
                  <span class="note-row-refresh-spinner" aria-label={$_("m.6e6e21803f")}>
                    <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
                  </span>
                {/if}
              </article>
              {/each}
              {#if hasMoreIssues}
                <div class="list-load-more">
                  <button class="btn btn-sm btn-link text-secondary" disabled={loadingMore} on:click={loadMoreIssues}>
                    {#if loadingMore}
                      <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
                    {:else}
                      <i class="bi bi-chevron-down" aria-hidden="true"></i>
                    {/if}
                    {$_("m.dfe60ca92e")}
                  </button>
                </div>
              {/if}
            {/if}
          </div>
          {#if loading}
            <div class="list-api-overlay" aria-label={$_("m.6e6e21803f")}>
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
              initialDraft={route.screen === 'new' ? pendingNote : null}
              ignoreRecoveredDraft={route.screen === 'new' && Boolean(pendingNote?.ignoreRecoveredDraft)}
              externalPasteRequest={route === contentRoute ? externalPasteRequest : null}
              refreshRequest={routeIssue ? issueRefreshRequests[routeIssue.number] || 0 : 0}
              allocatedIssue={route.screen === 'new' ? pendingNote?.allocatedIssue : null}
              allocationPromise={route.screen === 'new' ? pendingAllocation : null}
              editorId={route.segment.replace(/[^a-zA-Z0-9_-]/g, '-')}
              archived={state === 'closed'}
              {titleMode}
              font={editorFont}
              fontSize={editorFontSize}
              lineHeight={editorLineHeight}
              {autoSaveSeconds}
              paused={topRoute?.screen === 'settings' || route !== contentRoute}
              availableLabels={repositoryLabels}
              {labelMutation}
              onSaved={noteSaved}
              onRefreshed={noteRefreshed}
              onRefreshStateChange={(active) => noteRefreshStateChanged(routeIssue?.number, active)}
              onCreated={noteCreated}
              onDraftChange={(draft) => noteDraftChanged(routeIssue, draft)}
              onExternalPasteHandled={externalPasteHandled}
              onLabelsAvailable={mergeRepositoryLabels}
              onMove={(issue) => moveIssue(issue, state === 'open' ? 'closed' : 'open')}
              onBack={() => router.pop()}
            />
            </div>
            {/if}
          {/each}
        {:else}
          <div class="detail-empty">
            <p>{$_("m.15147e26a7")}</p>
          </div>
        {/if}
      </section>
    </main>
  </div>
  {/if}
{/if}
