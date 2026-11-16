import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'git-pull-guard',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 4,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 4 },
    view: {},
  },
} as const

type Repo = { ahead: number; behind: number; isDirty: boolean; root?: string; mergeFails?: boolean }

/** A git that answers as a repository in the given state would; returns the commands it ran. */
function fakeGit(on: On, repo: Repo) {
  const ran: string[] = []
  const toasts: string[] = []
  const fills: string[] = []
  on('env.get', () => ({ value: '/Users/me' }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.fill', (_, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.context', (_, e) => ({ blocks: e.blocks }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('process.run', (_, e) => {
    const cmd = e.argv.slice(1).join(' ')
    ran.push(cmd)
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const fail = (stderr: string) => ({ value: { exitCode: 1, stdout: '', stderr, isStdoutTruncated: false, isStderrTruncated: false } })
    if (cmd === 'rev-parse --show-toplevel') return ok(`${repo.root ?? '/Users/me/Projekte/app'}\n`)
    if (cmd === 'rev-parse --abbrev-ref HEAD') return ok('main\n')
    if (cmd.startsWith('rev-parse --abbrev-ref --symbolic-full-name')) return ok('origin/main\n')
    if (cmd === 'fetch --quiet') return ok('')
    if (cmd.startsWith('rev-list')) return ok(`${repo.ahead}\t${repo.behind}\n`)
    if (cmd.startsWith('status')) return ok(repo.isDirty ? ' M src/app.ts\n' : '')
    if (cmd.startsWith('merge')) return repo.mergeFails ? fail('fatal: Not possible to fast-forward, aborting.') : ok('')
    return fail(`unexpected: ${cmd}`)
  })
  return { ran, toasts, fills }
}

test('a clean branch behind its upstream is pulled by itself, with no band', async ($, on) => {
  const git = fakeGit(on, { ahead: 0, behind: 3, isDirty: false })
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  const context = await $.prompt.context({ blocks: [] })

  expect(git.ran).toContain('merge --ff-only --quiet @{u}')
  expect(git.toasts).toEqual(['↓ 3 Commits auf main geholt (origin/main)'])
  expect(context.blocks).toEqual([])
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ type: 'Text', text: /hinter/ })).toBeUndefined()
  await ui.unmount()
})

test('local changes keep the pull back: a band, a hint for Claude, and a draft prompt', async ($, on) => {
  const git = fakeGit(on, { ahead: 0, behind: 2, isDirty: true })
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  const context = await $.prompt.context({ blocks: [] })

  expect(git.ran).not.toContain('merge --ff-only --quiet @{u}')
  expect(context.blocks[0]?.name).toBe('gitPullGuard')
  expect(context.blocks[0]?.text).toContain('nicht committete Änderungen')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /hinter/ }))?.text).toBe('⚠ main ist 2 Commits hinter origin/main. Erst pullen!')
    // Dirty: no one-press pull, only asking Claude or hiding.
    expect(await ui.find({ key: 'pull' })).toBeUndefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'ask' })
  expect(git.fills[0]).toContain('nicht committete Änderungen')
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /hinter/ })).toBeUndefined()
  await ui.unmount()
})

test('a failed press of "Jetzt pullen" says why and keeps the band', async ($, on) => {
  // Not dirty and no own commits, but the merge at start failed too.
  const git = fakeGit(on, { ahead: 0, behind: 1, isDirty: false, mergeFails: true })
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  await $.prompt.context({ blocks: [] })

  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'pull' })
  expect((await ui.find({ type: 'Text', text: /Pull ging nicht/ }))?.text).toBe(
    'Pull ging nicht: fatal: Not possible to fast-forward, aborting.',
  )
  expect(git.toasts).toEqual([])
  await ui.unmount()
})

test('the home folder repository and an up-to-date branch stay quiet', async ($, on) => {
  const home = fakeGit(on, { ahead: 0, behind: 5, isDirty: false, root: '/Users/me' })
  await $.session.start({ cwd: '/Users/me', surface: 'desktop', isInteractive: true })
  expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
  expect(home.ran).not.toContain('fetch --quiet')
})

test('an up-to-date branch shows nothing', async ($, on) => {
  const git = fakeGit(on, { ahead: 1, behind: 0, isDirty: true })
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
  expect(git.toasts).toEqual([])
})
