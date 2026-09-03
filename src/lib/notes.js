export function automaticTitle(value, maxLength = 50) {
  const firstLine = (String(value || '').split(/\r?\n/, 1)[0] || '').trim();
  return Array.from(firstLine).slice(0, maxLength).join('');
}

export function markdownToPlainText(value) {
  return String(value || '')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/~~~[^\n]*\n?/g, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*\[[^\]]+\]:\s+\S+.*$/gm, '')
    .replace(/<[^>]+>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-+*]\s+|\d+[.)]\s+)/gm, '')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/\[([ xX])\]\s*/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*~_]/g, '')
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}
