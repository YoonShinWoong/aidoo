import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { promises as fs, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import type { Agent, Message, Session } from '../shared/types'
import { resolveProject, type ProjectAlias } from './projects'

const exec = promisify(execFile)
export const home = os.homedir()
export const orcaRoot = path.join(home, 'Library/Application Support/orca')
export const orcaCLI = '/Applications/Orca.app/Contents/Resources/bin/orca'
const LOG_BUDGET = 768 * 1024
const LIMIT = 500
type Row = Record<string, any>
type Turn = 'open' | 'ended' | ''
interface Parsed { cwd: string; title: string; messages: Message[]; turn: Turn }
interface Link { handle: string; title: string; workspacePath: string }
interface Worktree { id: string; path: string }
const cache = new Map<string, { version: string; parsed: Parsed }>()

export async function run(file: string, args: string[], timeout = 8000, cwd?: string) {
  const env = { ...process.env, PATH: `${path.dirname(file)}:${process.env.PATH || ''}` }
  return exec(file, args, { timeout, cwd, maxBuffer: 16 * 1024 * 1024, encoding: 'utf8', env })
}
async function entries(dir: string) {
  try { return await fs.readdir(dir, { withFileTypes: true }) } catch { return [] }
}
async function json(file: string, fallback: any = null): Promise<any> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) } catch { return fallback }
}
export async function sql(file: string, query: string): Promise<Row[]> {
  // macOS ships sqlite3; every connection explicitly read-only. No native npm ABI dependency.
  const read = (target: string) => run('/usr/bin/sqlite3', ['-readonly', '-json', '-cmd', '.timeout 1000', target, query])
  let stdout: string
  try { ({ stdout } = await read(file)) } catch (error) {
    // After the writer exits, a WAL database has no -shm and a read-only connection cannot create one.
    if (existsSync(file + '-wal')) throw error
    stdout = (await read(`file:${file.split('/').map(encodeURIComponent).join('/')}?immutable=1`)).stdout
  }
  return stdout.trim() ? JSON.parse(stdout) : []
}
export function clean(text: string) {
  return text.replace(/<(environment_context|system-reminder|user_instructions|developer_instructions)[^>]*>[\s\S]*?<\/\1>/g, '')
    // Slack 연결기(베이)가 요청마다 붙이는 머리말과 원본 스레드 안내
    .replace(/^\s*\[[^\]\n]{1,40} 입력: [^\]\n]*\]\s*/, '')
    .replace(/\s*원본 스레드: https:\/\/\S+ \([^)\n]*\)\s*$/, '')
    .replace(/```[\s\S]*?```/g, '[코드]').trim()
}
export function compact(text: string, length = 180) {
  const value = clean(text).replace(/\s+/g, ' ').replace(/^[ #*`-]+/, '').trim()
  return value.slice(0, length) + (value.length > length ? '…' : '')
}
function contentText(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter(b => ['text', 'input_text', 'output_text'].includes(b?.type))
    .map(b => b.text || '').join('\n')
}
function claudeTurn(row: Row): Turn {
  const message = row.message || {}
  if (row.type === 'assistant') return message.stop_reason && message.stop_reason !== 'tool_use' ? 'ended' : 'open'
  if (Array.isArray(message.content) && message.content.some((b: Row) => b?.type === 'tool_result')) return 'open'
  // Interrupts and local slash commands end the turn without an agent reply.
  return /^\s*(\[Request interrupted|<local-command|<command-)/.test(contentText(message.content)) ? 'ended' : 'open'
}
export function parseRecords(lines: string[], agent: Agent): Parsed {
  const parsed: Parsed = { cwd: '', title: '', messages: [], turn: '' }
  const seen = new Set<string>()
  for (const line of lines) {
    let row: Row
    try { row = JSON.parse(line) } catch { continue }
    let text = '', role: 'user' | 'assistant'
    if (agent === 'claude') {
      if (row.isSidechain) continue
      parsed.cwd ||= row.cwd || ''
      if (row.type === 'custom-title') parsed.title = row.customTitle || ''
      if (row.type === 'system' && row.subtype === 'turn_duration') parsed.turn = 'ended'
      if (!['user', 'assistant'].includes(row.type)) continue
      if (!row.isMeta && !row.isCompactSummary) parsed.turn = claudeTurn(row)
      role = row.type
      text = contentText(row.message?.content)
    } else {
      const p = row.payload || {}
      if (row.type === 'session_meta') parsed.cwd = p.cwd || ''
      if (row.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(p.type))
        parsed.turn = p.type === 'task_started' ? 'open' : 'ended'
      if (row.type !== 'response_item' || p.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue
      role = p.role
      text = contentText(p.content)
    }
    text = clean(text)
    if (!text || /^(<local-command|<command-|Caveat:|<task-notification|# AGENTS\.md instructions\b)/.test(text)) continue
    const signature = `${role}:${text}`
    if (seen.has(signature)) continue
    seen.add(signature)
    parsed.messages.push({ role, text: text.slice(0, 16000), timestamp: row.timestamp || '' })
  }
  parsed.messages = [...parsed.messages.slice(0, 2), ...parsed.messages.slice(2).slice(-18)]
  return parsed
}
export async function parseLog(file: string, agent: Agent): Promise<Parsed> {
  const stat = await fs.stat(file)
  const version = `${stat.size}:${stat.mtimeMs}`
  const cached = cache.get(file)
  if (cached?.version === version) return cached.parsed
  const fd = await fs.open(file, 'r')
  let chunks: Buffer[]
  try {
    if (stat.size <= LOG_BUDGET) {
      const buf = Buffer.alloc(stat.size)
      await fd.read(buf, 0, buf.length, 0)
      chunks = [buf]
    } else {
      const head = Buffer.alloc(Math.floor(LOG_BUDGET / 3))
      const tail = Buffer.alloc(Math.floor(LOG_BUDGET * 2 / 3))
      await fd.read(head, 0, head.length, 0)
      await fd.read(tail, 0, tail.length, stat.size - tail.length)
      chunks = [head.subarray(0, Math.max(0, head.lastIndexOf(10))), tail.subarray(tail.indexOf(10) + 1)]
    }
  } finally { await fd.close() }
  const parsed = parseRecords(chunks.flatMap(c => c.toString('utf8').split('\n')), agent)
  cache.set(file, { version, parsed })
  if (cache.size > 1200) cache.delete(cache.keys().next().value!)
  return parsed
}
async function codexHomes() {
  const roots = [process.env.CODEX_HOME || path.join(home, '.codex')]
  for (const item of await entries(path.join(orcaRoot, 'codex-accounts')))
    if (item.isDirectory()) roots.push(path.join(orcaRoot, 'codex-accounts', item.name, 'home'))
  const runtime = path.join(orcaRoot, 'codex-runtime-home')
  roots.push(runtime, path.join(runtime, 'home'))
  return [...new Set(roots)]
}
async function orcaJSON(args: string[]) {
  const { stdout } = await run(orcaCLI, [...args, '--json'], 5000)
  return JSON.parse(stdout)
}
export function containingWorktree(cwd: string, worktrees: Worktree[]) {
  return worktrees.filter(w => cwd === w.path || cwd.startsWith(w.path.replace(/\/$/, '') + '/'))
    .sort((a, b) => b.path.length - a.path.length)[0]?.id || ''
}
async function orcaLinks(warnings: string[]) {
  const links = new Map<string, Link>()
  const aliases: ProjectAlias[] = []
  let terminals: Row[] = [], worktrees: Worktree[] = []
  if (existsSync(orcaCLI)) {
    const [terminalList, worktreeList] = await Promise.allSettled([
      orcaJSON(['terminal', 'list', '--limit', '500']), orcaJSON(['worktree', 'list', '--limit', '1000'])])
    if (terminalList.status === 'rejected') warnings.push('Orca 연결 대기 중 · 로컬 기록은 계속 표시합니다.')
    else {
      terminals = terminalList.value.result?.terminals || []
      if (!terminalList.value.ok) warnings.push('Orca 연결이 제한됩니다. 실행 상태를 확인해 주세요.')
    }
    if (worktreeList.status === 'fulfilled')
      worktrees = (worktreeList.value.result?.worktrees || [])
        .filter((w: Row) => w.id && w.path && (w.hostId || 'local') === 'local').map((w: Row) => ({ id: w.id, path: w.path }))
  }
  const byPty = new Map(terminals.map(t => [t.ptyId, t]))
  for (const profile of await entries(path.join(orcaRoot, 'profiles'))) {
    if (!profile.isDirectory()) continue
    const base = path.join(orcaRoot, 'profiles', profile.name)
    let state: Row = {}
    try {
      if (existsSync(path.join(base, 'profile-state.db'))) {
        const rows = await sql(path.join(base, 'profile-state.db'),
          "SELECT domain, payload FROM profile_state_documents WHERE domain IN ('workspaceSession','repos','worktreeMeta','folderWorkspaces')")
        const domains = Object.fromEntries(rows.map(r => [r.domain, JSON.parse(r.payload)]))
        state = domains.workspaceSession || {}
        addProjectAliases(domains, aliases)
      } else {
        const domains = await json(path.join(base, 'orca-data.json'), {})
        state = domains.workspaceSession || {}
        addProjectAliases(domains, aliases)
      }
      for (const tabs of Object.values(state.tabsByWorktree || {}) as Row[][]) {
        for (const tab of tabs) {
          const vault = tab.aiVaultTitle
          if (!vault?.sessionId || !['claude', 'codex'].includes(vault.agent)) continue
          links.set(`${vault.agent}:${vault.sessionId}`, {
            handle: byPty.get(tab.ptyId)?.handle || '',
            title: tab.customTitle || vault.title || tab.title || '',
            workspacePath: byPty.get(tab.ptyId)?.worktreePath || ''
          })
        }
      }
    } catch { warnings.push(`Orca 프로필을 읽지 못했습니다: ${profile.name}`) }
  }
  return { links, aliases, worktrees }
}
function addProjectAliases(domains: Row, aliases: ProjectAlias[]) {
  const repos = new Map<string, string>((domains.repos || []).filter((r: Row) => r.path).map((r: Row) => [r.id, r.path]))
  for (const [key, meta] of Object.entries(domains.worktreeMeta || {}) as [string, Row][]) {
    if (meta.hostId && meta.hostId !== 'local') continue
    const split = key.indexOf('::')
    if (split < 0) continue
    const projectPath = repos.get(key.slice(0, split))
    if (projectPath) aliases.push({ workspacePath: key.slice(split + 2), projectPath })
  }
  for (const repoPath of repos.values()) aliases.push({ workspacePath: repoPath, projectPath: repoPath })
}
// Claude Code registers each running process with its session id and whether it is busy.
async function liveClaude(): Promise<Map<string, string>> {
  const dirs = [...new Set([path.join(home, '.claude/sessions'),
    ...(process.env.CLAUDE_CONFIG_DIR ? [path.join(process.env.CLAUDE_CONFIG_DIR, 'sessions')] : [])])]
  const records: Row[] = []
  for (const dir of dirs)
    for (const e of await entries(dir)) {
      if (!e.isFile() || !e.name.endsWith('.json')) continue
      const record = await json(path.join(dir, e.name))
      if (record?.sessionId && Number.isInteger(record.pid)) records.push(record)
    }
  const live = new Map<string, string>()
  if (!records.length) return live
  // Exited processes leave their file behind and pids get reused, so the start time has to match too.
  const { stdout } = await exec('/bin/ps', ['-o', 'pid=,lstart=', '-p', records.map(r => r.pid).join(',')],
    { encoding: 'utf8', timeout: 5000, env: { ...process.env, TZ: 'UTC' } }).catch(error => ({ stdout: String(error.stdout || '') }))
  const started = new Map(stdout.split('\n').map(line => line.trim().match(/^(\d+)\s+(.+)$/))
    .filter(m => m !== null).map(m => [Number(m[1]), m[2].replace(/\s+/g, ' ')]))
  for (const r of records) {
    const start = started.get(r.pid)
    if (!start || (r.procStart && start !== String(r.procStart).replace(/\s+/g, ' ').trim())) continue
    if (live.get(r.sessionId) !== 'busy') live.set(r.sessionId, String(r.status || 'idle'))
  }
  return live
}
export function sessionStatus(agent: Agent, turn: Turn, lastRole: string | undefined, live: string | undefined, quietSeconds: number): Session['status'] {
  if (live === 'busy') return 'working'
  if (!live && turn === 'open') return quietSeconds < (agent === 'codex' ? 600 : 120) ? 'working' : 'stalled'
  if (lastRole === 'assistant') return 'reply'
  return quietSeconds < 120 ? 'recent' : 'idle'
}
async function session(agent: Agent, sid: string, file: string, codexHome: string, meta: Row, links: Map<string, Link>, worktrees: Worktree[], live = new Map<string, string>()): Promise<Session | null> {
  const parsed = await parseLog(file, agent)
  const cwd = meta.cwd || parsed.cwd
  if (!cwd || !parsed.messages.length) return null
  const link = links.get(`${agent}:${sid}`)
  const requests = parsed.messages.filter(m => m.role === 'user')
  const replies = parsed.messages.filter(m => m.role === 'assistant')
  const originalTitle = meta.name || parsed.title || link?.title || meta.title || ''
  const first = requests[0]?.text || ''
  const suggestedTitle = compact(first.split('\n').find(l => l.trim()) || originalTitle, 52) || '새 작업'
  const modifiedAt = (await fs.stat(file)).mtimeMs / 1000
  let updatedAt = meta.updated_at || modifiedAt
  if (updatedAt > 100000000000) updatedAt /= 1000
  return {
    id: `${agent}:${sid}`, sessionId: sid, agent, cwd, projectPath: link?.workspacePath || cwd,
    originalTitle: compact(originalTitle) || suggestedTitle, suggestedTitle,
    goal: compact(first, 400), latestRequest: compact(requests.at(-1)?.text || '', 600),
    latestReply: compact(replies.at(-1)?.text || '', 1000), messages: parsed.messages,
    updatedAt, status: sessionStatus(agent, parsed.turn, parsed.messages.at(-1)?.role, live.get(sid), Date.now() / 1000 - Math.max(updatedAt, modifiedAt)),
    sourcePath: file, codexHome, orcaHandle: link?.handle || '', inOrca: !!link,
    orcaWorktree: containingWorktree(cwd, worktrees), cwdMissing: !existsSync(cwd)
  }
}
export async function collect(workspaceRoots: string[] = [path.join(home, 'workspace')]) {
  const warnings: string[] = []
  const [{ links, aliases, worktrees }, live] = await Promise.all([orcaLinks(warnings), liveClaude()])
  const sessions = new Map<string, Session>()
  const roots = [...new Set([path.join(home, '.claude/projects'),
    ...(process.env.CLAUDE_CONFIG_DIR ? [path.join(process.env.CLAUDE_CONFIG_DIR, 'projects')] : [])])]
  const candidates: { file: string; mtime: number }[] = []
  for (const root of roots) {
    for (const project of await entries(root)) {
      if (!project.isDirectory()) continue
      for (const log of await entries(path.join(root, project.name))) {
        if (!log.isFile() || !log.name.endsWith('.jsonl')) continue
        const file = path.join(root, project.name, log.name)
        try { candidates.push({ file, mtime: (await fs.stat(file)).mtimeMs }) } catch { /* removed during scan */ }
      }
    }
  }
  candidates.sort((a, b) => b.mtime - a.mtime)
  for (const { file } of candidates.slice(0, LIMIT)) {
    try {
      const item = await session('claude', path.basename(file, '.jsonl'), file, '', {}, links, worktrees, live)
      if (item) sessions.set(item.id, item)
    } catch { warnings.push(`Claude 기록 일부를 읽지 못했습니다: ${path.basename(file)}`) }
  }
  for (const root of await codexHomes()) {
    const databases = (await entries(root)).filter(e => /^state_\d+\.sqlite$/.test(e.name))
      .sort((a, b) => Number(b.name.match(/\d+/)![0]) - Number(a.name.match(/\d+/)![0]))
    if (!databases.length) continue
    try {
      const file = path.join(root, databases[0].name)
      const tables = await sql(file, "SELECT name FROM sqlite_master WHERE type='table' AND name='threads'")
      if (!tables.length) continue
      const rows = await sql(file, `SELECT * FROM threads WHERE archived=0 ORDER BY updated_at DESC LIMIT ${LIMIT}`)
      for (const row of rows) {
        if (row.agent_role || /subagent/i.test(row.source || '')) continue
        try {
          const item = await session('codex', row.id, row.rollout_path, root, row, links, worktrees)
          if (item && (!sessions.has(item.id) || item.inOrca)) sessions.set(item.id, item)
        } catch { /* stale index entry, unavailable log */ }
      }
    } catch { warnings.push('Codex 인덱스 일부를 읽지 못했습니다.') }
  }
  const values = [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, LIMIT)
  const projects = new Map<string, string>()
  for (const s of values) {
    const directory = s.projectPath
    if (!projects.has(directory)) projects.set(directory, await resolveProject(directory, workspaceRoots, aliases))
    s.projectPath = projects.get(directory)!
  }
  return {
    sessions: values,
    warnings: [...new Set(warnings)], scannedAt: Date.now()
  }
}
export async function findCLI(name: string): Promise<string | null> {
  const candidates = [path.join(home, '.local/bin', name), `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]
  for (const entry of await entries(path.join(home, '.asdf/installs/nodejs')))
    candidates.push(path.join(home, '.asdf/installs/nodejs', entry.name, 'bin', name))
  for (const dir of (process.env.PATH || '').split(path.delimiter)) candidates.push(path.join(dir, name))
  return candidates.find(p => existsSync(p) && !p.includes('/shims/')) || null
}
export function shellQuote(value: string) { return "'" + value.replace(/'/g, "'\\''") + "'" }
export async function resumeCommand(s: Session) {
  const cli = await findCLI(s.agent === 'claude' ? 'claude' : 'codex') || (s.agent === 'claude' ? 'claude' : 'codex')
  const parts = s.agent === 'claude' ? [cli, '--resume', s.sessionId] : [cli, 'resume', s.sessionId]
  const env = s.agent === 'codex' && s.codexHome ? `CODEX_HOME=${shellQuote(s.codexHome)} ` : ''
  return `cd ${shellQuote(s.cwd)} && ${env}${parts.map(shellQuote).join(' ')}`
}
