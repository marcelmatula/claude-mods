export type Limit = { kind: string; percentUsed: number; resetsAt?: string }

declare module 'claude-code' {
  interface PluginState {
    'limits-meter': { limits: Limit[]; isHidden: boolean; time: number }
  }
}
