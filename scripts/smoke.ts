import { _electron as electron, expect } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

function luminance(color: string) {
  return color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(c => {
    const value = c / 255
    return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
  }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i], 0)
}

async function main() {
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'aidoo-ui-'))
const env = { ...process.env, AIDOO_DATA_DIR: dataDir }
delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.AIDOO_EXECUTABLE
const app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], env, timeout: 30000 })
const errors: string[] = []
try {
  const page = await app.firstWindow()
  // Let Electron's nativeTheme drive CSS instead of Playwright's default light emulation.
  await page.emulateMedia({ colorScheme: null, reducedMotion: 'reduce' })
  page.on('pageerror', error => errors.push(error.message))
  await expect(page.locator('.session-card').first()).toBeVisible({ timeout: 30000 })
  console.log('Real session cards:', await page.locator('.session-card').count())
  await expect(page.locator('.detail-pane h2')).not.toBeEmpty()
  const initial = await page.evaluate(() => window.aidoo.scan())
  expect(new Set(initial.sessions.map(s => s.id)).size).toBe(initial.sessions.length)
  const badges = await page.locator('.project-item b').allTextContents()
  expect(badges.reduce((n, text) => n + Number(text), 0)).toBe(await page.locator('.session-card').count())
  await page.getByRole('button', { name: '설정 ⌘ ,' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('button', { name: '시스템 설정 따르기' })).toHaveAttribute('aria-pressed', 'true')
  for (const [label, theme] of [['다크', 'dark'], ['라이트', 'light']] as const) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
    const colors = await page.locator('body').evaluate(() => ({
      panel: getComputedStyle(document.querySelector('.detail-pane')!).backgroundColor,
      text: getComputedStyle(document.querySelector('.card-summary')!).color,
      time: getComputedStyle(document.querySelector('.card-time strong')!).color,
      timeSize: getComputedStyle(document.querySelector('.card-time strong')!).fontSize
    }))
    expect(colors.panel).toBe(theme === 'dark' ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)')
    expect(colors.timeSize).toBe('12px')
    await page.getByRole('button', { name: '설정 닫기' }).click()
    const contrasts = await page.evaluate(() => {
      return ['.card-summary', '.card-time strong', '.excerpt p', '.list-footer'].map(selector => {
        const element = document.querySelector(selector)!
        let parent: Element | null = element
        let background = 'rgb(255, 255, 255)'
        while (parent) {
          const value = getComputedStyle(parent).backgroundColor
          if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = value; break }
          parent = parent.parentElement
        }
        return { selector, color: getComputedStyle(element).color, background }
      })
    })
    for (const item of contrasts) {
      const a = luminance(item.color), b = luminance(item.background)
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${theme} ${item.selector} contrast`).toBeGreaterThanOrEqual(4.5)
    }
    await page.screenshot({ path: `/tmp/aidoo-${theme}.png`, animations: 'disabled' })
    await page.getByRole('button', { name: '설정 ⌘ ,' }).click()
  }
  await page.getByRole('button', { name: '시스템 설정 따르기' }).click()
  await expect(page.getByRole('button', { name: '시스템 설정 따르기' })).toHaveAttribute('aria-pressed', 'true')
  const source = await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)
  expect(source).toBe('system')
  await page.getByRole('button', { name: '설정 닫기' }).click()
  const savedSettings = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(dataDir, 'settings.json'), 'utf8'))
  expect(savedSettings.theme).toBe('system')
  await expect(page.locator('.card-time').first()).toHaveAttribute('datetime', /T/)
  await page.screenshot({ path: '/tmp/aidoo-workspace.png' })
  // No agent session mutation; aliases and todo state use an isolated app data dir.
  await page.locator('.detail-top button[title="이름 변경"]').click()
  await page.locator('#session-title').fill('에이두 UI 검증')
  await page.locator('.modal input[type="checkbox"]').uncheck()
  await page.locator('.modal button[type="submit"], .modal button.button.primary').click()
  await expect(page.locator('.detail-pane h2')).toHaveText('에이두 UI 검증')
  await page.locator('.detail-actions button').nth(0).click()
  await page.locator('.nav-item').nth(2).click()
  await expect(page.locator('.session-card')).toHaveCount(1)
  await page.locator('textarea:visible').fill('다음에 테스트 결과 확인')
  await page.locator('.detail-pane h2').click()
  await expect(page.locator('.card-note')).toContainText('다음에 테스트 결과 확인')
  await page.locator('button[title="새로고침 ⌘R"]').click()
  await expect(page.locator('.detail-pane h2')).toHaveText('에이두 UI 검증')
  await expect(page.locator('.card-note')).toContainText('다음에 테스트 결과 확인')
  await page.locator('.detail-actions button').nth(1).click()
  await expect(page.locator('.session-card')).toHaveCount(0)
  await page.locator('.nav-item').nth(4).click()
  await expect(page.locator('.session-card')).toHaveCount(1)
  await page.locator('.detail-actions button').nth(1).click()
  await page.locator('.nav-item').nth(0).click()
  await page.locator('input[aria-label="작업 검색"]').fill('에이두 UI 검증')
  await expect(page.locator('.session-card')).toHaveCount(1)
  await page.locator('input[aria-label="작업 검색"]').fill('no-matching-task-9f53')
  await expect(page.locator('.empty-state h3')).toHaveText('검색 결과가 없어요')
  await page.locator('input[aria-label="작업 검색"]').fill('')
  if (await page.locator('.ai-button').isEnabled()) {
    await page.locator('.ai-button').click()
    await expect(page.locator('.modal h2')).toHaveText('이 대화를 AI로 정리할까요?')
    await page.locator('.modal').getByRole('button', { name: '취소' }).click()
  }
  await page.getByRole('button', { name: '메모장', exact: true }).click()
  await page.getByRole('button', { name: '새 메모', exact: true }).click()
  await page.getByRole('textbox', { name: '메모 제목', exact: true }).fill('배포 아이디어')
  await page.getByRole('textbox', { name: '메모 내용', exact: true }).fill('세션과 별도로 기억할 내용\n한글 입력 확인')
  await expect.poll(async () => (await page.evaluate(() => window.aidoo.listNotes()))[0]?.body).toContain('한글 입력 확인')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 700))
  await expect(page.getByRole('button', { name: '메모장', exact: true })).toBeInViewport({ ratio: 1 })
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(theme => window.aidoo.updateSettings({ theme }), theme)
    await expect.poll(() => page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches)).toBe(theme === 'dark')
    const search = await page.locator('.notes-list .search-box').boundingBox()
    expect(search!.height).toBe(40)
    const body = await page.locator('.note-body').boundingBox()
    expect(body!.height).toBeGreaterThan(200)
    await expect(page.locator('.note-card')).toBeInViewport({ ratio: 1 })
    const colors = await page.evaluate(() => ['.notebook-entry strong', '.note-card p', '.note-card time', '.note-title', '.note-body'].map(selector => {
      const element = document.querySelector(selector)!
      let parent: Element | null = element
      let background = 'rgb(255, 255, 255)'
      while (parent) {
        const value = getComputedStyle(parent).backgroundColor
        if (value !== 'rgba(0, 0, 0, 0)' && value !== 'transparent') { background = value; break }
        parent = parent.parentElement
      }
      return { selector, color: getComputedStyle(element).color, background }
    }))
    for (const item of colors) {
      const a = luminance(item.color), b = luminance(item.background)
      expect((Math.max(a, b) + .05) / (Math.min(a, b) + .05), `${theme} ${item.selector} contrast`).toBeGreaterThanOrEqual(4.5)
      for (const color of [item.color, item.background]) {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number)
        expect(rgb[0]).toBe(rgb[1]); expect(rgb[1]).toBe(rgb[2])
      }
    }
    await page.screenshot({ path: `/tmp/aidoo-notes-${theme}.png`, animations: 'disabled' })
  }
  await page.evaluate(() => window.aidoo.updateSettings({ theme: 'system' }))
  await page.reload()
  await page.getByRole('button', { name: '메모장', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '메모 제목', exact: true })).toHaveValue('배포 아이디어')
  await page.getByRole('textbox', { name: '메모 검색', exact: true }).fill('존재하지않는검색')
  await expect(page.locator('.note-card')).toHaveCount(0)
  await page.getByRole('textbox', { name: '메모 검색', exact: true }).fill('')
  await page.getByTitle('메모 삭제', { exact: true }).click()
  await page.locator('.modal').getByRole('button', { name: '삭제', exact: true }).click()
  await expect(page.locator('.note-card')).toHaveCount(0)
  expect(errors).toEqual([])
  console.log('UI passed: project counts, light/dark/system themes, saved settings, text contrast >= 4.5, timestamps, rename, pin, memo, done/undo, search; no AI requests sent.')
} finally {
  await app.close()
  await rm(dataDir, { recursive: true, force: true })
}
}
main().catch(error => { console.error(error); process.exitCode = 1 })
