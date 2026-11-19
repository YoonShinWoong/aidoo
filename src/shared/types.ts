export type Agent = 'claude' | 'codex'
export interface Message { role: 'user' | 'assistant'; text: string; timestamp: string }
export interface Session {
  id: string; sessionId: string; agent: Agent; cwd: string; projectPath: string;
  originalTitle: string; suggestedTitle: string; goal: string;
  latestRequest: string; latestReply: string; messages: Message[];
  updatedAt: number; status: 'working' | 'reply' | 'stalled' | 'recent' | 'idle'; sourcePath: string;
  codexHome: string; orcaHandle: string; inOrca: boolean; orcaWorktree: string; cwdMissing: boolean;
}
export interface AiSummary { title: string; summary: string; nextAction: string; updatedAt: number }
export interface SessionState { title?: string; pinned?: boolean; done?: boolean; note?: string; ai?: AiSummary }
export interface Note { id: string; title: string; body: string; updatedAt: number }
export interface RenameResult { state: SessionState; sourceUpdated: boolean; orcaUpdated: boolean; warnings: string[] }
export interface Settings { theme: 'system' | 'light' | 'dark'; workspaceRoots: string[]; pinnedFirst: boolean }
export interface Snapshot {
  sessions: Session[]; warnings: string[]; scannedAt: number;
  state: Record<string, SessionState>; aiAvailable: boolean; settings: Settings;
}
export interface AidooAPI {
  scan(): Promise<Snapshot>;
  update(id: string, patch: Partial<SessionState>): Promise<SessionState>;
  openSession(id: string): Promise<void>;
  renameOrca(id: string, title: string): Promise<void>;
  renameSession(id: string, title: string, sync: boolean): Promise<RenameResult>;
  listNotes(): Promise<Note[]>;
  saveNote(note: Note): Promise<Note>;
  deleteNote(id: string): Promise<void>;
  showFolder(id: string): Promise<void>;
  copyResume(id: string): Promise<void>;
  summarize(id: string): Promise<AiSummary>;
  updateSettings(patch: Partial<Settings>): Promise<Settings>;
  chooseWorkspace(): Promise<string | null>;
  onOpenSettings(callback: () => void): () => void;
}
declare global { interface Window { aidoo: AidooAPI } }
