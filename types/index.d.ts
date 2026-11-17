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

/** A branch up to date with its upstream but holding commits not pushed yet. */
export type Unpushed = {
  root: string
  branch: string
  upstream: string
  ahead: number
}

/** A repository Claude began changing while on a protected branch such as main. */
export type OnProtected = {
  root: string
  branch: string
}

declare module 'claude-code' {
  interface PluginState {
    'git-pull-guard': { behind: Shaped<Behind | null>; unpushed: Shaped<Unpushed | null>; onProtected: Shaped<OnProtected | null> }
  }
}
