# dsh-better-workspaces

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [Français](README.fr.md) · [한국어](README.ko.md)

DeepSeek Harness 웹 GUI에서 Git worktree, diff 상세 검토, Pull Request 및 Issue 참조를 바로 다룹니다. 작업마다 독립된 브랜치와 전용 디렉터리를 할당해, 첫 프롬프트 입력부터 커밋·푸시까지 브라우저 탭 하나로 끝냅니다.

**플러그인 목록 이름:** 工作区增强 · Better Workspaces.

---

## 주요 기능

### 1. 입력창에서 작업 모드 바로 선택

프롬프트 입력창 바로 위에서 `Local`과 `New worktree`를 간편하게 전환합니다. 단순 수정은 현재 디렉터리인 `Local`에서 바로 진행하고, 별도 브랜치와 격리된 작업 디렉터리가 필요한 작업은 `New worktree`를 선택해 병렬 작업 간 충돌을 방지합니다.

![입력창 위의 Local과 New worktree 전환](docs/screenshots/01-worktree-mode.png)

### 2. 브랜치와 PR 기반의 빠른 격리 작업 공간 생성

브랜치 이름을 입력하거나 주사위 버튼을 눌러 자동으로 생성합니다. 베이스는 로컬 브랜치, 원격 브랜치, 열린 Pull Request 중에서 자유롭게 선택할 수 있습니다. **Create**를 클릭하면 독립된 worktree 워크스페이스가 생성되고 새 세션이 즉시 준비됩니다.

![브랜치 이름, 베이스 선택, Create 버튼이 있는 worktree 폼](docs/screenshots/02-worktree-form.png)

### 3. 세션 목록에서 한눈에 확인하는 Git 상태

사이드바의 세션 카드 제목 바로 아래에 현재 브랜치와 변경 라인 수(`+11 −3`)가 상시 표시됩니다. 연결된 PR과 CI 검사 상태도 같은 줄에 함께 나타나 터미널에서 `git status`를 반복 입력할 필요가 없습니다.

![브랜치와 diff 크기를 보여 주는 세션 행](docs/screenshots/03-sidebar-badges.png)

### 4. 우측 사이드바에서 펼쳐지는 전체 diff 검토

`±` 배지를 클릭하면 오른쪽에 diff 패널이 열립니다. 커밋되지 않은 변경, 현재 세션 변경, 전체 작업 범위, 베이스 브랜치 비교를 손쉽게 전환할 수 있습니다. 줄 단위 hunk 확인, 파일 인라인 편집, 커밋 히스토리 조회를 모두 지원합니다.

![범위 전환, 파일 목록, hunk, 작업 버튼이 있는 diff 페이지](docs/screenshots/04-diff-view.png)

### 5. 페이지를 벗어나지 않고 커밋부터 PR 생성까지

diff 패널에서 Commit, Pull, Push, PR 생성, 병합, 베이스 업데이트, 변경 사항 되돌리기를 직접 실행할 수 있습니다. 조건을 충족하지 않아 비활성화된 작업은 그 이유를 명확하게 안내합니다.

![Commit 버튼과 Pull, Push, PR, 병합, 업데이트, 버리기가 있는 More 메뉴](docs/screenshots/05-diff-actions.png)

### 6. GitHub PR과 Issue를 클릭 한 번으로 참조

입력창 옆의 GitHub 버튼을 누르면 현재 저장소의 열린 PR과 Issue 목록이 표시됩니다. 원하는 항목을 선택하면 구조화된 참조로 프롬프트에 바로 첨부됩니다.

![열린 pull request와 issue를 나열하는 GitHub 선택기](docs/screenshots/06-github-picker.png)

### 7. 깔끔한 입력창 칩과 모델을 위한 완전한 맥락 전송

입력창에는 작은 참조 칩(chip) 형태로만 표시되어 작성 공간을 가리지 않습니다. 전송 시에는 전체 제목, 본문 내용, 브랜치 정보, 링크로 자동 확장되어 AI 모델에 정확한 맥락을 전달합니다.

![입력창에 들어간 작은 issue 참조 칩과 전송 버튼](docs/screenshots/07-reference-chip.png)

---

## 빠른 워크플로

1. **세션 시작:** DeepSeek Harness에서 Git 워크스페이스를 열고 새 세션을 시작합니다.
2. **범위 선택:** 입력창 위에서 `Local`(현재 디렉터리) 또는 `New worktree`(격리 브랜치)를 선택합니다.
3. **개발 및 검토:** GitHub 버튼으로 Issue를 참조하고, 사이드바 배지로 진행 상황을 확인하며, `±`를 눌러 세부 diff를 검토합니다.
4. **변경 배포:** diff 패널에서 바로 커밋, 푸시, 또는 Pull Request를 생성합니다.

---

## 설치

npm에서 한 줄 명령으로 설치할 수 있습니다.

```bash
dsh plugin --profile web add @ds-hu/dsh-better-workspaces
```

설치 후 `dsh --profile web`을 한 번 재시작하면 활성화됩니다.

DSH 웹 UI에서도 설치할 수 있습니다.

1. 사이드바에서 **Plugins**를 엽니다.
2. **Add plugin**을 클릭합니다.
3. `@ds-hu/dsh-better-workspaces`를 입력하고 설치 소스로 **Official npm registry**를 선택합니다.
4. **Install**을 클릭한 뒤 설치가 끝나면 **Enable now**를 클릭합니다. 재시작하라는 안내가 나오면 `dsh --profile web`을 한 번 재시작합니다.

### 요구 사항
- **DeepSeek Harness:** ≥ 0.2.0
- **Node.js:** ≥ 20.19
- **필수 도구:** `git`, `pnpm` (`PATH`에 등록되어 있어야 함)
- **GitHub CLI(선택 사항):** 인증된 `gh`가 있으면 PR 및 Issue 선택 기능을 사용할 수 있습니다. `gh`가 없어도 worktree, 사이드바 배지, diff 검토 등 핵심 기능은 모두 정상 동작합니다.

---

## 참고 사항

- Linux, macOS 13+, Windows 10+ 환경을 지원합니다.
- 모든 작업은 현재 브라우저 탭 안에서 완결됩니다.

---

## 기술 문서

- [docs/TECHNICAL.md](docs/TECHNICAL.md) — 아키텍처 구조, 보안 경계, 업그레이드 유의사항 및 수동 운영 가이드.
- [docs/adr/](docs/adr/) — 핵심 설계 결정을 담은 아키텍처 결정 기록(ADR).

---

## 라이선스

[MIT](LICENSE). 서드파티 고지 및 라이선스는 [NOTICE](NOTICE)와 [LICENSES/](LICENSES/)에 포함되어 있습니다.
