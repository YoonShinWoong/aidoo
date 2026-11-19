import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, ArrowDownUp, ArrowUpRight, Check, CheckCheck, ChevronRight, Circle, CircleCheck,
  Code2, Copy, Folder, FolderOpen, FolderX, Inbox, Layers, LayoutGrid, Link2, LoaderCircle, MoreHorizontal,
  Pencil, Pin, RefreshCw, Search, ShieldCheck, Sparkles, Terminal, X, Settings as SettingsIcon, Monitor, Sun, Moon, Plus, Clock3, FileText } from 'lucide-react'
import type { Session, SessionState, Snapshot, Settings } from '../../shared/types'
import './style.css'
import './theme.css'
import { Notes } from './Notes'
import { Resizer, usePaneWidth } from './Resizer'

type Order = 'recent' | 'project'
type Filter = 'all' | 'today' | 'pinned' | 'working' | 'reply' | 'done'
const labels: Record<Filter, string> = { all: '모든 작업', today: '최근 24시간', pinned: '이어 할 일', working: '작업 중', reply: '답변 도착', done: '완료한 작업' }
const statusLabels: Record<Session['status'], [string, string]> = {
  working: ['작업 중', '에이전트가 지금 응답을 만들거나 도구를 실행하고 있어요.'],
  reply: ['답변 도착', '에이전트가 작업을 마치고 내 답을 기다려요.'],
  stalled: ['중단됨', '작업 도중 멈춘 대화예요. 터미널이 닫혔거나 응답이 끊겼어요.'],
  recent: ['최근 활동', '방금 내가 보낸 요청이 마지막 기록이에요.'],
  idle: ['이전 대화', '마지막 기록이 내 요청이에요.']
}
const DAY_SECONDS = 86400
const shortPath = (value: string) => value.replace(/^\/Users\/[^/]+/, '~')
const folderName = (value: string) => value.split('/').filter(Boolean).at(-1) || value
const exactTime = (seconds: number) => new Date(seconds * 1000).toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
const shortTime = (seconds: number) => new Date(seconds * 1000).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
function relativeTime(seconds: number) {
  const delta = Math.max(0, Date.now() / 1000 - seconds)
  if (delta < 60) return '방금'
  if (delta < 3600) return `${Math.floor(delta / 60)}분 전`
  if (delta < 86400) return `${Math.floor(delta / 3600)}시간 전`
  return `${Math.floor(delta / 86400)}일 전`
}
function AgentMark({ agent, small = false }: { agent: string; small?: boolean }) {
  return <span className={`agent-mark ${small ? 'small' : ''}`} data-agent={agent}>{agent === 'claude' ? <Sparkles size={small ? 11 : 17} /> : <Code2 size={small ? 12 : 18} />}</span>
}
function StatusChip({ status, done }: { status: Session['status']; done?: boolean }) {
  return <span className={`status ${done ? 'completed' : status}`} title={done ? undefined : statusLabels[status][1]}>
    {done ? <Check size={11}/> : <span className="dot"/>}{done ? '완료' : statusLabels[status][0]}</span>
}
function App() {
  const [data, setData] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [directory, setDirectory] = useState('')
  const [agent, setAgent] = useState('all')
  const [order, setOrder] = useState<Order>(() => { try { return localStorage.getItem('aidoo.order') === 'project' ? 'project' : 'recent' } catch { return 'recent' } })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null)
  const [rename, setRename] = useState<Session | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [alsoOrca, setAlsoOrca] = useState(true)
  const [showNotes, setShowNotes] = useState(false)
  const [confirmAI, setConfirmAI] = useState(false)
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const sidebar = usePaneWidth('sidebar')
  const detail = usePaneWidth('detail')
  const search = useRef<HTMLInputElement>(null)
  const scanning = useRef(false)
  const alive = useRef(true)
  const notify = useCallback((text: string, error = false) => setToast({ text, error }), [])
  const scan = useCallback(async () => {
    if (scanning.current) return
    scanning.current = true
    setLoading(true)
    try {
      const next = await window.aidoo.scan()
      if (alive.current) setData(next)
    } catch { notify('세션을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.', true) }
    finally { scanning.current = false; if (alive.current) setLoading(false) }
  }, [notify])
  useEffect(() => {
    return window.aidoo.onOpenSettings(() => setShowSettings(true))
  }, [])
  useEffect(() => {
    alive.current = true
    scan()
    const timer = setInterval(scan, 15000)
    const focus = () => scan()
    window.addEventListener('focus', focus)
    return () => { alive.current = false; clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [scan])
  useEffect(() => {
    if (!toast) return
    const timeout = setTimeout(() => setToast(null), toast.error ? 9000 : 3200)
    return () => clearTimeout(timeout)
  }, [toast])
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey && e.key === 'k') || (e.key === '/' && !['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName))) {
        e.preventDefault(); search.current?.focus()
      }
      if (e.metaKey && e.key === 'r') { e.preventDefault(); scan() }
      if (e.metaKey && e.key === ',') { e.preventDefault(); setShowSettings(true) }
      if (e.key === 'Escape') { setRename(null); setConfirmAI(false); setShowInfo(false); setShowSettings(false) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [scan])
  const sessions = data?.sessions || []
  const state = data?.state || {}
  const titleOf = (s: Session) => state[s.id]?.title || s.originalTitle
  const activeSince = Date.now() / 1000 - DAY_SECONDS
  const counts = {
    all: sessions.filter(s => !state[s.id]?.done).length,
    today: sessions.filter(s => s.updatedAt >= activeSince && !state[s.id]?.done).length,
    pinned: sessions.filter(s => state[s.id]?.pinned && !state[s.id]?.done).length,
    working: sessions.filter(s => s.status === 'working' && !state[s.id]?.done).length,
    reply: sessions.filter(s => s.status === 'reply' && !state[s.id]?.done).length,
    done: sessions.filter(s => state[s.id]?.done).length
  }
  const pinnedFirst = data?.settings.pinnedFirst ?? true
  const pinRank = (s: Session) => state[s.id]?.pinned && !state[s.id]?.done ? 1 : 0
  const filtered = sessions.filter(s => {
    const st = state[s.id] || {}
    if (filter === 'done' ? !st.done : st.done) return false
    if (filter === 'today' && s.updatedAt < activeSince) return false
    if (filter === 'pinned' && !st.pinned) return false
    if ((filter === 'working' || filter === 'reply') && s.status !== filter) return false
    if (agent !== 'all' && s.agent !== agent) return false
    const q = query.toLocaleLowerCase().trim()
    return !q || [titleOf(s), s.projectPath, s.cwd, s.goal, s.latestRequest, s.latestReply, st.note, st.ai?.summary].join(' ').toLocaleLowerCase().includes(q)
  }).sort((a, b) => (pinnedFirst ? pinRank(b) - pinRank(a) : 0) || b.updatedAt - a.updatedAt)
  const dirCounts = new Map<string, number>()
  for (const s of filtered) dirCounts.set(s.projectPath, (dirCounts.get(s.projectPath) || 0) + 1)
  const dirs = [...dirCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const visible = filtered.filter(s => !directory || s.projectPath === directory)
  const grouped = order === 'project' && !directory
  const groups = new Map<string, Session[]>()
  if (grouped) for (const s of visible) groups.set(s.projectPath, [...(groups.get(s.projectPath) || []), s])
  function changeOrder(next: Order) {
    setOrder(next)
    try { localStorage.setItem('aidoo.order', next) } catch { /* storage unavailable: keep for this window only */ }
  }
  const active = visible.find(s => s.id === selected) || visible[0]
  const activeState = active ? state[active.id] || {} : {}
  async function changeSettings(patch: Partial<Settings>) {
    setSettingsBusy(true)
    try {
      const settings = await window.aidoo.updateSettings(patch)
      setData(prev => prev ? { ...prev, settings } : prev)
      if (patch.workspaceRoots) { setDirectory(''); setData(await window.aidoo.scan()) }
    } catch (error) { notify(errorMessage(error), true) }
    finally { setSettingsBusy(false) }
  }
  async function addWorkspace() {
    try {
      const selected = await window.aidoo.chooseWorkspace()
      if (selected) await changeSettings({ workspaceRoots: [...new Set([...(data?.settings.workspaceRoots || []), selected])] })
    } catch (error) { notify(errorMessage(error), true) }
  }

  async function update(id: string, patch: Partial<SessionState>) {
    try {
      const st = await window.aidoo.update(id, patch)
      setData(prev => prev ? { ...prev, state: { ...prev.state, [id]: st } } : prev)
      return true
    } catch (error) { notify(errorMessage(error), true); return false }
  }
  async function perform(action: () => Promise<unknown>, success?: string) {
    setActionBusy(true)
    try { await action(); if (success) notify(success) }
    catch (error) { notify(errorMessage(error), true) }
    finally { setActionBusy(false) }
  }
  function startRename(s: Session, suggested = false) {
    setRename(s); setNewTitle(suggested ? state[s.id]?.ai?.title || s.suggestedTitle : titleOf(s)); setAlsoOrca(true)
  }
  async function saveRename() {
    if (!rename || !newTitle.trim()) return
    setActionBusy(true)
    try {
      const result = await window.aidoo.renameSession(rename.id, newTitle.trim(), alsoOrca)
      setData(prev => prev ? { ...prev, state: { ...prev.state, [rename.id]: result.state } } : prev)
      if (result.warnings.length) {
        notify('에이두 이름은 저장됐어요. ' + result.warnings.join(' / '), true)
      } else {
        setRename(null)
        notify(alsoOrca ? (result.orcaUpdated ? '원본 세션과 Orca 탭 이름까지 변경했어요.' : '원본 세션 이름까지 변경했어요.') : '에이두 표시 이름을 변경했어요.')
      }
    } catch (error) { notify(errorMessage(error), true) }
    finally { setActionBusy(false) }
  }
  async function summarize() {
    if (!active) return
    const id = active.id
    setConfirmAI(false); setAiBusy(id)
    try {
      const ai = await window.aidoo.summarize(id)
      setData(prev => prev ? { ...prev, state: { ...prev.state, [id]: { ...prev.state[id], ai } } } : prev)
      notify('요약과 다음 할 일을 정리했어요.')
    } catch (error) { notify(errorMessage(error), true) }
    finally { setAiBusy(null) }
  }

  return <div className="app-shell">
    <aside className="sidebar" ref={sidebar.ref} style={sidebar.style}>
      <div className="traffic-space" />
      <div className="brand"><div className="brand-icon"><span>a</span><i /></div><div><strong>aidoo</strong><p>AI 작업, 이어서 하다.</p></div></div>
      <div className="sidebar-label">WORKSPACE</div>
      <nav className="main-nav">{(['all', 'today', 'pinned', 'working', 'reply', 'done'] as Filter[]).map((f, i) => {
        const Icon = [LayoutGrid, Activity, Pin, LoaderCircle, Inbox, CircleCheck][i]
        return <button key={f} className={filter === f && !directory && !showNotes ? 'nav-item active' : 'nav-item'} onClick={() => { setShowNotes(false); setFilter(f); setDirectory('') }}>
          <Icon size={17} /><span>{labels[f]}</span><b>{counts[f]}</b></button>
      })}</nav>
      <button className={`notebook-entry ${showNotes ? 'active' : ''}`} aria-label="메모장" aria-pressed={showNotes} onClick={() => setShowNotes(true)}><FileText size={22}/><span><strong>메모장</strong><small>아이디어 · 할 일</small></span><ChevronRight size={16}/></button>
      <div className="sidebar-label projects-label">PROJECTS <span>{dirs.length}</span></div>
      <div className="projects">{dirs.map(([dir, count]) => <button key={dir} title={dir} className={`project-item ${directory === dir ? 'active' : ''}`}
        onClick={() => { setShowNotes(false); setDirectory(dir) }}><Folder size={16} /><div><span>{folderName(dir)}</span><small>{shortPath(dir).split('/').slice(0, -1).join('/')}</small></div><b>{count}</b></button>)}</div>
      <button className="settings-entry" onClick={() => setShowSettings(true)}><SettingsIcon size={17}/><span>설정</span><kbd>⌘ ,</kbd></button>
      <button className="local-card" onClick={() => setShowInfo(true)}><ShieldCheck size={18} /><div><strong>내 맥에서 안전하게</strong><span>로컬 수집 · 15초마다 갱신</span></div><ChevronRight size={14} /></button>
      <div className="sidebar-footer"><span className="dot green"/> Claude Code + Codex <button className="icon-button" title="수집 및 요약 안내" onClick={() => setShowInfo(true)}><MoreHorizontal size={16}/></button></div>
    </aside>
    <Resizer pane={sidebar} edge="end" min={190} max={400} label="사이드바 너비"/>
    <Notes active={showNotes}/>
    <main className="workspace" hidden={showNotes}>
      <header className="topbar"><div className="breadcrumb"><Layers size={15}/><span>나의 작업대</span><ChevronRight size={13}/><strong>{directory ? folderName(directory) : labels[filter]}</strong></div>
        <div className="topbar-right"><span className="live"><span className={`dot ${loading ? 'amber' : 'green'}`}/>{loading ? '동기화 중' : '로컬 동기화'}</span><button className="icon-button" title="새로고침 ⌘R" onClick={scan} disabled={loading}><RefreshCw size={16} className={loading ? 'spin' : ''}/></button></div></header>
      <div className="page-intro"><div><div className="eyebrow">YOUR AGENT WORKSPACE</div><h1>{directory ? folderName(directory) : filter === 'all' ? '흩어진 작업을, 한눈에.' : labels[filter]}</h1><p>{directory ? shortPath(directory) : '어디까지 했는지 확인하고, 다음 할 일을 이어가세요.'}</p></div><div className="session-total"><strong>{visible.length}</strong><span>개의 대화</span></div></div>
      <div className="stats-strip">
        <button onClick={() => { setFilter('today'); setDirectory('') }}><span className="stat-icon teal"><Activity size={16}/></span><span>최근 24시간</span><strong>{counts.today}</strong></button>
        <button onClick={() => { setFilter('pinned'); setDirectory('') }}><span className="stat-icon teal"><Pin size={16}/></span><span>이어 할 일</span><strong>{counts.pinned}</strong></button>
        <button onClick={() => { setFilter('working'); setDirectory('') }}><span className="stat-icon working"><LoaderCircle size={16}/></span><span>작업 중</span><strong>{counts.working}</strong></button>
        <button onClick={() => { setFilter('reply'); setDirectory('') }}><span className="stat-icon orange"><Inbox size={16}/></span><span>답변 도착</span><strong>{counts.reply}</strong></button>
        <button onClick={() => { setFilter('done'); setDirectory('') }}><span className="stat-icon gray"><CheckCheck size={17}/></span><span>완료한 작업</span><strong>{counts.done}</strong></button>
      </div>
      <div className="workspace-body"><section className="sessions-pane" data-flex-min="360">
        <div className="list-toolbar"><div className="search-box"><Search size={16}/><input ref={search} value={query} onChange={e => setQuery(e.target.value)} placeholder="주제, 프로젝트, 대화 검색" aria-label="작업 검색"/>{query ? <button onClick={() => setQuery('')} title="검색 지우기"><X size={14}/></button> : <kbd>⌘ K</kbd>}</div>
          <div className="agent-filters">{[['all', '전체'], ['claude', 'Claude'], ['codex', 'Codex']].map(([a, label]) => <button key={a} onClick={() => setAgent(a)} className={agent === a ? 'selected' : ''} data-agent={a === 'all' ? undefined : a}>{label}</button>)}</div></div>
        <div className="list-caption"><span>{directory ? '프로젝트 대화' : grouped ? '프로젝트별 대화' : '전체 대화'} <b>{visible.length}</b></span>{directory ? <span><ArrowDownUp size={12}/> 최근 활동순</span> : <div className="agent-filters order-toggle" role="group" aria-label="목록 정렬">{([['recent', '최근 대화순', ArrowDownUp], ['project', '프로젝트별', FolderOpen]] as const).map(([value, label, Icon]) => <button key={value} className={order === value ? 'selected' : ''} aria-pressed={order === value} onClick={() => changeOrder(value)}><Icon size={12}/>{label}</button>)}</div>}</div>
        <div className="session-scroll">
          {data?.warnings.map(w => <div className="warning" key={w}>{w}</div>)}
          {!data && loading && <div className="empty-state"><LoaderCircle className="spin" size={28}/><h3>대화를 모으고 있어요</h3><p>Claude Code와 Codex의 로컬 기록을 읽는 중입니다.</p></div>}
          {data && !visible.length && <div className="empty-state"><Inbox size={34}/><h3>{query ? '검색 결과가 없어요' : filter === 'today' ? '최근 24시간 동안 활동한 대화가 없어요' : filter === 'working' ? '지금 작업 중인 대화가 없어요' : filter === 'pinned' ? '이어 할 일을 골라보세요' : filter === 'done' ? '아직 완료한 작업이 없어요' : '표시할 대화가 없어요'}</h3><p>{filter === 'pinned' ? '대화의 핀 버튼을 누르면 여기에 모입니다.' : '필터를 바꾸거나 새 대화를 시작한 뒤 새로고침해 보세요.'}</p><button className="button secondary" onClick={() => { setFilter('all'); setDirectory(''); setQuery(''); setAgent('all') }}>모든 작업 보기</button></div>}
          {(grouped ? [...groups] : [['', visible] as const]).map(([dir, items]) => <div className="session-group" key={dir || 'recent'}>
            {grouped && <div className="group-heading" title={dir}><FolderOpen size={15}/><strong>{folderName(dir)}</strong><span>{shortPath(dir)}</span><b>{items.length}</b></div>}
            {items.map(s => { const st = state[s.id] || {}; return <article key={s.id} className={`session-card ${active?.id === s.id ? 'selected' : ''} ${st.done ? 'done' : ''}`} onClick={() => setSelected(s.id)} tabIndex={0} onKeyDown={e => { if (e.key === 'Enter') setSelected(s.id) }}>
              <div className="card-top"><span className="agent-name" data-agent={s.agent}><AgentMark agent={s.agent} small/>{s.agent === 'claude' ? 'Claude Code' : 'Codex'}{s.inOrca && <span className="orca-label"><Link2 size={10}/> Orca</span>}{!directory && !grouped && <span className="card-project" title={shortPath(s.projectPath)}><Folder size={11}/>{folderName(s.projectPath)}</span>}</span><span className="card-meta"><StatusChip status={s.status} done={st.done}/><time className="card-time" dateTime={new Date(s.updatedAt * 1000).toISOString()} title={exactTime(s.updatedAt)}><strong>{relativeTime(s.updatedAt)}</strong><span>{shortTime(s.updatedAt)}</span></time></span></div>
              <h3>{st.done && <CircleCheck size={15}/>} {titleOf(s)}</h3>
              <div className="card-bottom"><p className="card-summary">{st.ai?.summary || s.latestReply || s.latestRequest}</p>
                <button className={`pin-button ${st.pinned ? 'pinned' : ''}`} title={st.pinned ? '이어 할 일에서 해제' : '이어 할 일로 고정'} aria-label={st.pinned ? '이어 할 일에서 해제' : '이어 할 일로 고정'} aria-pressed={!!st.pinned} onClick={e => { e.stopPropagation(); update(s.id, { pinned: !st.pinned }) }}><Pin size={13}/></button></div>
              {st.note && <p className="card-note"><Pencil size={11}/>{st.note}</p>}
            </article> })}
          </div>)}
        </div>
        <footer className="list-footer"><span><span className="dot green"/> {data ? `마지막 갱신 ${new Date(data.scannedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}` : '연결 중'}</span><span>대화 기록은 수정하지 않아요</span></footer>
      </section>
      <Resizer pane={detail} edge="start" min={300} max={720} label="상세 패널 너비"/>
      <aside className="detail-pane" ref={detail.ref} style={detail.style}>{active ? <>
        <div className="detail-top"><span>작업 살펴보기</span><div><button className={`icon-button ${activeState.pinned ? 'is-pinned' : ''}`} title="할 일 고정" onClick={() => update(active.id, { pinned: !activeState.pinned })}><Pin size={16}/></button><button className="icon-button" title="이름 변경" onClick={() => startRename(active)}><Pencil size={16}/></button></div></div>
        <div className="detail-scroll" key={active.id}>
          <div className="detail-agent" data-agent={active.agent}><AgentMark agent={active.agent}/><span>{active.agent === 'claude' ? 'Claude Code' : 'Codex'}</span><span className="detail-session">{active.sessionId.slice(0, 8)}</span></div>
          <h2>{titleOf(active)}</h2>
          <div className="detail-updated"><Clock3 size={13}/><span>최근 활동 <time dateTime={new Date(active.updatedAt * 1000).toISOString()}>{exactTime(active.updatedAt)}</time></span><StatusChip status={active.status} done={activeState.done}/></div>
          <button className="directory-link" title={active.cwd} onClick={() => perform(() => window.aidoo.showFolder(active.id))}><Folder size={13}/><span>{shortPath(active.cwd)}</span><ArrowUpRight size={12}/></button>
          <button className="button primary open-session" disabled={actionBusy || (!active.orcaHandle && active.cwdMissing)} onClick={() => perform(() => window.aidoo.openSession(active.id))}>{active.orcaHandle ? <><ArrowUpRight size={16}/> Orca에서 대화 열기</> : active.cwdMissing ? <><FolderX size={16}/> 작업 폴더가 지워졌어요</> : active.orcaWorktree ? <><ArrowUpRight size={16}/> Orca에서 세션 재개</> : <><Terminal size={16}/> Terminal에서 세션 재개</>}</button>
          <div className="detail-actions"><button onClick={() => update(active.id, { pinned: !activeState.pinned })}><Pin size={13}/>{activeState.pinned ? '고정 해제' : '이어 할 일로'}</button><button onClick={() => update(active.id, { done: !activeState.done })}><CircleCheck size={14}/>{activeState.done ? '완료 취소' : '완료 처리'}</button><button title="재개 명령 복사" onClick={() => perform(() => window.aidoo.copyResume(active.id), '재개 명령을 복사했어요.')}><Copy size={14}/></button></div>
          <div className="detail-divider"/>
          <section className="summary-section"><div className="section-title"><h4><Sparkles size={14}/> {activeState.ai ? 'AI 작업 요약' : '최근 대화 발췌'}</h4><span className="subtle-tag" data-agent={activeState.ai ? 'claude' : undefined}>{activeState.ai ? 'Claude' : '로컬'}</span></div>
            {activeState.ai ? <><p className="ai-text">{activeState.ai.summary}</p>{activeState.ai.updatedAt < active.updatedAt && <p className="stale-note">요약 이후 새 대화가 있어요. 다시 요약해 보세요.</p>}</> : <>
              <div className="excerpt"><span>최근 요청</span><p>{active.latestRequest || '요청 기록이 없습니다.'}</p></div>
              <div className="excerpt"><span>마지막 답변</span><p>{active.latestReply || '아직 답변 기록이 없습니다.'}</p></div></>}
            <button className="ai-button" disabled={!!aiBusy || !data?.aiAvailable} onClick={() => setConfirmAI(true)}>{aiBusy === active.id ? <LoaderCircle size={14} className="spin"/> : <Sparkles size={14}/>} {aiBusy === active.id ? '요약하는 중…' : activeState.ai ? 'AI로 다시 정리' : 'AI로 요약 · 이름 추천'}<span>↗</span></button>
            {!data?.aiAvailable && <p className="help-text">Claude Code CLI를 설치하면 AI 요약을 사용할 수 있어요.</p>}
          </section>
          {activeState.ai && <div className="next-action"><div><Circle size={14}/><strong>다음에 할 일</strong></div><p>{activeState.ai.nextAction}</p></div>}
          <section className="title-suggestion"><div className="section-title"><h4>이름 추천</h4><span className="subtle-tag">{activeState.ai ? 'AI 추천' : '첫 요청에서'}</span></div><p>{activeState.ai?.title || active.suggestedTitle}</p><button onClick={() => startRename(active, true)}><Pencil size={12}/> 이 이름으로 변경<ChevronRight size={13}/></button></section>
          <section className="note-section"><div className="section-title"><h4>내가 이어 할 일</h4><span className="muted">입력 후 포커스를 옮기면 저장</span></div><textarea key={`${active.id}-note`} defaultValue={activeState.note || ''} maxLength={6000} onBlur={e => { if (e.target.value !== (activeState.note || '')) update(active.id, { note: e.target.value }) }} placeholder="다음에 돌아왔을 때 기억할 내용을 적어두세요."/></section>
          <details className="conversation" data-agent={active.agent}><summary>대화 기록 보기 <span>{active.messages.length}개 발췌</span></summary>{active.messages.map((m, i) => <div key={i} className={`message ${m.role}`}><strong>{m.role === 'user' ? '나' : active.agent === 'claude' ? 'Claude' : 'Codex'}</strong><p>{m.text}</p></div>)}</details>
          <p className="detail-footnote">{active.orcaHandle ? '연결된 Orca 탭으로 이동합니다.' : active.cwdMissing ? '대화를 실행하던 워크스페이스 폴더가 삭제돼서 이어갈 수 없어요. 대화 기록은 그대로 볼 수 있어요.' : active.orcaWorktree ? 'Orca 워크스페이스에 새 탭을 열고 같은 세션을 재개합니다.' : 'Orca에 등록되지 않은 폴더라 Terminal에서 같은 세션을 재개합니다.'}<br/>작업 중 표시는 Claude 실행 상태와 Codex 작업 기록으로 15초마다 확인해요.</p>
        </div>
      </> : <div className="empty-detail"><Activity size={30}/><h3>한 번에 하나씩, 이어가세요.</h3><p>대화를 선택하면 진행 내용과<br/>다음 할 일을 확인할 수 있어요.</p></div>}</aside></div>
    </main>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role="status">{toast.error ? <Circle size={16}/> : <Check size={16}/>}<span>{toast.text}</span><button onClick={() => setToast(null)}><X size={14}/></button></div>}
    {showSettings && <div className="modal-backdrop" onClick={() => setShowSettings(false)}><div className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={e => e.stopPropagation()}><div className="settings-heading"><div><span className="eyebrow">PREFERENCES</span><h2 id="settings-title">설정</h2></div><button className="icon-button" aria-label="설정 닫기" onClick={() => setShowSettings(false)}><X size={19}/></button></div>
      <section className="settings-section"><h3>화면 테마</h3><p>시스템 설정을 따르면 macOS 테마 변경에 맞춰 자동으로 바뀝니다.</p><div className="theme-options">{([['system','시스템 설정 따르기',Monitor],['light','라이트',Sun],['dark','다크',Moon]] as const).map(([value,label,Icon]) => <button key={value} aria-pressed={(data?.settings.theme || 'system') === value} className={(data?.settings.theme || 'system') === value ? 'selected' : ''} disabled={settingsBusy} onClick={() => changeSettings({ theme: value })}><Icon size={21}/><span>{label}</span>{(data?.settings.theme || 'system') === value && <Check size={13}/>}</button>)}</div></section>
      <section className="settings-section setting-row"><div><h3 id="pinned-first-label">이어 할 일 먼저 보기</h3><p>핀으로 고정한 대화를 목록 맨 위에 모아요. 끄면 고른 정렬 기준만 적용해요.</p></div><button className="switch" role="switch" aria-checked={pinnedFirst} aria-labelledby="pinned-first-label" disabled={settingsBusy} onClick={() => changeSettings({ pinnedFirst: !pinnedFirst })}><span/></button></section>
      <section className="settings-section"><h3>프로젝트 상위 폴더</h3><p>바로 아래 폴더를 하나의 프로젝트로 묶습니다. 예: <code>workspace/my-app/src</code> → <code>my-app</code><br/>Orca·Git 워크트리는 원래 프로젝트와 함께 표시합니다.</p><div className="workspace-roots">{data?.settings.workspaceRoots.map(root => <div className="workspace-root" key={root}><Folder size={16}/><span title={root}>{shortPath(root)}</span><button className="icon-button" aria-label={`${root} 제거`} disabled={settingsBusy} onClick={() => changeSettings({ workspaceRoots: data.settings.workspaceRoots.filter(p => p !== root) })}><X size={15}/></button></div>)}</div><button className="button secondary" disabled={settingsBusy} onClick={addWorkspace}><Plus size={14}/> 상위 폴더 추가</button></section>
      <div className="settings-footer"><span>변경 사항은 자동으로 저장됩니다.</span><button className="button primary" onClick={() => setShowSettings(false)}>완료</button></div>
    </div></div>}
    {rename && <div className="modal-backdrop" onClick={() => !actionBusy && setRename(null)}><form className="modal" onClick={e => e.stopPropagation()} onSubmit={e => { e.preventDefault(); saveRename() }}><span className="modal-symbol"><Pencil size={21}/></span><h2>알아보기 쉬운 이름으로</h2><p>이름을 바꿔도 세션과 대화 기록은 그대로 유지됩니다.</p><label className="field-label" htmlFor="session-title">세션 이름</label><input id="session-title" className="title-input" autoFocus value={newTitle} maxLength={180} onChange={e => setNewTitle(e.target.value)}/><label className="checkbox-label"><input type="checkbox" checked={alsoOrca} onChange={e => setAlsoOrca(e.target.checked)}/> {rename.agent === 'claude' ? 'Claude Code' : 'Codex'} 원본 세션{rename.orcaHandle ? '과 Orca 탭' : ''}에도 적용</label><p className="help-text">원본 이름은 대화 목록을 새로 열거나 세션을 재개할 때 반영될 수 있어요.</p><div className="modal-actions"><button type="button" className="button secondary" onClick={() => setRename(null)}>취소</button><button className="button primary" disabled={!newTitle.trim() || actionBusy}>{actionBusy ? '변경 중…' : '이름 변경'}</button></div></form></div>}
    {confirmAI && <div className="modal-backdrop" onClick={() => setConfirmAI(false)}><div className="modal" onClick={e => e.stopPropagation()}><span className="modal-symbol"><Sparkles size={22}/></span><h2>이 대화를 AI로 정리할까요?</h2><p>선택한 세션의 최근 대화 최대 12개를 Claude Code로 보내 작업 요약, 다음 할 일, 이름 추천을 만듭니다.</p><div className="info-block">기존 Claude Code 로그인과 사용 한도를 사용합니다. 코딩 도구는 비활성화하고, 대화 안의 지시는 인용문으로 취급합니다.</div><div className="modal-actions"><button className="button secondary" onClick={() => setConfirmAI(false)}>취소</button><button className="button primary" onClick={summarize}><Sparkles size={14}/> 요약하기</button></div></div></div>}
    {showInfo && <div className="modal-backdrop" onClick={() => setShowInfo(false)}><div className="modal" onClick={e => e.stopPropagation()}><span className="modal-symbol"><ShieldCheck size={22}/></span><h2>내 작업을 모으는 작은 작업대</h2><p>Claude Code와 Codex의 로컬 대화 기록을 읽고, 디렉토리별로 정리합니다. Orca에서 사용한 대화는 별도 세션으로 중복 표시하지 않습니다.</p><div className="info-block">• 15초마다 갱신하며, 최근 세션 최대 500개를 표시합니다.<br/>• 기본 화면은 요청과 답변의 로컬 발췌입니다.<br/>• AI 요약을 누른 세션만 Claude로 전송합니다.<br/>• 핀·메모·완료·표시 이름은 에이두에 따로 저장합니다.<br/>• 창을 닫아도 메뉴바에서 다시 열 수 있습니다.</div><div className="modal-actions"><button className="button primary" onClick={() => setShowInfo(false)}>확인</button></div></div></div>}
  </div>
}
function errorMessage(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(/^Error invoking remote method '[^']+': Error: /, '')
}
createRoot(document.getElementById('root')!).render(<App/>)
