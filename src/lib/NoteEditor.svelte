<script>
  import { afterUpdate, onDestroy, onMount, tick } from 'svelte';
  import { tagColorForName } from './colors.js';
  import { _ } from 'svelte-i18n';
  import BrailleSpinner from './BrailleSpinner.svelte';
  import TagPicker from './TagPicker.svelte';
  import { automaticTitle, linkAtCursor, shortenMiddle } from './notes.js';
  import {
    createAttachmentComment,
    createIssue,
    createLabel,
    deleteAttachment,
    deleteAttachmentComment,
    downloadAttachment,
    getIssue,
    listIssueAttachmentComments,
    listIssueAttachmentFiles,
    updateIssue,
    uploadAttachment
  } from './github.js';

  export let token;
  export let repo;
  export let editorId = 'note';
  export let issue = null;
  export let initialDraft = null;
  export let ignoreRecoveredDraft = false;
  export let externalPasteRequest = null;
  export let refreshRequest = 0;
  export let allocatedIssue = null;
  export let allocationPromise = null;
  export let archived = false;
  export let titleMode = 'first-line';
  export let font = 'system';
  export let fontSize = 16;
  export let lineHeight = 1.7;
  export let autoSaveSeconds = 5;
  export let paused = false;
  export let availableLabels = [];
  export let labelMutation = null;
  export let onSaved = () => {};
  export let onCreated = () => {};
  export let onDraftChange = () => {};
  export let onExternalPasteHandled = () => {};
  export let onRefreshed = () => {};
  export let onRefreshStateChange = () => {};
  export let onLabelsAvailable = () => {};
  export let onMove = () => {};
  export let onBack = () => {};

  const DRAFTS_KEY = 'issue-note.drafts.v1';
  const MAX_ATTACHMENTS = 30;
  const draftId = issue ? `issue.${issue.number}` : 'new';

  let title = issue?.title || initialDraft?.title || '';
  let body = issue?.body || initialDraft?.body || '';
  let attachments = [];
  let remoteIssue = issue || allocatedIssue;
  let labels = (issue?.labels || initialDraft?.labels || []).map((label) => label.name);
  let dirty = false;
  let saving = false;
  let refreshing = false;
  let backgroundRefreshing = false;
  let uploading = 0;
  let uploadBatchActive = false;
  let deletingPath = '';
  let previewUrls = {};
  let viewerIndex = -1;
  let viewerElement;
  let appliedLabelMutation = 0;
  let revision = 0;
  let lastRemoteSignature = issue ? noteSignature({
    title: issue.title || '',
    body: issue.body || '',
    labels: (issue.labels || []).map((label) => label.name)
  }) : '';
  let forceSaveQueued = false;
  let saveFailed = false;
  let draggingFiles = false;
  let reconciledIssueNumber = null;
  let destroyed = false;
  let wasPaused = paused;
  let loadingAttachments = Number(remoteIssue?.comments || 0) > 0;
  let error = '';
  let localTimer;
  let remoteTimer;
  let fileInput;
  let bodyInput;
  let linkTooltip;
  let activeLink = null;
  let linkTooltipStyle = '';
  let mounted = false;
  let handledRefreshRequest = 0;
  let handledExternalPasteRequest = 0;

  $: fontStack = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif',
    sans: 'Pretendard, "Noto Sans KR", sans-serif',
    serif: '"Noto Serif KR", "Batang", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  }[font] || 'sans-serif';
  $: viewedAttachment = viewerIndex >= 0 ? attachments[viewerIndex] : null;
  $: compactStatus = archived
    ? $_("m.601dcc1c87")
    : saveFailed
      ? $_("m.0a44446762")
      : saving || dirty
        ? $_("m.369c534df3")
        : issue
          ? $_("m.c0ae8f6ea8")
          : $_("m.2b7b05c002");
  $: if (!issue && allocatedIssue?.number && remoteIssue?.number !== allocatedIssue.number) {
    remoteIssue = allocatedIssue;
  }
  $: if (remoteIssue?.number && reconciledIssueNumber !== remoteIssue.number) {
    reconciledIssueNumber = remoteIssue.number;
    reconcileIssueAttachments(remoteIssue.number);
  }
  $: if (labelMutation?.id && labelMutation.id !== appliedLabelMutation) {
    applyLabelMutation(labelMutation);
  }
  $: if (mounted && !paused && refreshRequest > handledRefreshRequest) {
    handleBackgroundRefreshRequest();
  }
  $: if (mounted && !paused && externalPasteRequest?.id > handledExternalPasteRequest) {
    handleExternalPasteRequest();
  }

  onMount(() => {
    const recovered = archived || ignoreRecoveredDraft ? null : readDraft();
    if (recovered) {
      title = recovered.title;
      body = recovered.body;
      labels = Array.isArray(recovered.labels) ? recovered.labels : labels;
      dirty = true;
      notifyDraftChange();
      scheduleRemoteSave();
    } else if (initialDraft?.body) {
      changed();
    }

    mounted = true;
    handleBackgroundRefreshRequest();

    localTimer = setInterval(() => {
      if (dirty) persistLocalDraft();
    }, 1000);
    window.addEventListener('beforeunload', handlePageExit);
    window.addEventListener('pagehide', handlePageExit);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    if (!issue && !archived && !paused) {
      tick().then(() => bodyInput?.focus());
    }

  });

  afterUpdate(() => {
    const becamePaused = paused && !wasPaused;
    wasPaused = paused;
    if (becamePaused && dirty) flushRemoteSave();
  });

  onDestroy(() => {
    if (dirty) persistLocalDraft();
    clearInterval(localTimer);
    clearTimeout(remoteTimer);
    window.removeEventListener('beforeunload', handlePageExit);
    window.removeEventListener('pagehide', handlePageExit);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    if (dirty) saveRemote(false, true);
    destroyed = true;
    Object.values(previewUrls).forEach((url) => URL.revokeObjectURL(url));
  });

  function draftStore() {
    try {
      return JSON.parse(localStorage.getItem(DRAFTS_KEY) || '{}');
    } catch {
      return {};
    }
  }

  function readDraft() {
    return draftStore()[repo]?.[draftId] || null;
  }

  function persistLocalDraft() {
    if (!dirty) return;
    const store = draftStore();
    store[repo] ||= {};
    store[repo][draftId] = { title, body, labels, savedAt: Date.now() };
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
  }

  function removeLocalDraft() {
    const store = draftStore();
    if (!store[repo]) return;
    delete store[repo][draftId];
    if (!Object.keys(store[repo]).length) delete store[repo];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
  }

  function flushRemoteSave(requestOptions = {}) {
    if (!dirty || archived) return;
    persistLocalDraft();
    if (refreshing) return;
    clearTimeout(remoteTimer);
    if (saving && requestOptions.keepalive) {
      saveKeepaliveSnapshot(requestOptions);
      return;
    }
    saveRemote(false, true, requestOptions);
  }

  function saveKeepaliveSnapshot(requestOptions) {
    const targetIssue = issue || remoteIssue;
    const note = currentNote();
    if (!targetIssue?.number || !note.title) return;
    updateIssue(token, repo, targetIssue.number, note, requestOptions).catch(() => {
      // 종료 중 요청이 실패해도 동기 저장된 로컬 초안으로 다음 실행 때 복구한다.
    });
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'hidden') flushRemoteSave();
  }

  function handlePageExit() {
    flushRemoteSave({ keepalive: true });
  }

  function finishAttachmentLoad() {
    loadingAttachments = false;
  }

  function changed() {
    if (archived) return;
    if (titleMode === 'first-line') title = automaticTitle(body);
    dirty = true;
    saveFailed = false;
    revision += 1;
    error = '';
    notifyDraftChange();
    scheduleRemoteSave();
  }

  function notifyDraftChange() {
    onDraftChange(draftPayload());
  }

  function draftPayload() {
    const resolvedTitle = titleMode === 'first-line' ? automaticTitle(body) : title.trim();
    return {
      title: resolvedTitle || $_("m.2b7b05c002"),
      body,
      labels: labels.map((name) => ({ name })),
      updated_at: new Date().toISOString()
    };
  }

  function scheduleRemoteSave(delay = autoSaveSeconds * 1000) {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => saveRemote(), delay);
  }

  function currentNote() {
    const resolvedTitle = titleMode === 'first-line'
      ? automaticTitle(body) || (attachments.length ? $_("m.c33437b1cb") : '')
      : title.trim();
    return {
      title: resolvedTitle,
      body,
      labels
    };
  }

  function noteSignature(note) {
    return JSON.stringify({
      title: note.title,
      body: note.body,
      labels: note.labels
    });
  }

  async function resolveRemoteIssue() {
    if (remoteIssue?.number) return remoteIssue;
    if (!allocationPromise) return null;
    const allocated = await allocationPromise;
    if (allocated?.number) remoteIssue = allocated;
    return remoteIssue;
  }

  async function saveRemote(force = false, allowPaused = false, requestOptions = {}) {
    if (archived) return;
    if (saving) {
      if (force) {
        forceSaveQueued = true;
      }
      return;
    }
    if (!force && !dirty) return;
    if (paused && !allowPaused) {
      if (!force) scheduleRemoteSave();
      return;
    }
    persistLocalDraft();
    const note = currentNote();
    if (!note.title) {
      return;
    }
    const signature = noteSignature(note);
    if (!force && signature === lastRemoteSignature) {
      dirty = false;
      removeLocalDraft();
      return;
    }

    const savingRevision = revision;
    saving = true;
    saveFailed = false;
    error = '';

    try {
      const knownNames = new Set(availableLabels.map((label) => label.name.toLocaleLowerCase()));
      const missingNames = labels.filter((name) => !knownNames.has(name.toLocaleLowerCase()));
      const createdLabels = await Promise.all(
        missingNames.map((name) => createLabel(token, repo, name, requestOptions))
      );
      if (createdLabels.length) {
        availableLabels = [...availableLabels, ...createdLabels];
        onLabelsAvailable(createdLabels);
      }

      const targetIssue = issue || await resolveRemoteIssue();
      const saved = targetIssue
        ? await updateIssue(token, repo, targetIssue.number, note, requestOptions)
        : await createIssue(token, repo, note, requestOptions);

      remoteIssue = saved;
      lastRemoteSignature = signature;
      const hasNewerChanges = savingRevision !== revision || noteSignature(currentNote()) !== signature;
      if (issue) onSaved(saved, hasNewerChanges ? draftPayload() : null);
      if (!hasNewerChanges) {
        dirty = false;
        removeLocalDraft();
      } else {
        scheduleRemoteSave();
      }
      saveFailed = false;

      if (!issue && !hasNewerChanges) onCreated(saved);
    } catch (reason) {
      saveFailed = true;
      error = reason?.status === 401
        ? $_("m.faea518485")
        : reason?.status === 403
          ? $_("m.fde564557e")
          : reason?.message || $_("m.3a743b0e61");
      scheduleRemoteSave(15000);
    } finally {
      saving = false;
      if (forceSaveQueued) {
        forceSaveQueued = false;
        clearTimeout(remoteTimer);
        saveRemote(true);
      }
    }
  }

  function handleBackgroundRefreshRequest() {
    if (refreshRequest <= handledRefreshRequest) return;
    handledRefreshRequest = refreshRequest;
    if (!dirty && !saving) refreshIssue(true);
    else onRefreshStateChange(false);
  }

  function handleExternalPasteRequest() {
    const request = externalPasteRequest;
    if (!request?.id || request.id <= handledExternalPasteRequest) return;
    handledExternalPasteRequest = request.id;
    onExternalPasteHandled(request.id);
    uploadFiles(request.files);
  }

  async function refreshIssue(background = false) {
    const targetIssue = issue || remoteIssue;
    if (!targetIssue?.number || saving || refreshing || backgroundRefreshing) {
      if (background) onRefreshStateChange(false);
      return;
    }
    if (background && dirty) {
      onRefreshStateChange(false);
      return;
    }
    if (!background && dirty && !confirm($_("m.37533033a1"))) {
      return;
    }

    const hadDirtyChanges = dirty;
    const startingRevision = revision;
    const startingSignature = noteSignature(currentNote());
    if (background) {
      backgroundRefreshing = true;
      onRefreshStateChange(true);
    }
    else {
      refreshing = true;
      error = '';
      clearTimeout(remoteTimer);
    }
    try {
      const refreshed = await getIssue(token, repo, targetIssue.number);
      if (destroyed) return;
      if (
        background
        && (dirty || revision !== startingRevision || noteSignature(currentNote()) !== startingSignature)
      ) return;
      const refreshedSignature = noteSignature({
        title: refreshed.title || '',
        body: refreshed.body || '',
        labels: (refreshed.labels || []).map((label) => label.name)
      });
      if (background && refreshedSignature === startingSignature) {
        remoteIssue = refreshed;
        lastRemoteSignature = refreshedSignature;
        return;
      }
      remoteIssue = refreshed;
      title = refreshed.title || '';
      body = refreshed.body || '';
      labels = (refreshed.labels || []).map((label) => label.name);
      dirty = false;
      revision += 1;
      lastRemoteSignature = noteSignature({ title, body, labels });
      removeLocalDraft();
      onRefreshed(refreshed);

      loadingAttachments = Number(refreshed.comments || 0) > 0;
      reconciledIssueNumber = null;
    } catch (reason) {
      if (background) return;
      error = reason?.message || $_("m.a129ed8520");
      if (hadDirtyChanges) scheduleRemoteSave();
    } finally {
      if (background) {
        backgroundRefreshing = false;
        onRefreshStateChange(false);
      }
      else refreshing = false;
    }
  }

  async function uploadFiles(fileList) {
    if (archived) return;
    if (uploadBatchActive) {
      error = $_("m.12c0dff05d");
      return;
    }
    uploadBatchActive = true;
    const requestedFiles = Array.from(fileList || []);
    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const files = requestedFiles.slice(0, remainingSlots);
    const limitReached = requestedFiles.length > remainingSlots;
    if (!files.length) {
      if (limitReached) error = $_('dynamic.attachmentLimit', { values: { count: MAX_ATTACHMENTS } });
      if (fileInput) fileInput.value = '';
      uploadBatchActive = false;
      return;
    }
    const targetIssue = await resolveRemoteIssue();
    if (!targetIssue?.number) {
      error = $_("m.510647ea33");
      uploadBatchActive = false;
      return;
    }
    let uploadedAny = false;
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        error = $_('dynamic.fileTooLarge', { values: { name: file.name } });
        continue;
      }

      uploading += 1;
      error = '';
      let storedFile = null;
      try {
        storedFile = await uploadAttachment(token, repo, targetIssue.number, file);
        const attachment = await createAttachmentComment(
          token,
          repo,
          targetIssue.number,
          storedFile
        );
        attachments = [...attachments, attachment];
        previewUrls = { ...previewUrls, [attachment.path]: URL.createObjectURL(file) };
        uploadedAny = true;
      } catch (reason) {
        if (storedFile) {
          try {
            await deleteAttachment(token, repo, storedFile);
          } catch {
            // 다음에 이 이슈를 열 때 댓글이 없는 파일을 다시 연결한다.
          }
        }
        error = reason?.status === 403
          ? $_("m.8c4abbd3b6")
          : reason?.message || $_("m.d5ca50a853");
      } finally {
        uploading -= 1;
      }
    }
    if (uploadedAny && !issue) {
      changed();
      clearTimeout(remoteTimer);
      await saveRemote(true);
    }
    reconciledIssueNumber = null;
    if (limitReached && !error) {
      error = $_('dynamic.attachmentLimitAdded', { values: { count: MAX_ATTACHMENTS } });
    }
    if (fileInput) fileInput.value = '';
    uploadBatchActive = false;
  }

  function handlePaste(event) {
    const files = Array.from(event.clipboardData?.files || []);
    if (!files.length) return;
    event.preventDefault();
    uploadFiles(files);
  }

  function hasDraggedFiles(event) {
    return Array.from(event.dataTransfer?.types || []).includes('Files');
  }

  function handleDragEnter(event) {
    if (archived || !hasDraggedFiles(event)) return;
    event.preventDefault();
    draggingFiles = true;
  }

  function handleDragOver(event) {
    if (archived || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    draggingFiles = true;
  }

  function handleDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    draggingFiles = false;
  }

  function handleDrop(event) {
    if (archived || !hasDraggedFiles(event)) return;
    event.preventDefault();
    draggingFiles = false;
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length) uploadFiles(files);
  }

  function handleEditorKeydown(event) {
    if (archived || event.key.toLocaleLowerCase() !== 's' || (!event.ctrlKey && !event.metaKey)) return;
    event.preventDefault();
    clearTimeout(remoteTimer);
    saveRemote(true);
  }

  function handleBodyInput(event) {
    changed();
    updateLinkTooltip(event);
  }

  function updateLinkTooltip(event) {
    const textarea = event?.currentTarget || bodyInput;
    if (!textarea || textarea.selectionStart !== textarea.selectionEnd) {
      hideLinkTooltip();
      return;
    }
    const nextLink = linkAtCursor(textarea.value, textarea.selectionStart);
    if (!nextLink) {
      hideLinkTooltip();
      return;
    }
    activeLink = nextLink;
    positionLinkTooltip(textarea);
  }

  function positionLinkTooltip(textarea) {
    requestAnimationFrame(() => {
      if (!activeLink || !textarea?.isConnected) return;
      const style = getComputedStyle(textarea);
      const bounds = textarea.getBoundingClientRect();
      const mirror = document.createElement('div');
      const marker = document.createElement('span');
      Object.assign(mirror.style, {
        position: 'fixed',
        visibility: 'hidden',
        pointerEvents: 'none',
        overflow: 'hidden',
        boxSizing: style.boxSizing,
        left: `${bounds.left}px`,
        top: `${bounds.top}px`,
        width: `${bounds.width}px`,
        height: `${bounds.height}px`,
        padding: style.padding,
        border: style.border,
        font: style.font,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word'
      });
      mirror.textContent = textarea.value.slice(0, textarea.selectionStart);
      marker.textContent = '\u200b';
      mirror.append(marker);
      document.body.append(mirror);
      mirror.scrollTop = textarea.scrollTop;
      mirror.scrollLeft = textarea.scrollLeft;
      const markerBounds = marker.getBoundingClientRect();
      const tooltipWidth = Math.min(420, Math.max(220, window.innerWidth - 16));
      const left = Math.min(
        window.innerWidth - tooltipWidth - 8,
        Math.max(8, markerBounds.left)
      );
      let top = markerBounds.top - 40;
      if (top < 8) top = markerBounds.bottom + 8;
      linkTooltipStyle = `left:${left}px;top:${top}px;max-width:${tooltipWidth}px`;
      mirror.remove();
    });
  }

  function hideLinkTooltip() {
    activeLink = null;
    linkTooltipStyle = '';
  }

  function handleBodyBlur(event) {
    if (event.relatedTarget !== linkTooltip) hideLinkTooltip();
    flushRemoteSave();
  }

  function isImage(attachment) {
    return attachment?.type?.startsWith('image/')
      || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(attachment?.name || '');
  }

  async function loadPreview(attachment) {
    if (!attachment || previewUrls[attachment.path]) return previewUrls[attachment.path];
    try {
      const blob = await downloadAttachment(token, repo, attachment);
      const url = URL.createObjectURL(blob);
      previewUrls = { ...previewUrls, [attachment.path]: url };
      return url;
    } catch (reason) {
      error = reason?.message || $_("m.4a71ec7a03");
      return '';
    }
  }

  async function removeAttachment(attachment) {
    if (archived || deletingPath) return;
    if (!confirm($_('dynamic.deleteAttachmentConfirm', { values: { name: attachment.name } }))) return;
    deletingPath = attachment.path;
    error = '';
    let fileDeleted = false;
    try {
      try {
        await deleteAttachment(token, repo, attachment);
      } catch (reason) {
        if (reason?.status !== 404) throw reason;
      }
      fileDeleted = true;
      if (attachment.commentId) {
        try {
          await deleteAttachmentComment(token, repo, attachment.commentId);
        } catch (reason) {
          if (reason?.status !== 404) {
            error = $_("m.5b9587e48d");
          }
        }
      }
      if (previewUrls[attachment.path]) URL.revokeObjectURL(previewUrls[attachment.path]);
      const nextPreviewUrls = { ...previewUrls };
      delete nextPreviewUrls[attachment.path];
      previewUrls = nextPreviewUrls;
      const removedIndex = attachments.findIndex((item) => item.path === attachment.path);
      attachments = attachments.filter((item) => item.path !== attachment.path);
      if (viewerIndex === removedIndex) closeViewer();
      else if (viewerIndex > removedIndex) viewerIndex -= 1;
    } catch (reason) {
      error = reason?.message || $_("m.f8a2b33cc2");
    } finally {
      deletingPath = '';
      if (fileDeleted) reconciledIssueNumber = null;
    }
  }

  function inferredAttachmentName(file) {
    return file.name.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i, '');
  }

  function inferredAttachmentType(name) {
    const extension = name.split('.').pop()?.toLocaleLowerCase();
    return {
      avif: 'image/avif', gif: 'image/gif', jpeg: 'image/jpeg', jpg: 'image/jpeg',
      png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp'
    }[extension] || 'application/octet-stream';
  }

  async function reconcileIssueAttachments(issueNumber) {
    loadingAttachments = Number(remoteIssue?.comments || 0) > 0;
    try {
      const [files, comments] = await Promise.all([
        listIssueAttachmentFiles(token, repo, issueNumber),
        listIssueAttachmentComments(token, repo, issueNumber)
      ]);
      if (destroyed || remoteIssue?.number !== issueNumber) return;
      if (uploading || deletingPath) {
        reconciledIssueNumber = null;
        return;
      }
      const filesByPath = new Map(files.map((file) => [file.path, file]));
      const connectedPaths = new Set();
      const nextAttachments = [];

      for (const commentAttachment of comments) {
        const file = filesByPath.get(commentAttachment.path);
        if (!file || connectedPaths.has(commentAttachment.path)) {
          await deleteAttachmentComment(token, repo, commentAttachment.commentId);
          continue;
        }
        connectedPaths.add(commentAttachment.path);
        nextAttachments.push({ ...commentAttachment, ...file });
      }

      for (const file of files) {
        if (connectedPaths.has(file.path)) continue;
        const name = inferredAttachmentName(file);
        const recovered = await createAttachmentComment(token, repo, issueNumber, {
          ...file,
          name,
          type: inferredAttachmentType(name)
        });
        connectedPaths.add(file.path);
        nextAttachments.push(recovered);
      }

      if (destroyed || remoteIssue?.number !== issueNumber) return;
      attachments = nextAttachments;
      attachments.filter(isImage).forEach(loadPreview);
    } catch (reason) {
      if (!destroyed) error = reason?.message || $_("m.ab5becbd3a");
    } finally {
      if (!destroyed && remoteIssue?.number === issueNumber) finishAttachmentLoad();
    }
  }

  function openViewer(index) {
    viewerIndex = index;
    loadPreview(attachments[index]);
    requestAnimationFrame(() => viewerElement?.focus());
  }

  function closeViewer() {
    viewerIndex = -1;
  }

  function moveViewer(direction) {
    if (!attachments.length) return;
    viewerIndex = (viewerIndex + direction + attachments.length) % attachments.length;
    loadPreview(attachments[viewerIndex]);
  }

  function handleViewerKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeViewer();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveViewer(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveViewer(1);
    }
  }

  function formatFileSize(value) {
    if (!value) return '';
    if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))}KB`;
    return `${(value / (1024 * 1024)).toFixed(1)}MB`;
  }

  function hasLabel(name) {
    return labels.some((label) => label.toLocaleLowerCase() === name.toLocaleLowerCase());
  }

  function tagColor(name) {
    return `#${tagColorForName(name)}`;
  }

  function applyLabelMutation(mutation) {
    appliedLabelMutation = mutation.id;
    labels = labels
      .filter((name) => mutation.to || name.toLocaleLowerCase() !== mutation.from.toLocaleLowerCase())
      .map((name) => name.toLocaleLowerCase() === mutation.from.toLocaleLowerCase() ? mutation.to : name);
    if (dirty) persistLocalDraft();
    notifyDraftChange();
  }

  function addTag(name) {
    if (!name || hasLabel(name) || archived) return;
    labels = [...labels, name];
    changed();
  }

  function removeTag(name) {
    if (archived) return;
    labels = labels.filter((label) => label !== name);
    changed();
  }

</script>

<div class="inline-editor">
  <div class="detail-toolbar">
    <div class="detail-toolbar-start">
      <button class="btn btn-outline-secondary mobile-back" on:click={onBack} aria-label={$_("m.747f5bd6a0")}>
        <i class="bi bi-arrow-left" aria-hidden="true"></i> {$_("m.a1fffaaafb")}
      </button>
      <span>{issue ? `#${issue.number}` : $_("m.2b7b05c002")}</span>
      <span class="save-status" aria-live="polite">
        <BrailleSpinner active={saving} />
        {compactStatus}
      </span>
    </div>
    {#if !archived && !attachments.length}
      <input
        bind:this={fileInput}
        class="visually-hidden"
        type="file"
        id={`inline-attachment-${editorId}`}
        multiple
        disabled={uploadBatchActive}
        on:change={(event) => uploadFiles(event.currentTarget.files)}
      />
    {/if}
    <div class="detail-toolbar-actions detail-toolbar-actions-desktop">
      {#if !archived && !labels.length}
        <TagPicker
          toolbar
          {availableLabels}
          selectedLabels={labels}
          onSelect={addTag}
        />
      {/if}
      {#if !archived && !attachments.length}
        <label class="btn btn-sm btn-outline-secondary" for={`inline-attachment-${editorId}`}>
          <i class="bi bi-paperclip" aria-hidden="true"></i>
          {uploading ? $_('dynamic.uploading', { values: { count: uploading } }) : $_("m.1afff0157c")}
        </label>
      {/if}
      {#if issue}
        <button
          class="btn btn-sm btn-outline-secondary"
          on:click={() => onMove(issue)}
        >
          <i class={`bi ${archived ? 'bi-arrow-counterclockwise' : 'bi-trash3'}`} aria-hidden="true"></i>
          {archived ? $_("m.3cbe6d6b9a") : $_("m.f6fdbe48dc")}
        </button>
        <a class="btn btn-sm btn-outline-secondary" href={issue.html_url} target="_blank" rel="noreferrer">
          <i class="bi bi-github" aria-hidden="true"></i> GitHub
        </a>
      {/if}
    </div>
    <div class="dropdown detail-toolbar-more">
      <button
        class="btn btn-outline-secondary"
        type="button"
        data-bs-toggle="dropdown"
        data-bs-auto-close="outside"
        aria-expanded="false"
        aria-label={$_("m.a9b795bbb6")}
      ><i class="bi bi-three-dots-vertical" aria-hidden="true"></i></button>
      <div class="dropdown-menu dropdown-menu-dark dropdown-menu-end">
        {#if !archived && !labels.length}
          <div class="detail-toolbar-more-tag">
            <TagPicker
              toolbar
              {availableLabels}
              selectedLabels={labels}
              onSelect={addTag}
            />
          </div>
        {/if}
        {#if !archived && !attachments.length}
          <label class="dropdown-item" for={`inline-attachment-${editorId}`}>
            <i class="bi bi-paperclip" aria-hidden="true"></i>
            {uploading ? $_('dynamic.uploading', { values: { count: uploading } }) : $_("m.1afff0157c")}
          </label>
        {/if}
        {#if issue}
          <button
            type="button"
            class="dropdown-item"
            on:click={() => onMove(issue)}
          >
            <i class={`bi ${archived ? 'bi-arrow-counterclockwise' : 'bi-trash3'}`} aria-hidden="true"></i>
            {archived ? $_("m.3cbe6d6b9a") : $_("m.f6fdbe48dc")}
          </button>
          <div class="dropdown-divider"></div>
          <a class="dropdown-item" href={issue.html_url} target="_blank" rel="noreferrer">
            <i class="bi bi-github" aria-hidden="true"></i> GitHub
          </a>
        {/if}
      </div>
    </div>
  </div>

  {#if error}<div class="editor-notice text-danger">{error}</div>{/if}

  <div
    class="inline-editor-fields"
    style={`--note-font:${fontStack};--note-font-size:${fontSize}px;--note-line-height:${lineHeight}`}
  >
    {#if loadingAttachments || attachments.length || uploading || deletingPath}
      <section
        class="attachment-section"
        class:is-loading={Boolean(loadingAttachments || uploading || deletingPath)}
      >
        <div class="attachment-list">
          {#each attachments as attachment, index (attachment.path)}
            <div class="attachment-item">
              <button type="button" class="attachment-open" on:click={() => openViewer(index)}>
                {#if isImage(attachment)}
                  {#if previewUrls[attachment.path]}
                    <img src={previewUrls[attachment.path]} alt="" />
                  {:else}
                    <span class="attachment-loading">…</span>
                  {/if}
                {:else}
                  <span class="attachment-file-icon">FILE</span>
                {/if}
                <span class="attachment-name" title={attachment.name}>{attachment.name}</span>
              </button>
              {#if !archived}
                <button
                  type="button"
                  class="attachment-delete"
                  disabled={Boolean(deletingPath)}
                  on:click={() => removeAttachment(attachment)}
                  aria-label={$_('dynamic.deleteAttachment', { values: { name: attachment.name } })}
                >
                  <i
                    class={`bi ${deletingPath === attachment.path ? 'bi-hourglass-split' : 'bi-x-lg'}`}
                    aria-hidden="true"
                  ></i>
                </button>
              {/if}
            </div>
          {/each}
          {#if !archived && attachments.length < MAX_ATTACHMENTS}
            <input
              bind:this={fileInput}
              class="visually-hidden"
              type="file"
              id={`inline-attachment-${editorId}`}
              multiple
              disabled={uploadBatchActive}
              on:change={(event) => uploadFiles(event.currentTarget.files)}
            />
            <label
              class="attachment-add-tile"
              class:disabled={uploadBatchActive}
              for={`inline-attachment-${editorId}`}
            >
              <strong><i class="bi bi-plus-lg" aria-hidden="true"></i></strong>
              <span>{uploading ? $_('dynamic.uploading', { values: { count: uploading } }) : $_("m.61cc55aa04")}</span>
            </label>
          {/if}
        </div>
        {#if loadingAttachments || uploading || deletingPath}
          <div class="attachment-api-overlay" aria-label={$_("m.f4ea49bc96")}>
            <span class="spinner-border spinner-border-sm region-spinner" aria-hidden="true"></span>
          </div>
        {/if}
      </section>
    {/if}
    {#if labels.length}
      <div class="editor-tags">
        {#each labels as label (label)}
          <span class="editor-tag" style={`--tag-color:${tagColor(label)}`}>
            #{label}
            {#if !archived}
              <button type="button" on:click={() => removeTag(label)} aria-label={$_('dynamic.removeTag', { values: { name: label } })}>
                <i class="bi bi-x" aria-hidden="true"></i>
              </button>
            {/if}
          </span>
        {/each}
        {#if !archived}
          <TagPicker
            {availableLabels}
            selectedLabels={labels}
            onSelect={addTag}
          />
        {/if}
      </div>
    {/if}
    {#if titleMode === 'separate'}
      <input
        class="inline-title"
        bind:value={title}
        on:input={changed}
        on:keydown={handleEditorKeydown}
        placeholder={$_("m.768e0c1c69")}
        maxlength="256"
        aria-label={$_("m.45e6c4d69d")}
        readonly={archived}
        on:blur={() => flushRemoteSave()}
      />
    {/if}
    <textarea
      bind:this={bodyInput}
      class="inline-body"
      class:is-dragging-files={draggingFiles}
      bind:value={body}
      on:input={handleBodyInput}
      on:keydown={handleEditorKeydown}
      on:keyup={updateLinkTooltip}
      on:click={updateLinkTooltip}
      on:select={updateLinkTooltip}
      on:scroll={hideLinkTooltip}
      on:blur={handleBodyBlur}
      on:paste={handlePaste}
      on:dragenter={handleDragEnter}
      on:dragover={handleDragOver}
      on:dragleave={handleDragLeave}
      on:drop={handleDrop}
      placeholder={titleMode === 'first-line' ? $_("m.fd0b5408d9") : $_("m.5f35b29acf")}
      aria-label={$_("m.6aa90334da")}
      readonly={archived}
    ></textarea>
    {#if activeLink}
      <a
        bind:this={linkTooltip}
        class="editor-link-tooltip"
        style={linkTooltipStyle}
        href={activeLink.url}
        target="_blank"
        rel="noopener noreferrer"
        title={activeLink.url}
        aria-label={$_('dynamic.openLink', { values: { url: activeLink.url } })}
      >
        <i class="bi bi-box-arrow-up-right" aria-hidden="true"></i>
        <span>{shortenMiddle(activeLink.url)}</span>
      </a>
    {/if}
  </div>

  {#if viewedAttachment}
    <div
      class="attachment-viewer"
      bind:this={viewerElement}
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label={$_("m.89d6d752c4")}
      on:click|self={closeViewer}
      on:keydown={handleViewerKeydown}
      on:keyup|stopPropagation
    >
      <div class="attachment-viewer-toolbar">
        <span>{viewerIndex + 1} / {attachments.length}</span>
        <span class="viewer-file-name">{viewedAttachment.name}</span>
        {#if previewUrls[viewedAttachment.path]}
          <a href={previewUrls[viewedAttachment.path]} download={viewedAttachment.name}>
            <i class="bi bi-download" aria-hidden="true"></i> {$_("m.a479c9c34e")}
          </a>
        {/if}
        {#if !archived}
          <button type="button" on:click={() => removeAttachment(viewedAttachment)}>
            <i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.f6fdbe48dc")}
          </button>
        {/if}
        <button type="button" on:click={closeViewer} aria-label={$_("m.acf7548d73")}>
          <i class="bi bi-x-lg" aria-hidden="true"></i> {$_("m.bbfa773e5a")}
        </button>
      </div>
      <div class="attachment-viewer-stage">
        {#if isImage(viewedAttachment)}
          {#if previewUrls[viewedAttachment.path]}
            <img src={previewUrls[viewedAttachment.path]} alt={viewedAttachment.name} />
          {:else}
            <span class="spinner-border" aria-label={$_("m.6adbafad55")}></span>
          {/if}
        {:else}
          <div class="attachment-file-view">
            <strong>{viewedAttachment.name}</strong>
            <span>{formatFileSize(viewedAttachment.size)}</span>
            {#if previewUrls[viewedAttachment.path]}
              <a class="btn btn-light" href={previewUrls[viewedAttachment.path]} download={viewedAttachment.name}>
                <i class="bi bi-download" aria-hidden="true"></i> {$_("m.774025da27")}
              </a>
            {:else}
              <span>{$_("m.4ee4f59c7c")}</span>
            {/if}
          </div>
        {/if}
      </div>
      {#if attachments.length > 1}
        <button type="button" class="viewer-nav viewer-prev" on:click={() => moveViewer(-1)} aria-label={$_("m.ad0c7c8ea7")}>
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <button type="button" class="viewer-nav viewer-next" on:click={() => moveViewer(1)} aria-label={$_("m.57bc468d7d")}>
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      {/if}
    </div>
  {/if}
</div>
