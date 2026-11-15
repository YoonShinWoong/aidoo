import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { containsPath, resolveProject } from '../src/main/projects'
import { parseRecords } from '../src/main/collector'

test('subdirectories share the first project folder under the configured workspace', async () => {
  assert.equal(await resolveProject('/work/my-app/src/components', ['/work']), '/work/my-app')
  assert.equal(await resolveProject('/work/my-app/.claude/worktrees/fix', ['/work']), '/work/my-app')
  assert.equal(await resolveProject('/work/other-app/tests', ['/work']), '/work/other-app')
  assert.equal(await resolveProject('/work', ['/work']), '/work')
})
test('path membership respects directory boundaries and nested workspace roots', async () => {
  assert.equal(containsPath('/work/app', '/work/app-extra'), false)
  assert.equal(containsPath('/work/app', '/work/app/src'), true)
  assert.equal(await resolveProject('/work/team/app/src', ['/work', '/work/team']), '/work/team/app')
})
test('Orca worktrees resolve to the original registered project with descendants included', async () => {
  const aliases = [{ workspacePath: '/orca/workspaces/project/angelshark', projectPath: '/work/project' }]
  assert.equal(await resolveProject('/orca/workspaces/project/angelshark/src', ['/work'], aliases), '/work/project')
  assert.equal(await resolveProject('/orca/workspaces/project/angelshark-extra', [], aliases), '/orca/workspaces/project/angelshark-extra')
})
test('Git worktrees outside Orca also resolve to their common repository', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'aidoo-project-'))
  try {
    const repo = path.join(dir, 'workspace/project')
    const worktree = path.join(dir, 'workspace/project-fix')
    const gitdir = path.join(repo, '.git/worktrees/fix')
    await mkdir(gitdir, { recursive: true })
    await mkdir(path.join(worktree, 'src'), { recursive: true })
    await writeFile(path.join(gitdir, 'commondir'), '../..\n')
    await writeFile(path.join(worktree, '.git'), `gitdir: ${gitdir}\n`)
    assert.equal(await resolveProject(path.join(worktree, 'src'), [path.join(dir, 'workspace')]), repo)
    assert.equal(await resolveProject(path.join(repo, 'nested'), []), repo)
  } finally { await rm(dir, { recursive: true }) }
})
test('Claude records changing cwd do not move the session to its last visited subfolder', () => {
  const rows = [
    { type: 'user', cwd: '/work/project', message: { content: '작업 시작' } },
    { type: 'assistant', cwd: '/work/project/src/internal', message: { content: '수정 완료' } }
  ]
  assert.equal(parseRecords(rows.map(r => JSON.stringify(r)), 'claude').cwd, '/work/project')
})
