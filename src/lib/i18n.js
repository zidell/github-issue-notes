import { get } from 'svelte/store';
import { _, addMessages, init, locale } from 'svelte-i18n';
import en from './locales/en.json';
import ko from './locales/ko.json';
import zh from './locales/zh-CN.json';

export const LOCALE_OPTIONS = [
  { value: 'auto', label: 'Automatic / 자동' },
  { value: 'en', label: 'English' },
  { value: 'ko', label: '한국어' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'ja', label: '日本語' },
  { value: 'de', label: 'Deutsch' },
  { value: 'fr', label: 'Français' },
  { value: 'it', label: 'Italiano' }
];

const common = {
  ja: { Add: '追加', Attach: '添付', 'Back to list': '一覧に戻る', Clear: 'クリア', Close: '閉じる', Copy: 'コピー', Delete: '削除', Download: 'ダウンロード', 'Editor settings': 'エディター設定', Font: 'フォント', List: '一覧', 'Load more': 'さらに読み込む', 'Loading notes…': 'ノートを読み込み中…', 'Manage tags': 'タグ管理', 'New note': '新しいノート', 'New tag name': '新しいタグ名', Notes: 'ノート', 'Notes per page': '1ページのノート数', Refresh: '更新', Restore: '復元', Saved: '保存済み', Saving: '保存中', Search: '検索', Settings: '設定', Tags: 'タグ', Trash: 'ゴミ箱', 'Auto-save delay': '自動保存までの時間', 'Line height': '行間', Size: 'サイズ', 'Save settings': '設定を保存', 'Title mode': 'タイトル方式', 'Write your note…': 'ノートを入力…', 'Select a note from the list.': '左の一覧からノートを選択してください。', 'No notes yet.': 'ノートはまだありません。', 'No results found.': '検索結果がありません。', 'Search or #tag': '検索または #タグ', 'Connect and start': '接続して開始', 'Connect a GitHub repository': 'GitHubリポジトリに接続', 'Remember PAT in this browser': 'このブラウザにPATを保存', 'Notes repository': 'ノート用リポジトリ' },
  de: { Add: 'Hinzufügen', Attach: 'Anhängen', 'Back to list': 'Zurück zur Liste', Clear: 'Leeren', Close: 'Schließen', Copy: 'Kopieren', Delete: 'Löschen', Download: 'Herunterladen', 'Editor settings': 'Editor-Einstellungen', Font: 'Schriftart', List: 'Liste', 'Load more': 'Mehr laden', 'Loading notes…': 'Notizen werden geladen…', 'Manage tags': 'Tags verwalten', 'New note': 'Neue Notiz', 'New tag name': 'Neuer Tag-Name', Notes: 'Notizen', 'Notes per page': 'Notizen pro Seite', Refresh: 'Aktualisieren', Restore: 'Wiederherstellen', Saved: 'Gespeichert', Saving: 'Wird gespeichert', Search: 'Suchen', Settings: 'Einstellungen', Tags: 'Tags', Trash: 'Papierkorb', 'Auto-save delay': 'Verzögerung der automatischen Speicherung', 'Line height': 'Zeilenhöhe', Size: 'Größe', 'Save settings': 'Einstellungen speichern', 'Title mode': 'Titelmodus', 'Write your note…': 'Notiz schreiben…', 'Select a note from the list.': 'Wählen Sie links eine Notiz aus.', 'No notes yet.': 'Noch keine Notizen.', 'No results found.': 'Keine Ergebnisse gefunden.', 'Search or #tag': 'Suchen oder #Tag', 'Connect and start': 'Verbinden und starten', 'Connect a GitHub repository': 'GitHub-Repository verbinden', 'Remember PAT in this browser': 'PAT in diesem Browser speichern', 'Notes repository': 'Notiz-Repository' },
  fr: { Add: 'Ajouter', Attach: 'Joindre', 'Back to list': 'Retour à la liste', Clear: 'Effacer', Close: 'Fermer', Copy: 'Copier', Delete: 'Supprimer', Download: 'Télécharger', 'Editor settings': 'Paramètres de l’éditeur', Font: 'Police', List: 'Liste', 'Load more': 'Charger plus', 'Loading notes…': 'Chargement des notes…', 'Manage tags': 'Gérer les tags', 'New note': 'Nouvelle note', 'New tag name': 'Nouveau tag', Notes: 'Notes', 'Notes per page': 'Notes par page', Refresh: 'Actualiser', Restore: 'Restaurer', Saved: 'Enregistré', Saving: 'Enregistrement', Search: 'Rechercher', Settings: 'Paramètres', Tags: 'Tags', Trash: 'Corbeille', 'Auto-save delay': 'Délai d’enregistrement automatique', 'Line height': 'Interligne', Size: 'Taille', 'Save settings': 'Enregistrer les paramètres', 'Title mode': 'Mode de titre', 'Write your note…': 'Écrivez votre note…', 'Select a note from the list.': 'Sélectionnez une note dans la liste.', 'No notes yet.': 'Aucune note pour le moment.', 'No results found.': 'Aucun résultat.', 'Search or #tag': 'Rechercher ou #tag', 'Connect and start': 'Connecter et commencer', 'Connect a GitHub repository': 'Connecter un dépôt GitHub', 'Remember PAT in this browser': 'Mémoriser le PAT dans ce navigateur', 'Notes repository': 'Dépôt des notes' },
  it: { Add: 'Aggiungi', Attach: 'Allega', 'Back to list': 'Torna alla lista', Clear: 'Cancella', Close: 'Chiudi', Copy: 'Copia', Delete: 'Elimina', Download: 'Scarica', 'Editor settings': 'Impostazioni dell’editor', Font: 'Carattere', List: 'Elenco', 'Load more': 'Carica altro', 'Loading notes…': 'Caricamento note…', 'Manage tags': 'Gestisci tag', 'New note': 'Nuova nota', 'New tag name': 'Nuovo tag', Notes: 'Note', 'Notes per page': 'Note per pagina', Refresh: 'Aggiorna', Restore: 'Ripristina', Saved: 'Salvato', Saving: 'Salvataggio', Search: 'Cerca', Settings: 'Impostazioni', Tags: 'Tag', Trash: 'Cestino', 'Auto-save delay': 'Ritardo salvataggio automatico', 'Line height': 'Interlinea', Size: 'Dimensione', 'Save settings': 'Salva impostazioni', 'Title mode': 'Modalità titolo', 'Write your note…': 'Scrivi la nota…', 'Select a note from the list.': 'Seleziona una nota dalla lista.', 'No notes yet.': 'Nessuna nota.', 'No results found.': 'Nessun risultato.', 'Search or #tag': 'Cerca o #tag', 'Connect and start': 'Connetti e inizia', 'Connect a GitHub repository': 'Connetti un repository GitHub', 'Remember PAT in this browser': 'Ricorda il PAT in questo browser', 'Notes repository': 'Repository delle note' }
};

const dynamic = {
  en: { noteCount: '{count} notes', openNote: 'Open note {title}', clearFilter: 'Clear {label} filter', tagName: '{name} tag name', createTag: 'Create #{name}', tagAdded: 'Added #{name}.', tagDeleted: 'Deleted #{name}.', tagRenamed: 'Renamed #{from} to #{to}.', tagNameRequired: 'The name of #{name} cannot be empty.', selectOwner: 'Select the {owner} account.', selectRepository: 'Select only {repo}.', createPat: 'Create a PAT for {name}', allocateFailed: 'Could not allocate a number for the new note. {error}', moveToTrashConfirm: 'Move “{title}” to trash?', restoreConfirm: 'Restore “{title}”?', attachmentLimit: 'Each note can have up to {count} attachments.', attachmentLimitAdded: 'Only {count} attachments were added because that is the per-note limit.', fileTooLarge: '“{name}” was not uploaded because it exceeds 10 MB.', deleteAttachmentConfirm: 'Delete “{name}” from the repository too?', deleteAttachment: 'Delete attachment {name}', uploading: 'Uploading ({count})', removeTag: 'Remove tag {name}', openLink: 'Open {url} in a new tab', mcpPrompt: 'Use GitHub Issues in {repo} as notes. Open issues are regular notes, closed issues are trash, and labels are tags. Each attachment is stored under .issue-note-assets/issues/{issueNumber}/ and linked to one dedicated issue comment containing an <!-- issue-note-attachment:... --> marker. This comment is an internal record used by the app for the attachment list and GitHub preview; do not interpret, edit, or delete it as a regular comment. The issue body contains only the note text without attachment metadata.' },
  ko: { noteCount: '{count}개', openNote: '{title} 노트 열기', clearFilter: '{label} 필터 해제', tagName: '{name} 태그 이름', createTag: '#{name} 새로 만들기', tagAdded: '#{name} 태그를 추가했습니다.', tagDeleted: '#{name} 태그를 삭제했습니다.', tagRenamed: '#{from} 태그를 #{to}(으)로 변경했습니다.', tagNameRequired: '#{name} 태그 이름을 비워둘 수 없습니다.', selectOwner: '{owner} 계정이 선택되어야 합니다.', selectRepository: '{repo} 저장소 하나만 선택하세요.', createPat: '{name}용 PAT 발급하기', allocateFailed: '새 노트 번호를 만들지 못했습니다. {error}', moveToTrashConfirm: '“{title}” 노트를 휴지통으로 이동할까요?', restoreConfirm: '“{title}” 노트를 복원할까요?', attachmentLimit: '첨부파일은 노트당 최대 {count}개까지 추가할 수 있습니다.', attachmentLimitAdded: '첨부파일은 노트당 최대 {count}개까지만 추가했습니다.', fileTooLarge: '“{name}”은 10MB를 초과하여 올리지 않았습니다.', deleteAttachmentConfirm: '“{name}” 파일을 저장소에서도 삭제할까요?', deleteAttachment: '{name} 첨부 삭제', uploading: '업로드 중 ({count})', removeTag: '{name} 태그 제거', openLink: '{url} 새 탭에서 열기', mcpPrompt: '{repo} 저장소의 GitHub Issues를 노트로 사용해줘. 열린 이슈는 일반 노트, 닫힌 이슈는 휴지통이며 라벨은 태그야. 각 첨부파일은 .issue-note-assets/issues/{issueNumber}/ 폴더에 저장되고, 해당 이슈에는 <!-- issue-note-attachment:... --> 마커가 있는 전용 댓글 하나가 연결돼. 이 댓글은 앱이 첨부파일 목록과 GitHub 미리보기를 관리하는 내부 레코드이므로 일반 댓글로 해석하거나 수정·삭제하지 말아줘. 이슈 본문은 첨부 메타데이터 없이 노트 내용만 들어 있어.' }
};

const dynamicOverrides = {
  'zh-CN': { noteCount: '{count} 条笔记', openNote: '打开笔记 {title}', clearFilter: '清除 {label} 筛选', tagName: '{name} 标签名称', createTag: '创建 #{name}', tagAdded: '已添加 #{name}。', tagDeleted: '已删除 #{name}。', tagRenamed: '已将 #{from} 重命名为 #{to}。', tagNameRequired: '#{name} 的名称不能为空。', selectOwner: '请选择 {owner} 账户。', selectRepository: '仅选择 {repo}。', createPat: '为 {name} 创建 PAT', allocateFailed: '无法为新笔记分配编号。{error}', moveToTrashConfirm: '将“{title}”移至回收站？', restoreConfirm: '恢复“{title}”？', attachmentLimit: '每条笔记最多可有 {count} 个附件。', attachmentLimitAdded: '由于每条笔记的限制，仅添加了 {count} 个附件。', fileTooLarge: '“{name}”超过 10 MB，未上传。', deleteAttachmentConfirm: '也从仓库中删除“{name}”？', deleteAttachment: '删除附件 {name}', uploading: '上传中（{count}）', removeTag: '移除标签 {name}', openLink: '在新标签页中打开 {url}' },
  ja: { noteCount: '{count}件', openNote: 'ノート「{title}」を開く', clearFilter: '{label} フィルターを解除', tagName: '{name} のタグ名', createTag: '#{name} を作成', tagAdded: '#{name} を追加しました。', tagDeleted: '#{name} を削除しました。', tagRenamed: '#{from} を #{to} に変更しました。', tagNameRequired: '#{name} の名前は空にできません。', selectOwner: '{owner} アカウントを選択してください。', selectRepository: '{repo} のみ選択してください。', createPat: '{name} 用PATを作成', allocateFailed: '新しいノート番号を取得できませんでした。{error}', moveToTrashConfirm: '「{title}」をゴミ箱に移動しますか？', restoreConfirm: '「{title}」を復元しますか？', attachmentLimit: '添付ファイルはノートごとに最大{count}件です。', attachmentLimitAdded: '上限により添付ファイルは{count}件まで追加されました。', fileTooLarge: '「{name}」は10MBを超えるためアップロードされませんでした。', deleteAttachmentConfirm: '「{name}」をリポジトリからも削除しますか？', deleteAttachment: '添付ファイル {name} を削除', uploading: 'アップロード中（{count}）', removeTag: 'タグ {name} を削除', openLink: '{url} を新しいタブで開く' },
  de: { noteCount: '{count} Notizen', openNote: 'Notiz {title} öffnen', clearFilter: 'Filter {label} entfernen', tagName: 'Tag-Name {name}', createTag: '#{name} erstellen', tagAdded: '#{name} hinzugefügt.', tagDeleted: '#{name} gelöscht.', tagRenamed: '#{from} in #{to} umbenannt.', tagNameRequired: 'Der Name von #{name} darf nicht leer sein.', selectOwner: 'Wählen Sie das Konto {owner}.', selectRepository: 'Wählen Sie nur {repo}.', createPat: 'PAT für {name} erstellen', allocateFailed: 'Keine Nummer für die neue Notiz verfügbar. {error}', moveToTrashConfirm: '„{title}“ in den Papierkorb verschieben?', restoreConfirm: '„{title}“ wiederherstellen?', attachmentLimit: 'Pro Notiz sind höchstens {count} Anhänge möglich.', attachmentLimitAdded: 'Wegen des Limits wurden nur {count} Anhänge hinzugefügt.', fileTooLarge: '„{name}“ wurde nicht hochgeladen, da die Datei größer als 10 MB ist.', deleteAttachmentConfirm: '„{name}“ auch aus dem Repository löschen?', deleteAttachment: 'Anhang {name} löschen', uploading: 'Wird hochgeladen ({count})', removeTag: 'Tag {name} entfernen', openLink: '{url} in neuem Tab öffnen' },
  fr: { noteCount: '{count} notes', openNote: 'Ouvrir la note {title}', clearFilter: 'Effacer le filtre {label}', tagName: 'Nom du tag {name}', createTag: 'Créer #{name}', tagAdded: '#{name} ajouté.', tagDeleted: '#{name} supprimé.', tagRenamed: '#{from} renommé en #{to}.', tagNameRequired: 'Le nom de #{name} ne peut pas être vide.', selectOwner: 'Sélectionnez le compte {owner}.', selectRepository: 'Sélectionnez uniquement {repo}.', createPat: 'Créer un PAT pour {name}', allocateFailed: 'Impossible d’attribuer un numéro à la nouvelle note. {error}', moveToTrashConfirm: 'Déplacer « {title} » dans la corbeille ?', restoreConfirm: 'Restaurer « {title} » ?', attachmentLimit: 'Chaque note peut contenir au maximum {count} pièces jointes.', attachmentLimitAdded: 'Seules {count} pièces jointes ont été ajoutées en raison de la limite.', fileTooLarge: '« {name} » dépasse 10 Mo et n’a pas été téléversé.', deleteAttachmentConfirm: 'Supprimer aussi « {name} » du dépôt ?', deleteAttachment: 'Supprimer la pièce jointe {name}', uploading: 'Téléversement ({count})', removeTag: 'Retirer le tag {name}', openLink: 'Ouvrir {url} dans un nouvel onglet' },
  it: { noteCount: '{count} note', openNote: 'Apri la nota {title}', clearFilter: 'Rimuovi il filtro {label}', tagName: 'Nome del tag {name}', createTag: 'Crea #{name}', tagAdded: '#{name} aggiunto.', tagDeleted: '#{name} eliminato.', tagRenamed: '#{from} rinominato in #{to}.', tagNameRequired: 'Il nome di #{name} non può essere vuoto.', selectOwner: 'Seleziona l’account {owner}.', selectRepository: 'Seleziona solo {repo}.', createPat: 'Crea un PAT per {name}', allocateFailed: 'Impossibile assegnare un numero alla nuova nota. {error}', moveToTrashConfirm: 'Spostare “{title}” nel cestino?', restoreConfirm: 'Ripristinare “{title}”?', attachmentLimit: 'Ogni nota può contenere al massimo {count} allegati.', attachmentLimitAdded: 'Sono stati aggiunti solo {count} allegati a causa del limite.', fileTooLarge: '“{name}” supera 10 MB e non è stato caricato.', deleteAttachmentConfirm: 'Eliminare “{name}” anche dal repository?', deleteAttachment: 'Elimina allegato {name}', uploading: 'Caricamento ({count})', removeTag: 'Rimuovi tag {name}', openLink: 'Apri {url} in una nuova scheda' }
};

function dynamicFor(code) {
  return { ...dynamic.en, ...(dynamicOverrides[code] || {}) };
}

function catalogWithOverrides(overrides = {}) {
  const messages = structuredClone(en);
  const ids = new Map(Object.entries(en.m).map(([id, text]) => [text, id]));
  for (const [english, translation] of Object.entries(overrides)) {
    const id = ids.get(english);
    if (id) messages.m[id] = translation;
  }
  return messages;
}

const errors = {
  en: { githubRequest: 'GitHub request failed.', repositoryFormat: 'Enter the repository as owner/repository.', issueNumberRequired: 'An issue number is required before attaching files.', attachmentLoad: 'Could not load the attachment.' },
  ko: { githubRequest: 'GitHub 요청에 실패했습니다.', repositoryFormat: '저장소를 owner/repository 형식으로 입력해주세요.', issueNumberRequired: '첨부하기 전에 이슈 번호가 필요합니다.', attachmentLoad: '첨부 파일을 불러오지 못했습니다.' }
};
const meta = {
  en: { description: 'A serverless personal notes app backed by GitHub Issues' },
  ko: { description: 'GitHub Issues를 저장소로 사용하는 서버 없는 개인 노트 앱' }
};
const settings = {
  en: { language: 'Language', patReplacementPlaceholder: 'Enter only to replace the saved PAT' },
  ko: { language: '언어', patReplacementPlaceholder: '저장된 PAT를 변경할 때만 입력하세요' },
  'zh-CN': { language: '语言', patReplacementPlaceholder: '仅在更改已保存的 PAT 时输入' },
  ja: { language: '言語', patReplacementPlaceholder: '保存済みのPATを変更する場合のみ入力' },
  de: { language: 'Sprache', patReplacementPlaceholder: 'Nur zum Ändern des gespeicherten PAT eingeben' },
  fr: { language: 'Langue', patReplacementPlaceholder: 'Saisir uniquement pour remplacer le PAT enregistré' },
  it: { language: 'Lingua', patReplacementPlaceholder: 'Inserisci solo per sostituire il PAT salvato' }
};

addMessages('en', { ...en, dynamic: dynamic.en, errors: errors.en, meta: meta.en, settings: settings.en });
addMessages('ko', { ...ko, dynamic: dynamic.ko, errors: errors.ko, meta: meta.ko, settings: settings.ko });
addMessages('zh-CN', { ...zh, dynamic: dynamicFor('zh-CN'), errors: errors.en, meta: meta.en, settings: settings['zh-CN'] });
for (const code of ['ja', 'de', 'fr', 'it']) {
  addMessages(code, { ...catalogWithOverrides(common[code]), dynamic: dynamicFor(code), errors: errors.en, meta: meta.en, settings: settings[code] });
}

export function normalizeLocale(value) {
  const language = String(value || '').toLowerCase();
  if (language.startsWith('ko')) return 'ko';
  if (language.startsWith('zh')) return 'zh-CN';
  if (language.startsWith('ja')) return 'ja';
  if (language.startsWith('de')) return 'de';
  if (language.startsWith('fr')) return 'fr';
  if (language.startsWith('it')) return 'it';
  return 'en';
}

export function setAppLocale(preference = 'auto') {
  const resolved = preference === 'auto' ? normalizeLocale(globalThis.navigator?.language) : normalizeLocale(preference);
  locale.set(resolved);
  globalThis.document?.documentElement?.setAttribute('lang', resolved);
  globalThis.document?.querySelector('meta[name="description"]')?.setAttribute(
    'content', (meta[resolved] || meta.en).description
  );
  return resolved;
}

export function translate(key, values) {
  return get(_)(key, values ? { values } : undefined);
}

init({ fallbackLocale: 'en', initialLocale: normalizeLocale(globalThis.navigator?.language) });
