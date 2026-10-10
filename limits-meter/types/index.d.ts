export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// A session's figures as saved for the others: `at` is when its engine got them.
export type Reading = { at: number; limits: Limit[] }

declare module 'claude-code' {
  interface PluginState {
    'limits-meter': { limits: Limit[]; isHidden: boolean; time: number; measuredAt: number }
  }
}
