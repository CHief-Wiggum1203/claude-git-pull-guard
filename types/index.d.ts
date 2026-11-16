/** A repository whose branch is behind its upstream and was not pulled by itself. */
export type Behind = {
  root: string
  branch: string
  upstream: string
  /** Commits on the upstream the branch lacks. */
  behind: number
  /** Commits on the branch the upstream lacks. */
  ahead: number
  /** Changes to tracked files not committed yet. */
  isDirty: boolean
  /** What the last press of "Jetzt pullen" answered, when it failed. */
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'git-pull-guard': { behind: Shaped<Behind | null> }
  }
}
