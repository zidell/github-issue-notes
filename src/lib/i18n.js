export function dtrans(korean, english, language = globalThis.navigator?.language || 'en') {
  return /^ko(?:-|$)/i.test(String(language)) ? korean : english;
}
