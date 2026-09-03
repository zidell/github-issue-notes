# Issue Note

GitHub Issues를 데이터 저장소로 사용하는 서버 없는 Svelte 노트 앱입니다.

## 시작하기

```bash
npm install
npm run dev
```

GitHub에서 fine-grained personal access token을 만들고 다음 권한만 부여하세요.

- Repository access: 노트 저장소 하나
- Issues: Read and write
- Metadata: Read
- Contents: Read and write (파일·클립보드 이미지 첨부를 사용할 때만)

PAT와 저장소 설정은 사용자의 브라우저에만 저장되며, API 요청은 브라우저에서
`api.github.com`으로 직접 전송됩니다.

첨부 파일은 같은 저장소의 `.issue-note-assets/` 폴더에 저장되고 노트 본문에는
Markdown 링크가 삽입됩니다. 파일 하나의 앱 내 업로드 제한은 10MB입니다.

## 빌드

```bash
npm run build
```

`dist/` 폴더를 GitHub Pages나 다른 정적 호스팅에 배포할 수 있습니다.
