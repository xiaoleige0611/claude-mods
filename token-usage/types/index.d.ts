export type Tokens = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
}

export type Limit = {
  kind: string
  percentUsed: number
  resetsAt?: string
  // 按消耗速度推算的耗尽时刻（毫秒）；样本不足时为空
  etaAt?: number
}

export type Meter = {
  context: { tokens?: number; window: number; percent?: number }
  rateLimits: Limit[]
  usd?: number
}

// 每个限额窗口的速度基准：本窗口第一次读到的占用和时刻
export type LimitBase = { resetsAt?: string; percentUsed: number; at: number }

export type TurnSample = { output: number; ms: number }

export type Slice = { name: string; tokens: number; kind: string }

declare module 'claude-code' {
  interface PluginState {
    'token-usage': {
      total: Tokens
      last: Tokens | null
      model: string
      meter: Meter | null
      turnLog: TurnSample[]
      tools: Record<string, number>
      skills: Record<string, number>
      // 上一轮主线程结束后至今用到的技能；主线程一轮结束时转入 lastSkills
      pendingSkills: string[]
      lastSkills: string[]
      limitBase: Record<string, LimitBase>
      breakdown: Slice[] | null
      isWarned: boolean
    }
  }
}
