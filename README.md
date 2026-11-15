# Aidoo · 에이두

**AI 작업과 할 일을 한눈에.** Claude Code와 Codex의 로컬 대화를 프로젝트별로 모으고, 원래 작업으로 돌아가는 macOS 데스크톱 앱입니다.

Electron + React + TypeScript. Python 런타임이나 별도 서버 없이 동작합니다. macOS Apple Silicon에서 개발·검증하고 있습니다.

## 주요 기능

빌드한 앱은 `release/mac-arm64/Aidoo.app`에 생성됩니다. 앱을 열면 로컬 대화를 자동으로 수집합니다. 창을 닫아도 메뉴바에 남으며, 완전히 종료하려면 메뉴에서 **에이두 종료**를 선택하세요.

- 디렉토리별로 주제와 최근 대화를 확인하고, 검색 또는 Claude/Codex 필터로 좁힙니다.
- **이어 할 일로 고정**, **완료 처리**, 개인 메모를 저장할 수 있습니다.
- **이름 추천** 또는 이름 수정에서 Claude Code·Codex 원본 세션과 연결된 Orca 탭까지 함께 바꿉니다. 동기화 옵션은 기본으로 켜져 있고, 해제하면 에이두 표시 이름만 바뀝니다. 일부 변경이 실패하면 반영된 에이두 이름은 유지하고 실패한 대상을 알려줍니다.
- **메모장**에서 세션과 별도로 메모를 작성하고 검색할 수 있습니다. 제목과 내용은 입력할 때 자동 저장되며, 삭제 전 확인합니다.
- **Orca에서 대화 열기**는 확인된 터미널 핸들로 이동합니다. 연결되지 않은 세션은 Terminal에서 세션 ID로 재개합니다. 기존 Terminal/iTerm/IDE 탭을 찾는 기능은 아직 없습니다.
- **AI로 요약 · 이름 추천**은 기존 Claude Code 로그인을 사용합니다. 전송 전 화면에서 확인하며, 최근 대화 최대 12개를 보내 요약·다음 행동·추천 이름을 생성합니다. 기존 사용 한도를 사용하고, 기본 발췌 화면은 API 요청을 하지 않습니다.
- `⌘K` 검색, `⌘R` 새로고침. 15초마다 자동 갱신합니다.
- 왼쪽 아래 **설정** 또는 `⌘,`에서 **시스템 설정 따르기 / 라이트 / 다크**를 선택합니다. 기본값은 시스템 설정이며 macOS 테마 변경을 즉시 반영합니다.
- 설정의 **프로젝트 상위 폴더**는 기본 `~/workspace`입니다. 그 바로 아래 폴더를 프로젝트로 집계하며, 하위 디렉토리와 Orca·Git 워크트리는 원래 프로젝트로 묶습니다. 사이드바 개수는 현재 필터와 검색 결과를 반영합니다. 원래 작업 경로는 세션 재개에 그대로 사용합니다.
- 활동 시간은 상대 시간과 날짜·시각을 함께 표시합니다. 상세 화면에서는 연도를 포함한 정확한 시간을 볼 수 있습니다.

## 설치 및 개발

이 저장소를 클론한 뒤 직접 빌드해 실행할 수 있습니다. Claude Code 또는 Codex의 로컬 기록이 있어야 대화가 표시됩니다. Orca 연동은 선택 사항입니다.

Node.js 22.12 이상이 필요합니다. 이 저장소의 `.tool-versions`는 22.22.1을 지정합니다.

```sh
git clone https://github.com/YoonShinWoong/aidoo.git
cd aidoo
npm ci --include=optional
npm run dev
```

```sh
npm run build
npm test
npm run package
open release/mac-arm64/Aidoo.app
```

`npm run smoke`는 실제 로컬 세션을 읽어 UI를 검증합니다. 별도 임시 데이터 폴더를 사용하고 원본 세션이나 Orca 탭 이름을 바꾸지 않으며, AI 요청도 보내지 않습니다. `AIDOO_EXECUTABLE=/path/to/Aidoo.app/Contents/MacOS/Aidoo npm run smoke`로 패키징한 앱도 검증할 수 있습니다.

Electron 설치 시 바이너리가 내려받아지지 않았다면 `npx install-electron --no`를 실행하세요. 현재 빌드는 Apple 개발자 서명·공증이 적용되지 않았습니다.

## 수집 방식과 범위

`src/main/collector.ts`가 Claude의 `~/.claude/projects/*/*.jsonl`과 Codex의 `state_*.sqlite` 인덱스 및 rollout 기록을 읽습니다. `CLAUDE_CONFIG_DIR`과 `CODEX_HOME`, Orca 관리 Codex 계정 홈도 탐색합니다. subagent 기록은 독립 작업에서 제외합니다. SQLite는 macOS 내장 `/usr/bin/sqlite3`를 **읽기 전용**으로 호출합니다.

Orca는 별도의 대화 엔진으로 표시하지 않습니다. 로컬 프로필에 저장된 세션 ID를 `orca terminal list`의 PTY와 매칭해 Claude/Codex 세션에 연결합니다. 현재 설치된 Orca의 비공개 저장 형식을 일부 참조하므로 앱 업데이트에 따라 어댑터 수정이 필요할 수 있습니다. 원격 호스트의 세션 수집과 네이티브 채팅 탭 연결은 아직 지원하지 않습니다.

최근 세션 최대 500개를 표시하며, 세션당 768 KiB까지 첫 부분과 마지막 부분을 읽습니다. 변경되지 않은 기록은 메모리 캐시를 사용합니다. 대화가 길면 중간 부분은 생략됩니다. **최근 답변 있음**은 발췌에 답변이 존재한다는 뜻이며, 실제 프로세스 실행·완료·승인 대기를 단정하지 않습니다.

## 데이터와 권한

핀·완료·메모·별칭·선택한 AI 요약은 Electron의 `app.getPath('userData')/session-state.json`에 저장합니다. macOS 기본 위치는 `~/Library/Application Support/Aidoo/`입니다. 대화 원문은 별도로 디스크에 복제하지 않습니다. AI 요약을 사용하면 요약 내용은 이 파일에 남습니다.

테마와 프로젝트 상위 폴더는 같은 위치의 `settings.json`에 저장하며, 기존 세션 메모나 이름과 별도로 유지합니다.

수집은 원본 DB와 대화 로그를 수정하지 않습니다. 사용자가 이름 변경을 적용하면 Claude는 공식 Agent SDK의 `renameSession`, Codex는 App Server의 `thread/name/set`, Orca는 CLI의 `terminal rename`을 사용합니다. Claude 작업은 해당 세션의 설정 디렉토리를 지정한 별도 프로세스에서 실행하고, Codex는 해당 계정 홈을 사용합니다. 이름 변경을 위해 모델을 호출하거나 대화를 재개하지 않습니다. 이미 열린 Claude/Codex 화면은 목록을 새로 열거나 재개해야 저장된 이름이 표시될 수 있습니다. Orca의 연결된 터미널 탭은 직접 변경합니다. 에이두에서 이름을 수정한 뒤에는 추천 이름을 자동 덮어쓰지 않습니다.

독립 메모는 앱 데이터 폴더의 `notes.json`에 저장하며 외부로 보내지 않습니다. 테스트는 임시 Claude/Codex 세션을 만들어 실제 이름 변경 기능을 검증합니다. `npm run build` 후 `npm test`를 실행하세요.

Terminal 재개는 macOS 자동화 권한을 요청할 수 있습니다. 재개 명령 복사는 권한 없이 가능합니다. 경로와 세션 ID는 셸에서 인용하며, 렌더러에는 파일 시스템이나 임의 명령 실행 API를 노출하지 않습니다. 외부 페이지를 로드하지 않고 `contextIsolation`과 샌드박스를 사용합니다. 텔레메트리와 자동 업데이트는 없습니다.

## 구성

```text
src/main/collector.ts   로컬 수집, 파싱, Orca 매칭
src/main/index.ts       앱·메뉴바, 제한된 IPC, 저장, 재개, AI 요약
src/preload/index.ts    화면에 노출하는 명시적 API
src/renderer/          React 화면
tests/                 파서·셸 인용·읽기 전용 검증
```

Aidoo 소스는 MIT License입니다. 의존 라이브러리에는 각 패키지의 라이선스가 적용됩니다. 로컬 기록, 개인 경로, 인증 파일은 저장소에 포함하지 마세요.
