import { useEffect, useRef, useState } from 'react'
import { FileText, Plus, Search, Trash2, Check, LoaderCircle } from 'lucide-react'
import type { Note } from '../../shared/types'
import { Resizer, usePaneWidth } from './Resizer'

export function Notes({ active }: { active: boolean }) {
  const list = usePaneWidth('notes')
  const [notes, setNotes] = useState<Note[]>([])
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('저장됨')
  const [error, setError] = useState('')
  const [deleting, setDeleting] = useState(false)
  const pending = useRef(new Map<string, Note>())
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const queue = useRef(Promise.resolve())
  const current = notes.find(n => n.id === selected)
  const filtered = notes.filter(n => `${n.title}\n${n.body}`.toLowerCase().includes(query.toLowerCase()))
  useEffect(() => {
    window.aidoo.listNotes().then(list => { setNotes(list); setSelected(list[0]?.id || '') }).catch(() => setError('메모를 불러오지 못했습니다.'))
  }, [])
  function flush() {
    if (timer.current) clearTimeout(timer.current)
    const batch = [...pending.current.values()]; pending.current.clear()
    queue.current = queue.current.then(async () => {
      for (const note of batch) {
        try { await window.aidoo.saveNote(note) }
        catch { if (!pending.current.has(note.id)) pending.current.set(note.id, note); setError('저장하지 못했습니다. 다시 저장을 눌러 주세요.'); return }
      }
      if (!pending.current.size) { setStatus('저장됨'); setError('') }
    })
    return queue.current
  }
  useEffect(() => {
    const handler = () => { void flush() }
    window.addEventListener('blur', handler)
    window.addEventListener('beforeunload', handler)
    return () => { window.removeEventListener('blur', handler); window.removeEventListener('beforeunload', handler) }
  }, [])
  function edit(patch: Partial<Note>) {
    if (!current) return
    const next = { ...current, ...patch, updatedAt: Date.now() }
    setNotes(list => list.map(n => n.id === next.id ? next : n))
    pending.current.set(next.id, next); setStatus('저장 중…')
    if (timer.current) clearTimeout(timer.current)
    void flush()
  }
  async function create() {
    await flush()
    const note = { id: crypto.randomUUID(), title: '', body: '', updatedAt: Date.now() }
    try { await window.aidoo.saveNote(note); setNotes(list => [note, ...list]); setSelected(note.id); setQuery('') }
    catch { setError('새 메모를 만들지 못했습니다.') }
  }
  async function remove() {
    if (!current) return
    const id = current.id
    await flush()
    try {
      await window.aidoo.deleteNote(id)
      pending.current.delete(id)
      setNotes(list => list.filter(n => n.id !== id)); setSelected(''); setDeleting(false)
    } catch { setError('메모를 삭제하지 못했습니다.') }
  }
  return <main className="workspace notes-workspace" hidden={!active}>
    <header className="topbar"><div className="breadcrumb"><FileText size={16}/><strong>메모장</strong></div><span className="live">내 맥에 자동 저장</span></header>
    <div className="page-intro"><div><div className="eyebrow">YOUR NOTES</div><h1>메모장</h1><p>작업 아이디어, 체크할 일, 잊고 싶지 않은 내용.</p></div><button className="button primary" onClick={create}><Plus size={16}/> 새 메모</button></div>
    {error && <div className="warning notes-error" role="alert">{error}<button onClick={flush}>다시 저장</button></div>}
    <div className="notes-body"><aside className="notes-list" ref={list.ref} style={list.style}><div className="search-box"><Search size={15}/><input aria-label="메모 검색" placeholder="메모 검색" value={query} onChange={e => setQuery(e.target.value)}/></div>
      <div className="notes-scroll">{filtered.map(n => <button className={`note-card ${selected === n.id ? 'selected' : ''}`} key={n.id} onClick={() => { void flush(); setSelected(n.id) }}><strong>{n.title.trim() || '제목 없는 메모'}</strong><p>{n.body || '내용을 적어보세요.'}</p><time>{new Date(n.updatedAt).toLocaleString('ko-KR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></button>)}{!filtered.length && <p className="notes-hint">{query ? '검색 결과가 없어요.' : '새 메모를 만들어보세요.'}</p>}</div></aside>
      <Resizer pane={list} edge="end" min={220} max={520} label="메모 목록 너비"/>
      {current ? <section className="note-editor" data-flex-min="320"><div className="note-toolbar"><span role="status">{status === '저장됨' ? <Check size={14}/> : <LoaderCircle className="spin" size={14}/>} {status}</span><button className="icon-button" title="메모 삭제" onClick={() => setDeleting(true)}><Trash2 size={16}/></button></div>
        <input className="note-title" aria-label="메모 제목" placeholder="제목 없는 메모" maxLength={180} value={current.title} onChange={e => edit({ title: e.target.value })} onBlur={flush}/>
        <textarea className="note-body" aria-label="메모 내용" placeholder="자유롭게 적어보세요…" maxLength={100000} value={current.body} onChange={e => edit({ body: e.target.value })} onBlur={flush}/>
        <div className="note-footer">{current.body.length.toLocaleString()}자 · 로컬에만 저장됩니다.</div>
      </section> : <div className="empty-detail notes-empty" data-flex-min="320"><FileText size={30}/><h3>생각을 적어둘 공간</h3><p>메모를 선택하거나 새로 만들어보세요.</p><button className="button primary" onClick={create}><Plus size={16}/> 메모 작성하기</button></div>}
    </div>
    {deleting && <div className="modal-backdrop"><div className="modal"><h2>이 메모를 삭제할까요?</h2><p>{current?.title || '제목 없는 메모'}</p><div className="modal-actions"><button className="button secondary" onClick={() => setDeleting(false)}>취소</button><button className="button primary" onClick={remove}>삭제</button></div></div></div>}
  </main>
}
