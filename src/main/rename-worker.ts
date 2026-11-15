import { renameSession } from '@anthropic-ai/claude-agent-sdk/core'
async function main() {
  const [id, title] = process.argv.slice(2)
  await renameSession(id, title)
  process.stdout.write('ok')
}
main().catch(() => { process.stderr.write('Claude Code 세션 이름 변경에 실패했습니다.'); process.exitCode = 1 })
