import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Behind } from '../types'

// Change the tag when Behind's fields change: it declines what an earlier
// version stored, which outlives a reload.
const behind = atom({ plugin: 'git-pull-guard', key: 'behind' } as const, null, {
  shape: 'behind-1',
})

// Git never stops to ask for a password: a fetch that needs one fails instead.
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0' }

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
 * Fetches the branch's upstream and, when it is behind, pulls by itself
 * where that cannot touch the person's work (a clean tree and no commits of
 * its own: a fast-forward); else it records what stands in the way.
 */
async function check($: EngineInterface, cwd: string) {
  const git = gitIn($, cwd)
  const root = await git(['rev-parse', '--show-toplevel'])
  // The home folder can be a repository of its own: no project to sync.
  if (!root.isOk || root.out === (await $.env.get('HOME'))) return

  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
  const upstream = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  if (!branch.isOk || branch.out === 'HEAD' || !upstream.isOk) return
  if (!(await git(['fetch', '--quiet'], 20_000)).isOk) return

  const counts = await git(['rev-list', '--left-right', '--count', 'HEAD...@{u}'])
  const [ahead = 0, lag = 0] = counts.out.split(/\s+/).map(Number)
  if (!counts.isOk || lag === 0) return

  const status = await git(['status', '--porcelain', '--untracked-files=no'])
  const isDirty = !status.isOk || status.out !== ''

  if (!isDirty && ahead === 0 && (await git(['merge', '--ff-only', '--quiet', '@{u}'])).isOk) {
    $.ui.toast(`↓ ${commits(lag)} auf ${branch.out} geholt (${upstream.out})`)
    return
  }

  await update($, behind, () => ({
    root: root.out,
    branch: branch.out,
    upstream: upstream.out,
    behind: lag,
    ahead,
    isDirty,
    error: null,
  }))
}

function contextText(b: Behind) {
  const why = [
    b.isDirty ? 'es gibt nicht committete Änderungen' : '',
    b.ahead > 0 ? `der Branch hat ${commits(b.ahead)}, die origin nicht hat` : '',
  ].filter(part => part !== '')
  return [
    `Der Branch ${b.branch} in ${b.root} ist ${commits(b.behind)} hinter ${b.upstream}.`,
    `Er wurde nicht automatisch aktualisiert, weil ${why.join(' und ')}.`,
    'Weise den Nutzer in deiner ersten Antwort darauf hin, dass er erst pullen sollte,',
    'und bearbeite keine Dateien in diesem Repository, bevor er das erledigt oder ausdrücklich abgelehnt hat.',
  ].join(' ')
}

export const register: Register = on => {
  // The check started at session start, which the first context waits for.
  let pending: Promise<void> = Promise.resolve()

  on('session.start', async ($, e, next) => {
    await update($, behind, () => null)
    pending = check($, e.cwd)

    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    await pending
    const b = await read($, behind)
    const result = await next(e)
    if (b === null) return result

    return { ...result, blocks: [...result.blocks, { name: 'gitPullGuard', text: contextText(b) }] }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const b = await read($, behind)
    if (b === null || e.props.hasSurvey) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
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
