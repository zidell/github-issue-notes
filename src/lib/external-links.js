export function isStandaloneWebApp() {
  if (typeof window === 'undefined') return false;

  return window.navigator.standalone === true
    || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

// Safari's Dock web apps have no tab strip. Letting an external link navigate
// normally hands it to the browser instead of requesting an unavailable tab.
export function externalLinkTarget() {
  return isStandaloneWebApp() ? undefined : '_blank';
}
