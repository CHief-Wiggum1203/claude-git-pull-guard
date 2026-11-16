import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Behind } from '../types'

// Change the tag when Behind's fields change: it declines what an earlier
// version stored, which outlives a reload.
const behind = atom({ plugin: 'git-pull-guard', key: 'behind' } as const, null, {
  shape: 'behind-1',
})
const unpushed = atom({ plugin: 'git-pull-guard', key: 'unpushed' } as const, null, {
  shape: 'unpushed-1',
})

// Git never stops to ask for a password: a fetch that needs one fails instead.
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0' }

// A Bash command that pushes: `git push`, also after `git -C dir` or other flags.
const PUSH = /\bgit\b(?:\s+-\S+(?:\s+\S+)?)*?\s+push\b/

/** What the person set in the mod's options. */
type Settings = { autoPull: boolean; ignore: string[] }

type Git = (args: string[], timeoutMs?: number) => Promise<{ isOk: boolean; out: string }>

function gitIn($: EngineInterface, cwd: string): Git {
  return async (args, timeoutMs = 10_000) => {
    try {
      const ran = await $.process.run(['git', ...args], { cwd, env: GIT_ENV, timeoutMs })
      return { isOk: ran.exitCode === 0, out: (ran.exitCode === 0 ? ran.stdout : ran.stderr).trim() }
    } catch (error) {
      // git missing, or the fetch outlasted its time.
      return { isOk: false, out: String(error) }
    }
  }
}

const commits = (n: number) => (n === 1 ? '1 Commit' : `${n} Commits`)

/**
 * The repository's root, branch and upstream, or undefined where there is
 * nothing to sync: no repository, the home folder's, one the person set
 * aside, a detached HEAD, or a branch with no upstream.
 */
async function branchOf($: EngineInterface, git: Git, settings: Settings) {
  const root = await git(['rev-parse', '--show-toplevel'])
  const home = await $.env.get('HOME')
  // The home folder can be a repository of its own: no project to sync.
  if (!root.isOk || root.out === home) return undefined
  const name = root.out.split('/').pop() ?? root.out
  const isIgnored = settings.ignore.some(
    entry => entry === name || entry === root.out || (entry.startsWith('~/') && `${home}${entry.slice(1)}` === root.out),
  )
  if (isIgnored) return undefined

  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!branch.isOk || branch.out === 'HEAD' || !upstream.isOk) return undefined

  return { root: root.out, branch: branch.out, upstream: upstream.out }
}

/**
 * Fetches the branch's upstream and, when it is behind, pulls by itself
 * where that cannot touch the person's work (a clean tree and no commits of
 * its own: a fast-forward) and the person left that on; else it records what
 * stands in the way.
 */
async function check($: EngineInterface, cwd: string, settings: Settings) {
  const git = gitIn($, cwd)
  const at = await branchOf($, git, settings)
  if (at === undefined) return
  if (!(await git(['fetch', '--quiet'], 20_000)).isOk) return

  const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
  const [ahead = 0, lag = 0] = counts.out.split(/\s+/).map(Number)
  if (!counts.isOk) return
  if (lag === 0) {
    await update($, behind, () => null)
    await update($, unpushed, () => (ahead > 0 ? { ...at, ahead } : null))
    return
  }

  const status = await git(['status', '--porcelain', '--untracked-files=no'])
  const isDirty = !status.isOk || status.out !== ''

  if (settings.autoPull && !isDirty && ahead === 0 && (await git(['merge', '--ff-only', '--quiet', '@{u}'])).isOk) {
    await update($, behind, () => null)
    $.ui.toast(`↓ ${commits(lag)} auf ${at.branch} geholt (${at.upstream})`)
    return
  }

  await update($, unpushed, () => null)
  await update($, behind, () => ({ ...at, behind: lag, ahead, isDirty, error: null }))
}

/** Counts the commits not pushed yet, with no fetch: cheap after every answer. */
async function countUnpushed($: EngineInterface, cwd: string, settings: Settings) {
  const git = gitIn($, cwd)
  const at = await branchOf($, git, settings)
  if (at === undefined || (await read($, behind)) !== null) return
  const count = await git(['rev-list', '--count', '@{u}..HEAD'])
  const ahead = count.isOk ? Number(count.out) : 0
  await update($, unpushed, () => (ahead > 0 ? { ...at, ahead } : null))
}

function contextText(b: Behind) {
  const why = [
    b.isDirty ? 'es gibt nicht committete Änderungen' : '',
    b.ahead > 0 ? `der Branch hat ${commits(b.ahead)}, die origin nicht hat` : '',
  ].filter(part => part !== '')
  return [
    `Der Branch ${b.branch} in ${b.root} ist ${commits(b.behind)} hinter ${b.upstream}.`,
    why.length > 0
      ? `Er wurde nicht automatisch aktualisiert, weil ${why.join(' und ')}.`
      : 'Er wurde nicht automatisch aktualisiert, weil automatisches Pullen ausgeschaltet ist.',
    'Weise den Nutzer in deiner ersten Antwort darauf hin, dass er erst pullen sollte,',
    'und bearbeite keine Dateien in diesem Repository, bevor er das erledigt oder ausdrücklich abgelehnt hat.',
  ].join(' ')
}

export const register: Register = (on, options) => {
  const settings: Settings = {
    autoPull: options.autoPull !== false,
    ignore: String(options.ignore ?? '')
      .split(',')
      .map(entry => entry.trim().replace(/\/+$/, ''))
      .filter(entry => entry !== ''),
  }
  const recheckMs = Number(options.recheckMinutes) * 60_000
  // The session's folder, and the check started for it, which the first context waits for.
  let cwd = ''
  let pending: Promise<void> = Promise.resolve()
  let checkedAt = 0

  on('session.start', async ($, e, next) => {
    await update($, behind, () => null)
    await update($, unpushed, () => null)
    cwd = e.cwd
    checkedAt = await $.clock.now()
    pending = check($, cwd, settings)

    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    await pending
    const b = await read($, behind)
    const result = await next(e)
    if (b === null) return result

    return { ...result, blocks: [...result.blocks, { name: 'gitPullGuard', text: contextText(b) }] }
  })

  // In a long session, a prompt after the set time fetches again, in the background.
  on('turn.start', async ($, e, next) => {
    const at = await $.clock.now()
    if (e.agentId === undefined && cwd !== '' && recheckMs > 0 && at - checkedAt >= recheckMs) {
      checkedAt = at
      pending = check($, cwd, settings)
    }

    return next(e)
  })

  // After each answer: did Claude commit something that is not pushed yet?
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && cwd !== '') await countUnpushed($, cwd, settings)

    return next(e)
  })

  // A push onto an upstream that moved on is held until the branch has pulled.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (cwd === '' || !PUSH.test(e.command)) return next(e)
    await check($, cwd, settings)
    const b = await read($, behind)
    if (b === null) return next(e)

    return {
      deny:
        `Push angehalten: ${b.branch} ist ${commits(b.behind)} hinter ${b.upstream}. ` +
        'Erst den neuen Stand holen (git pull --rebase oder git pull), Konflikte lösen, dann erneut pushen. ' +
        'Bei nicht committeten Änderungen oder wenn ein Force-Push gewollt ist: zuerst den Nutzer fragen.',
    }
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, behind)
    const u = await read($, unpushed)
    if (e.props.hasSurvey || (b === null && u === null)) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)

    if (b === null && u !== null) {
      return (
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color="inactive" wrap="truncate-end">
            ↑ {commits(u.ahead)} auf {u.branch} noch nicht gepusht
          </Text>
          <Button key="push" label="Claude pushen lassen" onPress={() => askPush($, u.ahead, u.branch)} />
          <Button key="hide-unpushed" label="Ausblenden" onPress={() => update($, unpushed, () => null)} />
        </Box>
      )
    }
    if (b === null) return next(e)

    const canPull = !b.isDirty && b.ahead === 0

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Text color="warning" wrap="truncate-end">
            ⚠ {b.branch} ist {commits(b.behind)} hinter {b.upstream}. Erst pullen!
          </Text>
          {canPull && <Button key="pull" label="Jetzt pullen" variant="primary" onPress={() => pull($)} />}
          <Button key="ask" label="Claude fragen" onPress={() => ask($, b)} />
          <Button key="hide" label="Ausblenden" onPress={() => update($, behind, () => null)} />
        </Box>
        {b.error !== null && (
          <Text color="error" wrap="truncate-end">
            Pull ging nicht: {b.error}
          </Text>
        )}
      </Box>
    )
  })
}

async function pull($: EngineInterface) {
  const b = await read($, behind)
  if (b === null) return
  const done = await gitIn($, b.root)(['merge', '--ff-only', '--quiet', '@{u}'])
  if (done.isOk) {
    await update($, behind, () => null)
    $.ui.toast(`↓ ${commits(b.behind)} auf ${b.branch} geholt`)
    return
  }
  await update($, behind, now => (now === null ? null : { ...now, error: done.out.split('\n')[0] ?? 'unbekannter Fehler' }))
}

async function ask($: EngineInterface, b: Behind) {
  const text =
    `Mein Branch ${b.branch} ist ${commits(b.behind)} hinter ${b.upstream}` +
    (b.isDirty ? ', und ich habe nicht committete Änderungen' : '') +
    (b.ahead > 0 ? `, und ${commits(b.ahead)} von mir fehlen auf origin` : '') +
    '. Bitte hol den neuen Stand sicher rein, ohne meine Arbeit zu verlieren, und sag mir vorher, was du vorhast.'
  await $.prompt.fill({ text, mode: 'replace' })
}

async function askPush($: EngineInterface, ahead: number, branch: string) {
  await $.prompt.fill({
    text: `Bitte push die ${commits(ahead)} auf ${branch}. Prüf vorher kurz, ob origin inzwischen neuer ist.`,
    mode: 'replace',
  })
}
