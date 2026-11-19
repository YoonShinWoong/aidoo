import { contextBridge, ipcRenderer } from 'electron'
import type { AidooAPI } from '../shared/types'
const api: AidooAPI = {
  scan: () => ipcRenderer.invoke('scan'),
  update: (id, patch) => ipcRenderer.invoke('update', id, patch),
  openSession: id => ipcRenderer.invoke('open-session', id),
  renameOrca: (id, title) => ipcRenderer.invoke('rename-orca', id, title),
  closeOrca: id => ipcRenderer.invoke('close-orca', id),
  renameSession: (id, title, sync) => ipcRenderer.invoke('rename-session', id, title, sync),
  listNotes: () => ipcRenderer.invoke('notes-list'),
  saveNote: note => ipcRenderer.invoke('notes-save', note),
  deleteNote: id => ipcRenderer.invoke('notes-delete', id),
  showFolder: id => ipcRenderer.invoke('show-folder', id),
  copyResume: id => ipcRenderer.invoke('copy-resume', id),
  summarize: id => ipcRenderer.invoke('summarize', id),
  updateSettings: patch => ipcRenderer.invoke('update-settings', patch),
  chooseWorkspace: () => ipcRenderer.invoke('choose-workspace'),
  onOpenSettings: callback => {
    const handler = () => callback()
    ipcRenderer.on('open-settings', handler)
    return () => ipcRenderer.removeListener('open-settings', handler)
  }
}
contextBridge.exposeInMainWorld('aidoo', api)
