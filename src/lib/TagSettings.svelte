<script>
  export let labels = [];
  export let busy = '';
  export let onCreate = () => {};
  export let onRenameDrafts = () => {};
  export let onDelete = () => {};

  let drafts = {};
  let newName = '';

  function draftValue(name) {
    return drafts[name] ?? name;
  }

  function updateDraft(name, value) {
    drafts = { ...drafts, [name]: value };
    onRenameDrafts(labels
      .map((label) => ({ label, nextName: (name === label.name ? value : draftValue(label.name)).trim() }))
      .filter(({ label, nextName }) => nextName !== label.name));
  }

  function deleteLabel(label) {
    const { [label.name]: removed, ...remainingDrafts } = drafts;
    drafts = remainingDrafts;
    onRenameDrafts(labels
      .filter((item) => item.id !== label.id)
      .map((item) => ({ label: item, nextName: draftValue(item.name).trim() }))
      .filter(({ label: item, nextName }) => nextName !== item.name));
    onDelete(label);
  }

  function create() {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    newName = '';
  }
</script>

<fieldset class="editor-settings tag-settings mb-4">
  <legend>태그 관리</legend>
  <div class="tag-settings-create">
    <input
      class="form-control form-control-sm"
      bind:value={newName}
      maxlength="50"
      placeholder="새 태그 이름"
      disabled={Boolean(busy)}
      aria-label="새 태그 이름"
      on:keydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          create();
        }
      }}
    />
    <button type="button" class="btn btn-sm btn-outline-secondary" disabled={Boolean(busy) || !newName.trim()} on:click={create}>
      <i class="bi bi-plus-lg" aria-hidden="true"></i> 추가
    </button>
  </div>
  {#if labels.length}
    <div class="tag-settings-list">
      {#each labels as label (label.id || label.name)}
        <div class="tag-settings-row">
          <span class="label-dot" style={`--label-color:#${label.color || '4f46e5'}`}></span>
          <input
            class="form-control form-control-sm"
            value={draftValue(label.name)}
            maxlength="50"
            disabled={Boolean(busy)}
            aria-label={`${label.name} 태그 이름`}
            on:input={(event) => updateDraft(label.name, event.currentTarget.value)}
            on:keydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
              }
            }}
          />
          <button
            type="button"
            class="btn btn-sm btn-outline-danger"
            disabled={Boolean(busy)}
            on:click={() => deleteLabel(label)}
          ><i class="bi bi-trash3" aria-hidden="true"></i> 삭제</button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="small text-secondary mb-0">저장소에 등록된 태그가 없습니다.</p>
  {/if}
</fieldset>
