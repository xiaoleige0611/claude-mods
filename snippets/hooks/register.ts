import type { EngineInterface, Register } from 'claude-code'

export type Snippet = { description?: string; text: string }
export type Snippets = Record<string, Snippet>

const file = ($: EngineInterface) => `${$.plugin.root}/snippets.json`

// 每次现读：改完 snippets.json 立即生效，不用重载
const load = async ($: EngineInterface): Promise<Snippets> => JSON.parse(await $.fs.read(file($)))

const firstLine = (text: string) => text.split('\n')[0] ?? ''

export const match = (all: Snippets, token: string) => {
  const prefix = token.slice(1).toLowerCase()
  return Object.entries(all)
    .filter(([name, s]) => name.toLowerCase().startsWith(prefix) && typeof s?.text === 'string' && s.text)
    .map(([name, s]) => ({ text: s.text, label: `#${name}`, description: s.description ?? firstLine(s.text) }))
}

export const listText = (all: Snippets, path: string) => {
  const rows = Object.entries(all).map(([name, s]) => `- \`#${name}\` ${s.description ?? firstLine(s.text)}`)
  return [`共 ${rows.length} 个片段，输入 # 加名字即可补全：`, '', ...rows, '', `编辑片段：${path}`].join('\n')
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'snippets', description: '列出所有提示词片段' })

    return next(e)
  })

  on('command.run', { command: 'snippets' }, async $ => {
    try {
      return { text: listText(await load($), file($)) }
    } catch (err) {
      return { text: `读取 ${file($)} 失败：${err instanceof Error ? err.message : String(err)}` }
    }
  })

  on('prompt.autocomplete', { token: /^#/ }, async ($, e, next) => {
    const { suggestions } = await next(e)
    // 文件缺失或 JSON 写错时不出候选，不影响打字
    const all = await load($).catch(() => ({}))

    return { suggestions: [...suggestions, ...match(all, e.token)] }
  })
}
