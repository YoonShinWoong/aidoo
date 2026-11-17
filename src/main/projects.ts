import path from 'node:path'
import { promises as fs } from 'node:fs'

export interface ProjectAlias { workspacePath: string; projectPath: string }
export function containsPath(parent: string, child: string) {
  const relative = path.relative(path.resolve(parent), path.resolve(child))
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

// Resolve a working directory to a stable project directory, never to an arbitrary descendant.
export async function resolveProject(cwd: string, workspaceRoots: string[], aliases: ProjectAlias[] = []): Promise<string> {
  const directory = path.resolve(cwd)
  const alias = aliases.filter(a => containsPath(a.workspacePath, directory))
    .sort((a, b) => b.workspacePath.length - a.workspacePath.length)[0]
  if (alias) return path.resolve(alias.projectPath)
  if (!(await fs.stat(directory).catch(() => null))) {
    // A deleted Orca workspace no longer has an alias, but its siblings still name the project.
    const siblings = new Set(aliases.filter(a => path.resolve(a.workspacePath) !== path.resolve(a.projectPath) &&
      containsPath(path.dirname(path.resolve(a.workspacePath)), directory)).map(a => path.resolve(a.projectPath)))
    if (siblings.size === 1) return [...siblings][0]
  }

  const root = workspaceRoots.map(p => path.resolve(p)).filter(p => containsPath(p, directory))
    .sort((a, b) => b.length - a.length)[0]
  const first = root ? path.relative(root, directory).split(path.sep)[0] : ''
  const workspaceProject = root ? (first ? path.join(root, first) : root) : ''

  // Git's .git marker also works for subdirectories and linked worktrees.
  let current = directory
  while (current !== path.dirname(current)) {
    try {
      const marker = path.join(current, '.git')
      const stat = await fs.stat(marker)
      if (stat.isDirectory()) return workspaceProject || current
      if (stat.isFile()) {
        const content = await fs.readFile(marker, 'utf8')
        const match = content.match(/^gitdir:\s*(.+)\s*$/)
        if (match) {
          const gitDir = path.resolve(current, match[1].trim())
          try {
            const common = (await fs.readFile(path.join(gitDir, 'commondir'), 'utf8')).trim()
            const commonDir = path.resolve(gitDir, common)
            if (path.basename(commonDir) === '.git') return path.dirname(commonDir)
          } catch { /* ordinary gitfile (for example a submodule) */ }
        }
        return workspaceProject || current
      }
    } catch { /* no Git marker here; keep walking */ }
    current = path.dirname(current)
  }
  // Don't guess at a parent for unrelated folders outside configured workspaces.
  return workspaceProject || directory
}
