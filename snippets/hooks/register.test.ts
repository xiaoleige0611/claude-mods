import type { PromptAutocompleteInput, PromptAutocompleteResult } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { listText } from './register'

const SNIPPETS = {
  cr: { description: '代码评审', text: '按规约评审当前改动。' },
  commit: { text: '写提交信息。\n第二行' },
  test: { description: '补单元测试', text: '补测试。' },
}

const typed = (token: string) => ({ text: `请 ${token}`, cursor: 2 + token.length, token, start: 2 })

test('# offers the snippets whose name starts with what was typed', async ($, on) => {
  // 测试 $ 的类型未声明 prompt.autocomplete，运行时可用
  const complete = ($ as unknown as { prompt: { autocomplete: (e: PromptAutocompleteInput) => Promise<PromptAutocompleteResult> } }).prompt.autocomplete
  let file = JSON.stringify(SNIPPETS)
  const read: string[] = []
  on('fs.read', (_, e) => (read.push(e.path), { value: file }))
  on('prompt.autocomplete', () => ({ suggestions: [] }))

  const c = await complete(typed('#C'))
  expect(c.suggestions).toEqual([
    { text: '按规约评审当前改动。', label: '#cr', description: '代码评审' },
    { text: '写提交信息。\n第二行', label: '#commit', description: '写提交信息。' },
  ])
  expect(read[0]).toMatch(/snippets\.json$/)

  expect((await complete(typed('#'))).suggestions.length).toBe(3)
  expect((await complete(typed('#zz'))).suggestions).toEqual([])

  // 文件写坏了也不报错，只是没有候选
  file = '{ broken'
  expect((await complete(typed('#c'))).suggestions).toEqual([])
})

test('/snippets lists every snippet and where to edit them', () => {
  const text = listText(SNIPPETS, '/mods/snippets/snippets.json')
  expect(text).toContain('共 3 个片段')
  expect(text).toContain('- `#cr` 代码评审')
  expect(text).toContain('- `#commit` 写提交信息。')
  expect(text).toContain('编辑片段：/mods/snippets/snippets.json')
})
