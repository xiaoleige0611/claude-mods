import type { Register } from 'claude-code'

// 回答短于这个字数就不总结
const MIN_CHARS = 600
// 送去总结的回答上限，避免超长回答把成本拉高
const MAX_CHARS = 20_000

const SYSTEM =
  '你负责给 AI 助手的回答写 TL;DR。用一句简体中文概括回答的结论或下一步，不超过 50 个字。只输出这一句，不要前缀、引号或解释。'

export const register: Register = on => {
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId || e.reason !== 'answer' || e.answer.length < MIN_CHARS) return done

    // 只把回答本身发给 Haiku：成本与上下文长短无关，也更快
    const r = await $.model.complete({
      model: 'haiku',
      system: SYSTEM,
      prompt: `<answer>\n${e.answer.slice(0, MAX_CHARS)}\n</answer>`,
      maxTokens: 200,
      timeoutMs: 10_000,
    })
    const line = r.isAnswered ? r.text.split('\n').map(s => s.trim()).find(Boolean) : undefined
    if (!line) return done

    return { ...done, text: `TL;DR：${line}` }
  })
}
