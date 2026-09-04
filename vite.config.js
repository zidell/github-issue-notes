import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  base: './',
  plugins: [svelte()],
  server: {
    strictPort: true,
    watch: {
      ignored: ['**/src-tauri/**']
    }
  }
});
