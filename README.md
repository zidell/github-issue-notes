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

첨부 파일은 같은 저장소의 `.issue-note-assets/issues/{이슈 번호}/` 폴더에 저장됩니다. 이슈 본문에는
화면에 노출하지 않는 첨부 메타데이터만 기록하고, 앱에서는 편집기 상단 목록과
이미지 뷰어로 표시합니다. 파일 하나의 앱 내 업로드 제한은 10MB입니다.

편집 내용은 1초 간격으로 브라우저의 로컬 초안에 저장되고, 마지막 입력 후
5초가 지나면 GitHub Issue에 자동 저장됩니다. 기본 설정에서는 본문의 첫 줄을
trim한 뒤 앞 50자를 이슈 제목으로 사용합니다. 연결 설정에서 별도 제목 입력,
글꼴, 글자 크기와 줄간격을 변경할 수 있습니다.

GitHub 라벨은 별도 접두어 없이 노트의 태그로 사용합니다. 편집기에서 태그를
추가하거나 제거할 수 있습니다. 태그 추가 메뉴에서는 기존 라벨을 검색해 바로
적용하거나 새 태그를 만들 수 있습니다. 목록의 태그를 누르면 해당 라벨이 붙은
노트만 볼 수 있습니다.

열려 있는 목록은 한 시간마다 백그라운드에서 다시 확인하여 새 이슈를 반영합니다.

## 빌드

```bash
npm run build
```

`dist/` 폴더를 GitHub Pages나 다른 정적 호스팅에 배포할 수 있습니다.
