import type { Register } from 'claude-code'

type Verdict = { deny: string } | { ask: string } | null

// rm -r 的目标是这些时直接拒绝：删掉就回不来
const ROOTS = new Set(['/', '/*', '~', '~/', '~/*', '$HOME', '$HOME/', '$HOME/*', '${HOME}'])
// 目标是当前/上级目录整体时先确认
const BROAD = new Set(['*', '.', './', './*', '..', '../', '../*'])

const PROD_CONFIG = /(^|\/)(application|bootstrap)-prod[^/]*\.(ya?ml|properties)$|(^|\/)\.env\.prod(uction)?$/
const SQL_DROP = /\b(drop\s+(table|database|schema)|truncate\s+table)\b/i
const SQL_DELETE_ALL = /\bdelete\s+from\s+[\w.`"]+\s*(;|$|["'])/i

const checkRm = (tokens: string[]): Verdict => {
  const args = tokens[0] === 'sudo' ? tokens.slice(1) : tokens
  if (args[0] !== 'rm') return null
  const flags = args.filter(a => a.startsWith('-'))
  const isRecursive = flags.some(f => f === '--recursive' || (!f.startsWith('--') && /[rR]/.test(f)))
  if (!isRecursive) return null
  const targets = args.slice(1).filter(a => !a.startsWith('-')).map(a => a.replace(/^["']|["']$/g, ''))
  const root = targets.find(t => ROOTS.has(t))
  if (root) return { deny: `command-guard：禁止递归删除 ${root}，这会清空整个系统或主目录。` }
  const broad = targets.find(t => BROAD.has(t))
  if (broad) return { ask: `command-guard：将递归删除 ${broad}（当前或上级目录的全部内容），确认执行吗？` }
  return null
}

const checkGit = (tokens: string[]): Verdict => {
  if (tokens[0] !== 'git') return null
  const [, sub, ...rest] = tokens
  if (sub === 'push' && rest.some(a => a === '--force' || /^-[a-zA-Z]*f/.test(a) || a.startsWith('+'))) {
    return { ask: 'command-guard：强制推送会覆盖远端历史（更安全的做法是 --force-with-lease），确认执行吗？' }
  }
  if (sub === 'reset' && rest.includes('--hard')) {
    return { ask: 'command-guard：git reset --hard 会丢弃所有未提交的改动，确认执行吗？' }
  }
  if (sub === 'clean' && rest.some(a => /^-[a-zA-Z]*f/.test(a))) {
    return { ask: 'command-guard：git clean -f 会删除未跟踪的文件，确认执行吗？' }
  }
  if ((sub === 'checkout' || sub === 'restore') && rest.includes('.') && !rest.includes('--staged')) {
    return { ask: `command-guard：git ${sub} . 会丢弃工作区的全部改动，确认执行吗？` }
  }
  return null
}

export const checkCommand = (command: string): Verdict => {
  if (SQL_DROP.test(command)) return { ask: 'command-guard：命令包含 DROP / TRUNCATE，会删除表或数据库，确认执行吗？' }
  if (SQL_DELETE_ALL.test(command)) return { ask: 'command-guard：DELETE 语句没有 WHERE 条件，会清空整张表，确认执行吗？' }
  // 按 ; && || | 拆成子命令逐个检查
  for (const part of command.split(/;|&&|\|\||\||\n/)) {
    const tokens = part.trim().split(/\s+/).filter(Boolean)
    const verdict = checkRm(tokens) ?? checkGit(tokens)
    if (verdict) return verdict
  }
  return null
}

export const checkFile = (path: string): Verdict =>
  PROD_CONFIG.test(path) ? { ask: `command-guard：${path} 是生产环境配置，确认修改吗？` } : null

export const register: Register = on => {
  on('classic.PreToolUse', ($, e, next) => {
    let verdict: Verdict = null
    if (e.tool === 'Bash') {
      verdict = checkCommand(e.command)
    } else if (e.tool === 'Edit' || e.tool === 'Write') {
      verdict = checkFile(e.file_path)
    } else if (e.tool === 'NotebookEdit') {
      verdict = checkFile(e.notebook_path)
    }

    return verdict ?? next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { ask: 'command-guard：检查出错，请人工确认这次调用。' }))
}
