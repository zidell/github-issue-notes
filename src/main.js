import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import 'bootstrap/js/dist/dropdown';
import './app.css';
import { openUrl } from '@tauri-apps/plugin-opener';
import { mount } from 'svelte';
import App from './App.svelte';
import { dtrans } from './lib/i18n.js';

document.documentElement.lang = dtrans('ko', 'en');
document.querySelector('meta[name="description"]')?.setAttribute(
  'content',
  dtrans(
    'GitHub Issues를 저장소로 사용하는 서버 없는 개인 노트 앱',
    'A serverless personal notes app backed by GitHub Issues'
  )
);

document.addEventListener('click', (event) => {
  if (!window.__TAURI_INTERNALS__) return;
  const anchor = event.target.closest('a[href]');
  if (!anchor) return;
  const url = new URL(anchor.href, window.location.href);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  event.preventDefault();
  openUrl(url.href).catch(() => {});
});

mount(App, {
  target: document.getElementById('app')
});

if ('serviceWorker' in navigator && import.meta.env.PROD && !window.__TAURI_INTERNALS__) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI));
  });
}
