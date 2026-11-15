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
interface Parsed { cwd: string; title: string; messages: Message[]; lastEvent: string }
interface Link { handle: string; title: string; workspacePath: string }
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
  const { stdout } = await run('/usr/bin/sqlite3', ['-readonly', '-json', '-cmd', '.timeout 1000', file, query])
  return stdout.trim() ? JSON.parse(stdout) : []
}
export function clean(text: string) {
  return text.replace(/<(environment_context|system-reminder|user_instructions|developer_instructions)[^>]*>[\s\S]*?<\/\1>/g, '')
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
export function parseRecords(lines: string[], agent: Agent): Parsed {
  const parsed: Parsed = { cwd: '', title: '', messages: [], lastEvent: '' }
  const seen = new Set<string>()
  for (const line of lines) {
    let row: Row
    try { row = JSON.parse(line) } catch { continue }
    let text = '', role: 'user' | 'assistant'
    if (agent === 'claude') {
      if (row.isSidechain) continue
      parsed.cwd ||= row.cwd || ''
      if (row.type === 'custom-title') parsed.title = row.customTitle || ''
      if (!['user', 'assistant'].includes(row.type)) continue
      role = row.type
      text = contentText(row.message?.content)
    } else {
      const p = row.payload || {}
      if (row.type === 'session_meta') parsed.cwd = p.cwd || ''
      if (row.type === 'event_msg' && ['task_started', 'task_complete', 'turn_aborted'].includes(p.type))
        parsed.lastEvent = p.type
      if (row.type !== 'response_item' || p.type !== 'message' || !['user', 'assistant'].includes(p.role)) continue
      role = p.role
      text = contentText(p.content)
    }
    text = clean(text)
    if (!text || /^(<local-command|<command-|Caveat:|<task-notification)/.test(text)) continue
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
  if (existsSync(runtime)) roots.push(runtime)
  return [...new Set(roots)]
}
async function orcaLinks(warnings: string[]) {
  const links = new Map<string, Link>()
  const aliases: ProjectAlias[] = []
  let terminals: Row[] = []
  if (existsSync(orcaCLI)) {
    try {
      const { stdout } = await run(orcaCLI, ['terminal', 'list', '--limit', '500', '--json'], 5000)
      const result = JSON.parse(stdout)
      terminals = result.result?.terminals || []
      if (!result.ok) warnings.push('Orca 연결이 제한됩니다. 실행 상태를 확인해 주세요.')
    } catch { warnings.push('Orca 연결 대기 중 · 로컬 기록은 계속 표시합니다.') }
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
  return { links, aliases }
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
async function session(agent: Agent, sid: string, file: string, codexHome: string, meta: Row, links: Map<string, Link>): Promise<Session | null> {
  const parsed = await parseLog(file, agent)
  const cwd = meta.cwd || parsed.cwd
  if (!cwd || !parsed.messages.length) return null
  const link = links.get(`${agent}:${sid}`)
  const requests = parsed.messages.filter(m => m.role === 'user')
  const replies = parsed.messages.filter(m => m.role === 'assistant')
  const originalTitle = meta.name || parsed.title || link?.title || meta.title || ''
  const first = requests[0]?.text || ''
  const suggestedTitle = compact(first.split('\n').find(l => l.trim()) || originalTitle, 52) || '새 작업'
  let updatedAt = meta.updated_at || (await fs.stat(file)).mtimeMs / 1000
  if (updatedAt > 100000000000) updatedAt /= 1000
  const reply = parsed.lastEvent === 'task_complete' || (parsed.messages.at(-1)?.role === 'assistant' && parsed.lastEvent !== 'task_started')
  return {
    id: `${agent}:${sid}`, sessionId: sid, agent, cwd, projectPath: link?.workspacePath || cwd,
    originalTitle: compact(originalTitle) || suggestedTitle, suggestedTitle,
    goal: compact(first, 400), latestRequest: compact(requests.at(-1)?.text || '', 600),
    latestReply: compact(replies.at(-1)?.text || '', 1000), messages: parsed.messages,
    updatedAt, status: reply ? 'reply' : Date.now() / 1000 - updatedAt < 120 ? 'recent' : 'idle',
    sourcePath: file, codexHome, orcaHandle: link?.handle || '', inOrca: !!link
  }
}
export async function collect(workspaceRoots: string[] = [path.join(home, 'workspace')]) {
  const warnings: string[] = []
  const { links, aliases } = await orcaLinks(warnings)
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
      const item = await session('claude', path.basename(file, '.jsonl'), file, '', {}, links)
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
          const item = await session('codex', row.id, row.rollout_path, root, row, links)
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
