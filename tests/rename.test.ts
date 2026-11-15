import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { validateTitle, syncRename, renameClaude, codexRequest } from '../src/main/rename'
import { findCLI } from '../src/main/collector'
import type { Session } from '../src/shared/types'

test('invalid titles cannot become terminal commands', () => {
  assert.throws(() => validateTitle('name\n/clear'))
  assert.throws(() => validateTitle(' '))
  assert.equal(validateTitle('  한글 작업명  '), '한글 작업명')
})
test('partial rename failure reports source and preserves local and Orca results', async () => {
  const calls: string[] = []
  const result = await syncRename(async () => { calls.push('local') }, async () => { throw Error('offline') }, async () => { calls.push('orca') })
  assert.deepEqual(calls, ['local', 'orca'])
  assert.equal(result.sourceUpdated, false)
  assert.equal(result.orcaUpdated, true)
  assert.match(result.warnings[0], /offline/)
})
test('Claude official SDK renames an isolated session without altering its conversation', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidoo-rename-'))
  try {
    const id = randomUUID(), project = path.join(dir, 'projects', '-tmp-test')
    await mkdir(project, { recursive: true })
    const file = path.join(project, `${id}.jsonl`)
    const original = JSON.stringify({ type: 'user', sessionId: id, uuid: randomUUID(), cwd: '/tmp/test', message: { role: 'user', content: 'hello' } }) + '\n'
    await writeFile(file, original)
    await renameClaude({ sessionId: id, sourcePath: file } as Session, '테스트 작업명', path.resolve('dist/main/rename-worker.js'))
    const content = await readFile(file, 'utf8')
    assert.ok(content.startsWith(original))
    assert.match(content, /테스트 작업명/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('Codex app-server changes an isolated persisted session name without starting a turn', async t => {
  const cli = await findCLI('codex')
  if (!cli) { t.skip('Codex CLI not installed'); return }
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidoo-codex-rename-'))
  try {
    const id = randomUUID(), timestamp = new Date().toISOString()
    const logs = path.join(dir, 'sessions', '2026', '11', '15')
    await mkdir(logs, { recursive: true })
    const file = path.join(logs, `rollout-2026-11-15T00-00-00-${id}.jsonl`)
    const original = JSON.stringify({ type: 'session_meta', timestamp, payload: { id, timestamp, cwd: '/tmp', originator: 'codex_cli_rs', cli_version: '0.1.0', source: 'cli', model_provider: 'openai' } }) + '\n'
    await writeFile(file, original)
    await codexRequest(cli, dir, 'thread/name/set', { threadId: id, name: '새 작업 이름' })
    const read = await codexRequest(cli, dir, 'thread/read', { threadId: id })
    assert.equal(read.thread.name, '새 작업 이름')
    assert.equal(await readFile(file, 'utf8'), original)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
