export function isNewNoteShortcut(event) {
  return Boolean(
    !event.repeat
    && !event.shiftKey
    && (event.ctrlKey || event.metaKey)
    && (event.code === 'KeyN' || event.key?.toLocaleLowerCase() === 'n')
  );
}
