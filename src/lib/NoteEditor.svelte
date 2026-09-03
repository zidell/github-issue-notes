<script>
  import { onDestroy, onMount } from 'svelte';
  import TagPicker from './TagPicker.svelte';
  import {
    createAttachmentComment,
    createIssue,
    createLabel,
    deleteAttachment,
    deleteAttachmentComment,
    downloadAttachment,
    listIssueAttachmentComments,
    listIssueAttachmentFiles,
    updateIssue,
    uploadAttachment
  } from './github.js';

  export let token;
  export let repo;
  export let editorId = 'note';
  export let issue = null;
  export let allocatedIssue = null;
  export let allocationPromise = null;
  export let archived = false;
  export let titleMode = 'first-line';
  export let font = 'system';
  export let fontSize = 16;
  export let lineHeight = 1.7;
  export let paused = false;
  export let availableLabels = [];
  export let labelMutation = null;
  export let onSaved = () => {};
  export let onCreated = () => {};
  export let onDraftChange = () => {};
  export let onLabelsAvailable = () => {};
  export let onMove = () => {};
  export let onBack = () => {};

  const DRAFTS_KEY = 'issue-note.drafts.v1';
  const MAX_ATTACHMENTS = 30;
  const draftId = issue ? `issue.${issue.number}` : 'new';

  let title = issue?.title || '';
  let body = issue?.body || '';
  let attachments = [];
  let remoteIssue = issue || allocatedIssue;
  let labels = (issue?.labels || []).map((label) => label.name);
  let dirty = false;
  let saving = false;
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
  let draggingFiles = false;
  let reconciledIssueNumber = null;
  let destroyed = false;
  let status = archived ? '읽기 전용' : issue ? '저장됨' : '새 노트';
  let error = '';
  let localTimer;
  let remoteTimer;
  let fileInput;

  $: fontStack = {
    system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Pretendard, sans-serif',
    sans: 'Pretendard, "Noto Sans KR", sans-serif',
    serif: '"Noto Serif KR", "Batang", serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  }[font] || 'sans-serif';
  $: viewedAttachment = viewerIndex >= 0 ? attachments[viewerIndex] : null;
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

  onMount(() => {
    const recovered = archived ? null : readDraft();
    if (recovered) {
      title = recovered.title;
      body = recovered.body;
      labels = Array.isArray(recovered.labels) ? recovered.labels : labels;
      dirty = true;
      status = '로컬 초안 복구됨';
      notifyDraftChange();
      scheduleRemoteSave();
    }

    localTimer = setInterval(() => {
      if (dirty) persistLocalDraft();
    }, 1000);
    window.addEventListener('beforeunload', persistBeforeUnload);
  });

  onDestroy(() => {
    destroyed = true;
    if (dirty) persistLocalDraft();
    clearInterval(localTimer);
    clearTimeout(remoteTimer);
    window.removeEventListener('beforeunload', persistBeforeUnload);
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
    if (!saving && status !== '로컬 초안 복구됨') status = '로컬에 저장됨';
  }

  function removeLocalDraft() {
    const store = draftStore();
    if (!store[repo]) return;
    delete store[repo][draftId];
    if (!Object.keys(store[repo]).length) delete store[repo];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(store));
  }

  function persistBeforeUnload() {
    if (dirty) persistLocalDraft();
  }

  function changed() {
    if (archived) return;
    if (titleMode === 'first-line') title = automaticTitle(body);
    dirty = true;
    revision += 1;
    error = '';
    status = '입력 중…';
    notifyDraftChange();
    scheduleRemoteSave();
  }

  function notifyDraftChange() {
    const resolvedTitle = titleMode === 'first-line' ? automaticTitle(body) : title.trim();
    onDraftChange({
      title: resolvedTitle || '새 노트',
      body,
      labels: labels.map((name) => ({ name })),
      updated_at: new Date().toISOString()
    });
  }

  function scheduleRemoteSave(delay = 5000) {
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(() => saveRemote(), delay);
  }

  function currentNote() {
    const resolvedTitle = titleMode === 'first-line'
      ? automaticTitle(body) || (attachments.length ? '첨부 노트' : '')
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

  async function saveRemote(force = false) {
    if (archived) return;
    if (saving) {
      if (force) {
        forceSaveQueued = true;
        status = '현재 저장 후 다시 저장합니다…';
      }
      return;
    }
    if (!force && !dirty) return;
    if (paused) {
      status = '설정 열림 · 저장 대기 중…';
      if (!force) scheduleRemoteSave();
      return;
    }
    persistLocalDraft();
    const note = currentNote();
    if (!note.title) {
      status = titleMode === 'first-line'
        ? '첫 줄을 입력하면 자동 저장됩니다'
        : '제목을 입력하면 자동 저장됩니다';
      return;
    }
    const signature = noteSignature(note);
    if (!force && signature === lastRemoteSignature) {
      dirty = false;
      removeLocalDraft();
      status = 'GitHub에 저장됨';
      return;
    }

    const savingRevision = revision;
    title = note.title;
    saving = true;
    status = 'GitHub에 저장 중…';
    error = '';

    try {
      const knownNames = new Set(availableLabels.map((label) => label.name.toLocaleLowerCase()));
      const missingNames = labels.filter((name) => !knownNames.has(name.toLocaleLowerCase()));
      const createdLabels = await Promise.all(
        missingNames.map((name) => createLabel(token, repo, name))
      );
      if (createdLabels.length) {
        availableLabels = [...availableLabels, ...createdLabels];
        onLabelsAvailable(createdLabels);
      }

      const targetIssue = issue || await resolveRemoteIssue();
      const saved = targetIssue
        ? await updateIssue(token, repo, targetIssue.number, note)
        : await createIssue(token, repo, note);

      remoteIssue = saved;
      lastRemoteSignature = signature;
      if (issue) onSaved(saved);
      if (savingRevision === revision && noteSignature(currentNote()) === signature) {
        dirty = false;
        removeLocalDraft();
        status = 'GitHub에 저장됨';
      } else {
        status = '변경사항 저장 대기 중…';
        scheduleRemoteSave();
      }

      if (!issue) onCreated(saved);
    } catch (reason) {
      error = reason?.status === 401
        ? 'PAT가 올바르지 않거나 폐기되었습니다.'
        : reason?.status === 403
          ? '저장 권한이 없습니다.'
          : reason?.message || 'GitHub 저장에 실패했습니다.';
      status = '저장 실패 · 로컬 초안 보관됨';
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

  function automaticTitle(value) {
    const firstLine = (value.split(/\r?\n/, 1)[0] || '').trim();
    return Array.from(firstLine).slice(0, 50).join('');
  }

  async function uploadFiles(fileList) {
    if (uploadBatchActive) {
      error = '진행 중인 첨부가 끝난 뒤 다시 시도해주세요.';
      return;
    }
    uploadBatchActive = true;
    const requestedFiles = Array.from(fileList || []);
    const remainingSlots = Math.max(0, MAX_ATTACHMENTS - attachments.length);
    const files = requestedFiles.slice(0, remainingSlots);
    const limitReached = requestedFiles.length > remainingSlots;
    if (!files.length) {
      if (limitReached) error = `첨부파일은 노트당 최대 ${MAX_ATTACHMENTS}개까지 추가할 수 있습니다.`;
      if (fileInput) fileInput.value = '';
      uploadBatchActive = false;
      return;
    }
    const targetIssue = await resolveRemoteIssue();
    if (!targetIssue?.number) {
      error = '새 노트 번호를 만들지 못해 첨부할 수 없습니다. 본문을 저장한 뒤 다시 시도해주세요.';
      uploadBatchActive = false;
      return;
    }
    let uploadedAny = false;
    for (const file of files) {
      if (file.size > 10 * 1024 * 1024) {
        error = `“${file.name}”은 10MB를 초과하여 올리지 않았습니다.`;
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
          ? '첨부하려면 PAT에 Issues와 Contents의 Read and write 권한이 필요합니다.'
          : reason?.message || '파일 업로드에 실패했습니다.';
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
      error = `첨부파일은 노트당 최대 ${MAX_ATTACHMENTS}개까지만 추가했습니다.`;
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
      error = reason?.message || '첨부 파일을 불러오지 못했습니다.';
      return '';
    }
  }

  async function removeAttachment(attachment) {
    if (archived || saving || deletingPath) return;
    if (!confirm(`“${attachment.name}” 파일을 저장소에서도 삭제할까요?`)) return;
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
            error = '파일은 삭제했지만 첨부 댓글을 지우지 못했습니다. 다음에 노트를 열 때 다시 정리합니다.';
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
      error = reason?.message || '첨부 파일을 삭제하지 못했습니다.';
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
      if (!destroyed) error = reason?.message || '첨부 파일 상태를 확인하지 못했습니다.';
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
    return `#${availableLabels.find(
      (label) => label.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )?.color || '4f46e5'}`;
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
    if (!name || hasLabel(name) || archived || saving) return;
    labels = [...labels, name];
    changed();
  }

  function removeTag(name) {
    if (archived || saving) return;
    labels = labels.filter((label) => label !== name);
    changed();
  }

</script>

<div class="inline-editor">
  <div class="detail-toolbar">
    <button class="mobile-back" on:click={onBack} aria-label="목록으로 돌아가기">
      <i class="bi bi-arrow-left" aria-hidden="true"></i> 목록
    </button>
    <span>{issue ? `#${issue.number}` : '새 노트'}</span>
    <span class="save-status" class:is-saving={saving}>{status}</span>
    <div class="ms-auto d-flex gap-2">
      {#if !archived && !labels.length}
        <TagPicker
          toolbar
          {availableLabels}
          selectedLabels={labels}
          disabled={saving}
          onSelect={addTag}
        />
      {/if}
      {#if !archived && !attachments.length}
        <input
          bind:this={fileInput}
          class="visually-hidden"
          type="file"
          id={`inline-attachment-${editorId}`}
          multiple
          disabled={saving || uploadBatchActive}
          on:change={(event) => uploadFiles(event.currentTarget.files)}
        />
        <label class="btn btn-sm btn-outline-secondary" for={`inline-attachment-${editorId}`}>
          <i class="bi bi-paperclip" aria-hidden="true"></i>
          {uploading ? `업로드 중 (${uploading})` : '첨부'}
        </label>
      {/if}
      {#if issue}
        <button class="btn btn-sm btn-outline-secondary" on:click={() => onMove(issue)}>
          <i class={`bi ${archived ? 'bi-arrow-counterclockwise' : 'bi-trash3'}`} aria-hidden="true"></i>
          {archived ? '복원' : '삭제'}
        </button>
        <a class="btn btn-sm btn-outline-secondary" href={issue.html_url} target="_blank" rel="noreferrer">
          <i class="bi bi-github" aria-hidden="true"></i> GitHub
        </a>
      {/if}
    </div>
  </div>

  {#if error}<div class="editor-notice text-danger">{error}</div>{/if}

  <div
    class="inline-editor-fields"
    style={`--note-font:${fontStack};--note-font-size:${fontSize}px;--note-line-height:${lineHeight}`}
  >
    {#if attachments.length}
      <section class="attachment-section">
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
                  disabled={Boolean(deletingPath) || saving}
                  on:click={() => removeAttachment(attachment)}
                  aria-label={`${attachment.name} 첨부 삭제`}
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
              disabled={saving || uploadBatchActive}
              on:change={(event) => uploadFiles(event.currentTarget.files)}
            />
            <label
              class="attachment-add-tile"
              class:disabled={saving || uploadBatchActive}
              for={`inline-attachment-${editorId}`}
            >
              <strong><i class="bi bi-plus-lg" aria-hidden="true"></i></strong>
              <span>{uploading ? `업로드 중 (${uploading})` : '추가'}</span>
            </label>
          {/if}
        </div>
      </section>
    {/if}
    {#if labels.length}
      <div class="editor-tags">
        {#each labels as label (label)}
          <span class="editor-tag" style={`--tag-color:${tagColor(label)}`}>
            #{label}
            {#if !archived}
              <button type="button" on:click={() => removeTag(label)} aria-label={`${label} 태그 제거`}>
                <i class="bi bi-x" aria-hidden="true"></i>
              </button>
            {/if}
          </span>
        {/each}
        {#if !archived}
          <TagPicker
            {availableLabels}
            selectedLabels={labels}
            disabled={saving}
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
        placeholder="제목"
        maxlength="256"
        aria-label="노트 제목"
        readonly={archived || saving}
      />
    {/if}
    <textarea
      class="inline-body"
      class:is-dragging-files={draggingFiles}
      bind:value={body}
      on:input={changed}
      on:keydown={handleEditorKeydown}
      on:paste={handlePaste}
      on:dragenter={handleDragEnter}
      on:dragover={handleDragOver}
      on:dragleave={handleDragLeave}
      on:drop={handleDrop}
      placeholder={titleMode === 'first-line' ? '첫 줄이 노트 제목이 됩니다…' : '내용을 입력하세요…'}
      aria-label="노트 본문"
      readonly={archived || saving}
    ></textarea>
  </div>

  {#if viewedAttachment}
    <div
      class="attachment-viewer"
      bind:this={viewerElement}
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-label="첨부 파일 보기"
      on:click|self={closeViewer}
      on:keydown={handleViewerKeydown}
      on:keyup|stopPropagation
    >
      <div class="attachment-viewer-toolbar">
        <span>{viewerIndex + 1} / {attachments.length}</span>
        <span class="viewer-file-name">{viewedAttachment.name}</span>
        {#if previewUrls[viewedAttachment.path]}
          <a href={previewUrls[viewedAttachment.path]} download={viewedAttachment.name}>
            <i class="bi bi-download" aria-hidden="true"></i> 다운로드
          </a>
        {/if}
        {#if !archived}
          <button type="button" on:click={() => removeAttachment(viewedAttachment)}>
            <i class="bi bi-trash3" aria-hidden="true"></i> 삭제
          </button>
        {/if}
        <button type="button" on:click={closeViewer} aria-label="첨부 보기 닫기">
          <i class="bi bi-x-lg" aria-hidden="true"></i> 닫기
        </button>
      </div>
      <div class="attachment-viewer-stage">
        {#if isImage(viewedAttachment)}
          {#if previewUrls[viewedAttachment.path]}
            <img src={previewUrls[viewedAttachment.path]} alt={viewedAttachment.name} />
          {:else}
            <span class="spinner-border" aria-label="첨부 파일 불러오는 중"></span>
          {/if}
        {:else}
          <div class="attachment-file-view">
            <strong>{viewedAttachment.name}</strong>
            <span>{formatFileSize(viewedAttachment.size)}</span>
            {#if previewUrls[viewedAttachment.path]}
              <a class="btn btn-light" href={previewUrls[viewedAttachment.path]} download={viewedAttachment.name}>
                <i class="bi bi-download" aria-hidden="true"></i> 파일 다운로드
              </a>
            {:else}
              <span>파일을 불러오는 중…</span>
            {/if}
          </div>
        {/if}
      </div>
      {#if attachments.length > 1}
        <button type="button" class="viewer-nav viewer-prev" on:click={() => moveViewer(-1)} aria-label="이전 첨부">
          <i class="bi bi-chevron-left" aria-hidden="true"></i>
        </button>
        <button type="button" class="viewer-nav viewer-next" on:click={() => moveViewer(1)} aria-label="다음 첨부">
          <i class="bi bi-chevron-right" aria-hidden="true"></i>
        </button>
      {/if}
    </div>
  {/if}
</div>
