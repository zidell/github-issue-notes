<script>
  import { onDestroy, onMount } from 'svelte';

  export let availableLabels = [];
  export let selectedLabels = [];
  export let disabled = false;
  export let toolbar = false;
  export let onSelect = () => {};

  let open = false;
  let search = '';
  let picker;
  let searchInput;

  $: filteredLabels = availableLabels
    .filter((label) => !hasSelected(label.name))
    .filter((label) => label.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    .slice(0, 12);
  $: newTagName = normalizeTag(search);
  $: canCreate = Boolean(newTagName)
    && !hasSelected(newTagName)
    && !availableLabels.some((label) => label.name.toLocaleLowerCase() === newTagName.toLocaleLowerCase());

  onMount(() => document.addEventListener('pointerdown', handleOutside));
  onDestroy(() => document.removeEventListener('pointerdown', handleOutside));

  function hasSelected(name) {
    return selectedLabels.some((label) => label.toLocaleLowerCase() === name.toLocaleLowerCase());
  }

  function normalizeTag(value) {
    return Array.from(value.trim().replace(/^#+/, '').replace(/\s+/g, '-')).slice(0, 50).join('');
  }

  function toggle() {
    if (disabled) return;
    open = !open;
    search = '';
    if (open) requestAnimationFrame(() => searchInput?.focus());
  }

  function select(name) {
    onSelect(name);
    search = '';
    requestAnimationFrame(() => searchInput?.focus());
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      open = false;
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const exact = filteredLabels.find(
      (label) => label.name.toLocaleLowerCase() === search.trim().toLocaleLowerCase()
    );
    if (exact) select(exact.name);
    else if (canCreate) select(newTagName);
    else if (filteredLabels[0]) select(filteredLabels[0].name);
  }

  function handleOutside(event) {
    if (open && !picker?.contains(event.target)) {
      open = false;
      search = '';
    }
  }
</script>

<div class="tag-picker" class:toolbar bind:this={picker}>
  <button
    type="button"
    class:btn={toolbar}
    class:btn-sm={toolbar}
    class:btn-outline-secondary={toolbar}
    class:tag-picker-toggle={!toolbar}
    {disabled}
    aria-haspopup="listbox"
    aria-expanded={open}
    on:click={toggle}
  ><i class={`bi ${toolbar ? 'bi-tags' : 'bi-plus-lg'}`} aria-hidden="true"></i> {toolbar ? '태그' : '추가'}</button>
  {#if open}
    <div class="tag-dropdown">
      <input
        bind:this={searchInput}
        bind:value={search}
        on:keydown={handleKeydown}
        on:keyup={(event) => event.key === 'Escape' && event.stopPropagation()}
        placeholder="태그 검색 또는 생성"
        maxlength="51"
        aria-label="태그 검색 또는 생성"
      />
      <div class="tag-dropdown-list" aria-label="저장소 라벨">
        {#each filteredLabels as label (label.id || label.name)}
          <button type="button" on:click={() => select(label.name)}>
            <span class="label-dot" style={`--label-color:#${label.color || '4f46e5'}`}></span>
            #{label.name}
          </button>
        {/each}
        {#if canCreate}
          <button type="button" class="create-tag" on:click={() => select(newTagName)}>
            <span class="label-dot" style="--label-color:#4f46e5"></span>
            #{newTagName} 새로 만들기
          </button>
        {:else if !filteredLabels.length}
          <span class="tag-dropdown-empty">추가할 태그가 없습니다.</span>
        {/if}
      </div>
    </div>
  {/if}
</div>
