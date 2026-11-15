import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { createInterface } from 'node:readline'
import { findCLI } from './collector'
import type { Session } from '../shared/types'

export function validateTitle(title: unknown): string {
  if (typeof title !== 'string' || !title.trim() || title.trim().length > 180 || /[\x00-\x1f\x7f]/.test(title))
    throw new Error('이름은 줄바꿈 없이 1~180자로 입력해 주세요.')
  return title.trim()
}

// Dedicated process: CLAUDE_CONFIG_DIR never changes for the running application.
export async function renameClaude(s: Session, title: string, worker: string) {
  const file = await fs.realpath(s.sourcePath)
  if (path.basename(file) !== `${s.sessionId}.jsonl` || path.basename(path.dirname(path.dirname(file))) !== 'projects')
    throw new Error('Claude 세션 경로를 확인할 수 없습니다.')
  await promisify(execFile)(process.execPath, [worker, s.sessionId, validateTitle(title)], {
    timeout: 15000, maxBuffer: 1024 * 1024,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CLAUDE_CONFIG_DIR: path.dirname(path.dirname(path.dirname(file))) }
  })
}

export async function codexRequest(cli: string, codexHome: string, method: string, params: object) {
  return new Promise<any>((resolve, reject) => {
    const child = spawn(cli, ['app-server', '--listen', 'stdio://'], {
      env: { ...process.env, CODEX_HOME: codexHome, PATH: `${path.dirname(cli)}:${process.env.PATH || ''}` },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let finished = false
    const lines = createInterface({ input: child.stdout })
    const timer = setTimeout(() => finish(new Error('Codex 응답 시간이 초과됐습니다. 이름을 확인한 후 다시 시도해 주세요.')), 15000)
    function finish(error?: Error, value?: unknown) {
      if (finished) return
      finished = true; clearTimeout(timer); lines.close(); child.stdin.end(); child.kill()
      if (error) reject(error); else resolve(value)
    }
    function send(value: object) { child.stdin.write(JSON.stringify(value) + '\n') }
    child.stderr.resume()
    child.on('error', () => finish(new Error('Codex를 실행하지 못했습니다.')))
    child.stdin.on('error', () => finish(new Error('Codex 연결이 종료됐습니다.')))
    child.on('exit', () => { if (!finished) finish(new Error('Codex가 이름 변경을 완료하지 못했습니다.')) })
    lines.on('line', line => {
      let message: any
      try { message = JSON.parse(line) } catch { return }
      if (message.id !== 1 && message.id !== 2) return
      if (message.error) { finish(new Error('Codex 요청 실패: ' + String(message.error.message || '지원하지 않는 기능'))); return }
      if (message.id === 1) {
        send({ method: 'initialized', params: {} })
        send({ id: 2, method, params })
      } else finish(undefined, message.result)
    })
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'aidoo', version: '0.1.2' } } })
  })
}
export async function renameCodex(s: Session, title: string) {
  const cli = await findCLI('codex')
  if (!cli || !s.codexHome) throw new Error('Codex CLI 또는 계정 경로를 찾지 못했습니다.')
  await codexRequest(cli, s.codexHome, 'thread/name/set', { threadId: s.sessionId, name: validateTitle(title) })
}

export async function syncRename(local: () => Promise<void>, source: () => Promise<void>, orca?: () => Promise<void>) {
  await local()
  const warnings: string[] = []
  let sourceUpdated = false, orcaUpdated = false
  try { await source(); sourceUpdated = true } catch (error) {
    warnings.push('원본 세션: ' + (error instanceof Error ? error.message : '이름 변경 실패'))
  }
  if (orca) {
    try { await orca(); orcaUpdated = true } catch { warnings.push('Orca: 탭 이름 변경 실패. 새로고침 후 다시 시도해 주세요.') }
  }
  return { sourceUpdated, orcaUpdated, warnings }
}
