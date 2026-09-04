<script>
  import { onDestroy } from 'svelte';

  export let active = false;
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let frame = 0;
  let timer;

  $: if (active) start();
  $: if (!active) stop();

  function start() {
    if (timer) return;
    timer = setInterval(() => {
      frame = (frame + 1) % frames.length;
    }, 80);
  }

  function stop() {
    clearInterval(timer);
    timer = undefined;
    frame = 0;
  }

  onDestroy(stop);
</script>

<span class="braille-spinner" class:active aria-hidden="true">{frames[frame]}</span>
