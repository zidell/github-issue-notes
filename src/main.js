import 'bootstrap/dist/css/bootstrap.min.css';
import 'bootstrap-icons/font/bootstrap-icons.css';
import 'bootstrap/js/dist/dropdown';
import './app.css';
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

mount(App, {
  target: document.getElementById('app')
});

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(new URL('./sw.js', document.baseURI));
  });
}
