# dsh-better-workspaces

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [한국어](README.ko.md)

DeepSeek Harness 웹 GUI 대화 안에서 worktree, diff, pull request, issue를 바로 다룹니다. 하나의 대화는 하나의 변경에 집중하고, 첫 메시지부터 커밋까지 같은 화면에서 끝냅니다.

![입력창 위의 Local과 New worktree 전환](docs/screenshots/01-worktree-mode.png)

**1 · 작업 위치를 고릅니다.** 입력창 위에 `Local`과 `New worktree`가 있습니다. 작은 수정은 현재 디렉터리에서 하고, 독립된 브랜치와 디렉터리가 필요하면 `New worktree`를 고릅니다.

![브랜치 이름, 베이스 선택, Create 버튼이 있는 worktree 폼](docs/screenshots/02-worktree-form.png)

**2 · 이름과 베이스를 정하고 생성합니다.** 브랜치 이름을 입력하거나 주사위로 생성합니다. 베이스는 로컬 브랜치, 원격 브랜치, pull request 중에서 고릅니다. Create를 누르면 worktree가 독립 워크스페이스로 열리고 세션도 준비됩니다.

![브랜치와 diff 크기를 보여 주는 세션 행](docs/screenshots/03-sidebar-badges.png)

**3 · 세션 상태를 한눈에 봅니다.** 브랜치와 변경 크기는 세션 제목 아래에 표시됩니다. 브랜치에 PR과 검사가 있으면 같은 줄에 함께 나타납니다.

![범위 전환, 파일 목록, hunk, 작업 버튼이 있는 diff 페이지](docs/screenshots/04-diff-view.png)

**4 · 변경 전체를 한 페이지에서 검토합니다.** `±`를 누르면 오른쪽에 diff 페이지가 열립니다. 커밋되지 않은 변경, 이 세션, 작업, 베이스 비교를 전환할 수 있습니다. 파일을 펼쳐 줄 단위 hunk를 보고, 그 자리에서 편집하거나 커밋 목록을 확인합니다.

![Commit 버튼과 Pull, Push, PR, 병합, 업데이트, 버리기가 있는 More 메뉴](docs/screenshots/05-diff-actions.png)

**5 · 페이지를 떠나지 않고 마무리합니다.** Commit, Pull, Push, PR 생성, 병합, 베이스에서 업데이트, 변경 버리기를 할 수 있습니다. 사용할 수 없는 작업은 무엇이 빠졌는지 알려 줍니다.

![열린 pull request와 issue를 나열하는 GitHub 선택기](docs/screenshots/06-github-picker.png)

**6 · PR이나 issue를 입력창으로 가져옵니다.** 입력창 옆의 GitHub 버튼이 현재 저장소의 열린 PR과 issue를 보여 줍니다. 하나를 고르면 참조로 첨부됩니다.

![입력창에 들어간 작은 issue 참조 칩과 전송 버튼](docs/screenshots/07-reference-chip.png)

**7 · 초안은 짧게 유지합니다.** 입력창에는 작은 칩 하나만 남습니다. 전송할 때 전체 제목, 링크, 베이스/헤드, 본문으로 펼쳐져 모델에 정확한 맥락이 전달됩니다.

## 설치

```bash
dsh plugin --profile web add github:ds-hu/dsh-better-workspaces
```

`dsh --profile web`을 한 번 재시작합니다. dsh ≥ 0.2.0, Node.js ≥ 20.19, `PATH`의 `pnpm`, git이 필요합니다. PR과 issue 기능에는 인증된 `gh`도 사용합니다. 나머지 기능은 `gh` 없이 동작합니다.

## 사용법

1. git 워크스페이스를 열고 세션을 시작합니다.
2. 입력창에서 `Local` 또는 `New worktree`를 고릅니다.
3. `±`로 검토하고, `Commit` / `More`로 마무리하고, GitHub 버튼으로 PR이나 issue를 첨부합니다.

## 참고

- Linux, macOS 13+, Windows 10+에서 동작합니다.
- `gh`는 선택 사항입니다. 없어도 worktree, 배지, diff 페이지는 사용할 수 있습니다.
- 모든 작업은 현재 브라우저 탭 안에서 끝납니다.

## 문서

아키텍처, 설계 기록, 보안, 개발, 운영은 [docs/TECHNICAL.md](docs/TECHNICAL.md)에 있습니다. 설계 결정은 [docs/adr/](docs/adr/)를 참고하세요.

## 라이선스

MIT. 서드파티 고지는 [NOTICE](NOTICE)와 [LICENSES/](LICENSES/)에 포함되어 있습니다.
