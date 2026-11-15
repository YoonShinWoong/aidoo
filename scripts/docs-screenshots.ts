// Render the real UI with fictional data. Never loads the collector or user records.
import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Note, Session, Snapshot } from '../src/shared/types'

async function main() {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'aidoo-docs-'))
  const output = path.resolve('assets/screenshots')
  await mkdir(output, { recursive: true })
  const now = Date.parse('2026-11-15T10:30:00+09:00')
  const entries = [
    ['codex', 'aidoo', '프로젝트별 세션 정리', '하위 폴더와 워크트리를 같은 프로젝트로 모아주세요.', '프로젝트 루트를 기준으로 세션을 묶었습니다. 하위 폴더와 Git 워크트리도 하나의 목록에서 확인할 수 있어요.'],
    ['claude', 'aidoo', '메모장 자동 저장', '작업과 별도로 아이디어를 적어둘 메모장을 만들어주세요.', '제목과 본문을 입력하면 자동으로 저장합니다. 검색과 삭제, 앱을 다시 열었을 때 복원하는 동작까지 확인했어요.'],
    ['claude', 'orbit-web', '검색 결과 화면 다듬기', '검색 결과가 없을 때 안내 문구와 필터를 개선해주세요.', '빈 결과 안내와 필터 초기화 버튼을 추가했습니다. 작은 화면에서의 배치도 함께 정리했어요.'],
    ['codex', 'orbit-web', '키보드 탐색 개선', '키보드로 검색 결과를 선택할 수 있게 해주세요.', '화살표 키로 이동하고 Enter로 열 수 있습니다. 포커스 표시와 접근성 레이블을 추가했습니다.'],
    ['codex', 'studio-api', '페이지네이션 테스트', '마지막 페이지와 빈 목록의 응답을 검증해주세요.', '경계 조건 테스트를 추가했습니다. 다음 작업은 API 문서의 예제를 업데이트하는 것입니다.'],
    ['claude', 'studio-api', 'API 문서 초안', '프로젝트 목록 API의 사용 예시를 정리해주세요.', '요청 파라미터와 응답 예시를 정리했습니다. 에러 코드 설명도 함께 추가했어요.'],
  ]
  const sessions: Session[] = entries.map(([agent, project, title, request, reply], i) => ({
    id: `sample-${i}`, sessionId: `demo000${i}-0000-4000-8000-000000000000`,
    agent: agent as Session['agent'], cwd: `/Users/demo/workspace/${project}`,
    projectPath: `/Users/demo/workspace/${project}`, originalTitle: title,
    suggestedTitle: title, goal: request, latestRequest: request, latestReply: reply,
    messages: [{ role: 'user', text: request, timestamp: new Date(now).toISOString() }, { role: 'assistant', text: reply, timestamp: new Date(now).toISOString() }],
    updatedAt: now / 1000 - (i * 8 + 2) * 60, status: i === 3 ? 'recent' : 'reply',
    sourcePath: '', codexHome: '', orcaHandle: i < 2 ? `demo-${i}` : '', inOrca: i < 2,
  }))
  const snapshot: Snapshot = {
    sessions, warnings: [], scannedAt: now, aiAvailable: true,
    settings: { theme: 'system', workspaceRoots: ['/Users/demo/workspace'] },
    state: {
      'sample-0': { pinned: true, note: '다음: 작은 화면에서 프로젝트 목록 확인', ai: { title: '워크스페이스 기준으로 세션 묶기', summary: '프로젝트 루트를 기준으로 Claude Code와 Codex 세션을 모았습니다. 하위 폴더와 워크트리는 원래 프로젝트에 함께 표시됩니다.', nextAction: '여러 프로젝트를 오가며 목록과 검색 결과가 일치하는지 확인하기.', updatedAt: now / 1000 } },
      'sample-2': { pinned: true }, 'sample-5': { done: true },
    },
  }
  const notes: Note[] = [
    { id: 'demo-note-1', title: '다음에 이어 할 일', body: '오늘 정리한 것\n\n프로젝트별로 세션을 모으고, 다시 돌아올 작업을 고정했다.\n작업마다 다음 행동을 한 줄씩 남겨두니 이어가기 훨씬 편하다.\n\n다음에 확인할 것\n\n□ 작은 화면에서 프로젝트 목록 확인\n□ 검색 화면의 키보드 탐색 테스트\n□ API 문서에 페이지네이션 예시 추가\n\n아이디어\n\n좋은 작업 이름은 해결하려는 문제를 짧게 담는다.\n대화를 다시 읽기 전에, 제목만 보고 맥락을 떠올릴 수 있도록.', updatedAt: now },
    { id: 'demo-note-2', title: '검색 화면 아이디어', body: '최근 사용한 필터를 기억하면 어떨까?\n빈 결과에서도 다음 행동을 안내하기.', updatedAt: now - 3600000 },
    { id: 'demo-note-3', title: '릴리스 체크리스트', body: '설치 안내 확인\n스크린샷 업데이트\n새 버전에서 메모 복원 확인', updatedAt: now - 86400000 },
  ]
  const preload = `const { contextBridge } = require('electron');
const snapshot = ${JSON.stringify(snapshot)};
const notes = ${JSON.stringify(notes)};
contextBridge.exposeInMainWorld('aidoo', {
  scan: async () => snapshot, listNotes: async () => notes,
  onOpenSettings: () => () => {},
});`
  await writeFile(path.join(temp, 'preload.cjs'), preload)
  await writeFile(path.join(temp, 'main.cjs'), `const { app, BrowserWindow } = require('electron');
app.setPath('userData', ${JSON.stringify(path.join(temp, 'data'))});
app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 1440, height: 1000, titleBarStyle: 'hiddenInset', webPreferences: { preload: ${JSON.stringify(path.join(temp, 'preload.cjs'))}, sandbox: true, contextIsolation: true } });
  win.loadFile(${JSON.stringify(path.resolve('dist/renderer/index.html'))});
});`)
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [path.join(temp, 'main.cjs')], env })
  try {
    const page = await app.firstWindow()
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.clock.install({ time: now })
    await page.reload()
    await expect(page.locator('.session-card')).toHaveCount(5)
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      await page.screenshot({ path: path.join(output, `workspace-${colorScheme}.png`), scale: 'css' })
    }
    await page.getByRole('button', { name: '메모장', exact: true }).click()
    await expect(page.locator('.note-card')).toHaveCount(3)
    await page.screenshot({ path: path.join(output, 'notes-dark.png'), scale: 'css' })
    expect(errors).toEqual([])
    console.log('Saved three screenshots from the actual renderer using fictional data.')
  } finally {
    await app.close()
    await rm(temp, { recursive: true, force: true })
  }
}
main().catch(error => { console.error(error); process.exitCode = 1 })
