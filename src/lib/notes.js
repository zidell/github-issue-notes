export function automaticTitle(value, maxLength = 50) {
  const firstLine = (String(value || '').split(/\r?\n/, 1)[0] || '').trim();
  return Array.from(firstLine).slice(0, maxLength).join('');
}
