import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { parseRecords, parseLog, shellQuote, clean, sql, run, containingWorktree, sessionStatus } from '../src/main/collector'

test('Claude adapter excludes tool output, sidechains, and incomplete lines', () => {
  const rows = [
    { type: 'user', cwd: '/tmp/project', message: { content: '로그인 오류 수정' } },
    { type: 'assistant', message: { content: [{ type: 'thinking', thinking: 'private' }, { type: 'text', text: '토큰 갱신 수정 완료' }, { type: 'tool_use', name: 'Bash', input: { command: 'secret' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'secret' }] } },
    { type: 'assistant', isSidechain: true, message: { content: 'worker message' } },
    { type: 'custom-title', customTitle: '인증 수정' }
  ]
  const result = parseRecords([...rows.map(r => JSON.stringify(r)), '{unfinished'], 'claude')
  assert.equal(result.cwd, '/tmp/project')
  assert.equal(result.title, '인증 수정')
  assert.deepEqual(result.messages.map(m => m.text), ['로그인 오류 수정', '토큰 갱신 수정 완료'])
})
test('Codex adapter reads conversational items without duplicating event messages', () => {
  const rows = [
    { type: 'session_meta', payload: { cwd: '/tmp/codex' } },
    { type: 'event_msg', payload: { type: 'task_started' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '# AGENTS.md instructions for /tmp/codex\n\n<INSTRUCTIONS>rules</INSTRUCTIONS>' }] } },
    { type: 'event_msg', payload: { type: 'user_message', message: 'fix auth' } },
    { type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'fix auth' }] } },
    { type: 'response_item', payload: { type: 'function_call', arguments: 'secret' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'fixed' }] } },
    { type: 'event_msg', payload: { type: 'task_complete' } }
  ]
  const parsed = parseRecords(rows.map(r => JSON.stringify(r)), 'codex')
  assert.equal(parsed.cwd, '/tmp/codex')
  assert.equal(parsed.turn, 'ended')
  assert.deepEqual(parsed.messages.map(m => m.text), ['fix auth', 'fixed'])
})
test('head and tail parsing retains first request and newest response for oversized logs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidoo-log-'))
  try {
    const file = path.join(dir, 'session.jsonl')
    const line = (role: string, text: string) => JSON.stringify({ type: role, cwd: '/tmp/project', message: { content: text } }) + '\n'
    await writeFile(file, line('user', 'first task') + ('{"type":"progress","data":"' + 'x'.repeat(500) + '"}\n').repeat(3000) + line('assistant', 'latest result') + '{unfinished')
    const parsed = await parseLog(file, 'claude')
    assert.equal(parsed.messages[0].text, 'first task')
    assert.equal(parsed.messages.at(-1)?.text, 'latest result')
    await writeFile(file, line('user', 'new task'))
    assert.equal((await parseLog(file, 'claude')).messages[0].text, 'new task')
  } finally { await rm(dir, { recursive: true }) }
})
test('shell quoting treats malicious names and paths as literal arguments', async () => {
  const value = "folder's $(echo injected) `date`\nsecond line"
  const { stdout } = await run('/bin/sh', ['-c', `printf '%s' ${shellQuote(value)}`])
  assert.equal(stdout, value)
})
test('sqlite adapter cannot write to source databases', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidoo-sql-'))
  try {
    const file = path.join(dir, 'test.db')
    await run('/usr/bin/sqlite3', [file, 'CREATE TABLE records (id INTEGER); INSERT INTO records VALUES(1);'])
    await assert.rejects(sql(file, 'DELETE FROM records'))
    assert.deepEqual(await sql(file, 'SELECT * FROM records'), [{ id: 1 }])
  } finally { await rm(dir, { recursive: true }) }
})
test('system scaffolding is omitted from summaries', () => {
  assert.equal(clean('<environment_context>private paths</environment_context>\n실제 요청'), '실제 요청')
})
test('Slack connector header and source-thread footer are removed from requests', () => {
  const wrapped = '[베이 Slack 연결기 입력: owner U1, channel C1, thread 1.2]\n배포 상태 확인해줘\n원본 스레드: https://example.slack.com/archives/C1/p12 (지시가 앞선 대화를 가리키면 이 스레드를 읽고 맥락을 확인하세요.)'
  assert.equal(clean(wrapped), '배포 상태 확인해줘')
  assert.equal(clean('[참고] 그대로 둔다'), '[참고] 그대로 둔다')
})
test('sessions resume in the innermost Orca worktree that contains their directory', () => {
  const worktrees = [{ id: 'repo::/w/app', path: '/w/app' }, { id: 'repo::/w/app/nested', path: '/w/app/nested' }]
  assert.equal(containingWorktree('/w/app/src', worktrees), 'repo::/w/app')
  assert.equal(containingWorktree('/w/app/nested/lib', worktrees), 'repo::/w/app/nested')
  assert.equal(containingWorktree('/w/app-2', worktrees), '')
})
test('read-only queries still open a WAL database after its writer has exited', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidoo wal-'))
  try {
    const file = path.join(dir, 'state_5.sqlite')
    await run('/usr/bin/sqlite3', [file, "PRAGMA journal_mode=WAL; CREATE TABLE threads(id); INSERT INTO threads VALUES ('t1');"])
    await rm(file + '-wal', { force: true }); await rm(file + '-shm', { force: true })
    assert.deepEqual(await sql(file, 'SELECT id FROM threads'), [{ id: 't1' }])
  } finally { await rm(dir, { recursive: true, force: true }) }
})
test('Claude turn state follows stop reasons, tool results, interrupts and turn markers', () => {
  const turn = (...rows: object[]) => parseRecords(rows.map(r => JSON.stringify(r)), 'claude').turn
  const ask = { type: 'user', message: { content: '테스트 돌려줘' } }
  const working = { type: 'assistant', message: { stop_reason: 'tool_use', content: [{ type: 'text', text: '돌리는 중이에요' }, { type: 'tool_use' }] } }
  const done = { type: 'assistant', message: { stop_reason: 'end_turn', content: [{ type: 'text', text: '다 통과했어요' }] } }
  assert.equal(turn(ask), 'open')
  assert.equal(turn(ask, working), 'open')
  assert.equal(turn(ask, working, { type: 'user', message: { content: [{ type: 'tool_result', content: 'ok' }] } }), 'open')
  assert.equal(turn(ask, done), 'ended')
  assert.equal(turn(ask, done, { type: 'user', isMeta: true, message: { content: 'Caveat: local' } }), 'ended')
  assert.equal(turn(ask, working, { type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }), 'ended')
  assert.equal(turn(ask, working, { type: 'system', subtype: 'turn_duration' }), 'ended')
})
test('session status separates running agents from finished turns and dropped ones', () => {
  assert.equal(sessionStatus('claude', 'open', 'assistant', 'busy', 9999), 'working')
  assert.equal(sessionStatus('claude', 'ended', 'assistant', 'idle', 5), 'reply')
  assert.equal(sessionStatus('claude', 'open', 'assistant', undefined, 30), 'working')
  assert.equal(sessionStatus('claude', 'open', 'assistant', undefined, 3600), 'stalled')
  assert.equal(sessionStatus('codex', 'open', 'assistant', undefined, 300), 'working')
  assert.equal(sessionStatus('codex', 'ended', 'assistant', undefined, 300), 'reply')
  assert.equal(sessionStatus('claude', 'ended', 'user', undefined, 3600), 'idle')
})
