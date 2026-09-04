<script>
  import { tick } from 'svelte';
  import { tagColorForName } from './colors.js';
  import { _ } from 'svelte-i18n';

  export let labels = [];
  export let busy = '';
  export let onCreate = () => {};
  export let onRenameDrafts = () => {};
  export let onDelete = () => {};

  let drafts = {};
  let newName = '';
  let newNameInput;

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

  async function create() {
    const name = newName.trim();
    if (!name) return;
    await onCreate(name);
    newName = '';
    await tick();
    newNameInput?.focus();
  }
</script>

<fieldset class="editor-settings tag-settings mb-4">
  <legend>{$_("m.b2f3136b1a")}</legend>
  <div class="tag-settings-create">
    <input
      bind:this={newNameInput}
      class="form-control form-control-sm"
      bind:value={newName}
      maxlength="50"
      placeholder={$_("m.624842da43")}
      disabled={Boolean(busy)}
      aria-label={$_("m.624842da43")}
      on:keydown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          create();
        }
      }}
    />
    <button type="button" class="btn btn-sm btn-outline-secondary" disabled={Boolean(busy) || !newName.trim()} on:click={create}>
      <i class="bi bi-plus-lg" aria-hidden="true"></i> {$_("m.61cc55aa04")}
    </button>
  </div>
  {#if labels.length}
    <div class="tag-settings-list">
      {#each labels as label (label.id || label.name)}
        <div class="tag-settings-row">
          <span class="label-dot" style={`--label-color:#${tagColorForName(label.name)}`}></span>
          <input
            class="form-control form-control-sm"
            value={draftValue(label.name)}
            maxlength="50"
            disabled={Boolean(busy)}
            aria-label={$_('dynamic.tagName', { values: { name: label.name } })}
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
          ><i class="bi bi-trash3" aria-hidden="true"></i> {$_("m.f6fdbe48dc")}</button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="small text-secondary mb-0">{$_("m.2240ffb750")}</p>
  {/if}
</fieldset>
