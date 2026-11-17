import { expect, mock, test } from 'claude-code/testing'
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

type Repo = { ahead: number; behind: number; isDirty: boolean; root?: string; mergeFails?: boolean; branch?: string }

/** A git that answers as a repository in the given state would; returns the commands it ran. */
function fakeGit(on: On, repo: Repo) {
  const ran: string[] = []
  const toasts: string[] = []
  const fills: string[] = []
  const clock = mock.clock(on, { now: 0 })
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
    if (cmd === 'rev-parse --abbrev-ref HEAD') return ok(`${repo.branch ?? 'main'}\n`)
    if (cmd.startsWith('rev-parse --abbrev-ref --symbolic-full-name')) return ok('origin/main\n')
    if (cmd === 'fetch --quiet') return ok('')
    if (cmd === 'rev-list --count @{u}..HEAD') return ok(`${repo.ahead}\n`)
    if (cmd.startsWith('rev-list')) return ok(`${repo.ahead}\t${repo.behind}\n`)
    if (cmd.startsWith('status')) return ok(repo.isDirty ? ' M src/app.ts\n' : '')
    if (cmd.startsWith('merge')) return repo.mergeFails ? fail('fatal: Not possible to fast-forward, aborting.') : ok('')
    return fail(`unexpected: ${cmd}`)
  })
  return { ran, toasts, fills, clock }
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

test('a push onto an upstream that moved on is held, other commands pass', async ($, on) => {
  const repo: Repo = { ahead: 1, behind: 0, isDirty: false }
  const git = fakeGit(on, repo)
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })

  // Up to date: the push goes through.
  expect((await $.tool.call({ tool: 'Bash', command: 'git push' })).deny).toBeUndefined()

  repo.behind = 2
  const held = await $.tool.call({ tool: 'Bash', command: 'git -C /Users/me/Projekte/app push origin main' })
  expect(held.deny).toContain('Push angehalten: main ist 2 Commits hinter origin/main.')
  expect((await $.tool.call({ tool: 'Bash', command: 'git status' })).deny).toBeUndefined()
  expect(git.ran.filter(cmd => cmd === 'fetch --quiet')).toHaveLength(3)
})

test('commits not pushed yet show a band after the answer', async ($, on) => {
  const repo: Repo = { ahead: 0, behind: 0, isDirty: false }
  const git = fakeGit(on, repo)
  on('turn.complete', (_, e) => ({ text: e.answer }))
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })

  repo.ahead = 2
  await $.turn.complete({ answer: 'committed', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /gepusht/ }))?.text).toBe('↑ 2 Commits auf main noch nicht gepusht')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'push' })
  expect(git.fills[0]).toContain('Bitte push die 2 Commits auf main')
  await ui.press({ key: 'hide-unpushed' })
  expect(await ui.find({ type: 'Text', text: /gepusht/ })).toBeUndefined()
  await ui.unmount()
})

test('with auto-pull off, a clean branch is only warned about', { options: { autoPull: false } }, async ($, on) => {
  const git = fakeGit(on, { ahead: 0, behind: 4, isDirty: false })
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  const context = await $.prompt.context({ blocks: [] })

  expect(git.ran).not.toContain('merge --ff-only --quiet @{u}')
  expect(context.blocks[0]?.text).toContain('automatisches Pullen ausgeschaltet')
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'pull' })
  expect(git.toasts).toEqual(['↓ 4 Commits auf main geholt'])
  await ui.unmount()
})

test('a repository the person set aside is left alone', { options: { ignore: 'dotfiles, app' } }, async ($, on) => {
  const git = fakeGit(on, { ahead: 0, behind: 4, isDirty: true })
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
  expect(git.ran).toEqual(['rev-parse --show-toplevel'])
})

test('a prompt after the set time fetches again and finds the new commits', { options: { recheckMinutes: 15 } }, async ($, on) => {
  const repo: Repo = { ahead: 0, behind: 0, isDirty: true }
  const git = fakeGit(on, repo)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  await $.prompt.context({ blocks: [] })

  repo.behind = 3
  await git.clock.advance(10 * 60_000)
  await $.turn.start({ text: 'zu früh', turnId: 't1' })
  expect(git.ran.filter(cmd => cmd === 'fetch --quiet')).toHaveLength(1)

  await git.clock.advance(6 * 60_000)
  await $.turn.start({ text: 'jetzt', turnId: 't2' })
  await $.prompt.context({ blocks: [] })
  expect(git.ran.filter(cmd => cmd === 'fetch --quiet')).toHaveLength(2)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /hinter/ }))?.text).toBe('⚠ main ist 3 Commits hinter origin/main. Erst pullen!')
  await ui.unmount()
})

test('the first change on main is held once and asks about a branch of its own', async ($, on) => {
  const git = fakeGit(on, { ahead: 0, behind: 0, isDirty: false })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  // The check started with the session ends before the first prompt is sent.
  await $.prompt.context({ blocks: [] })

  const held = await $.tool.call({ tool: 'Edit', file_path: '/Users/me/Projekte/app/src/a.ts', old_string: 'a', new_string: 'b' })
  expect(held.deny).toContain('Angehalten von git-pull-guard: /Users/me/Projekte/app ist auf dem Branch main.')
  // Reading is never held, and the warning comes once per repository.
  expect((await $.tool.call({ tool: 'Read', file_path: '/Users/me/Projekte/app/src/a.ts' })).deny).toBeUndefined()
  const again = await $.tool.call({ tool: 'Write', file_path: '/Users/me/Projekte/app/src/b.ts', content: 'x' })
  expect(again.deny).toBeUndefined()

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /direkt auf/ }))?.text).toBe('✎ Claude will direkt auf main ändern')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'branch' })
  expect(git.fills[0]).toContain('neuen Branch von main')
  expect(await ui.find({ type: 'Text', text: /direkt auf/ })).toBeUndefined()
  await ui.unmount()
})

test('a feature branch, or the warning switched off, lets changes pass', { options: { protectedBranches: '' } }, async ($, on) => {
  fakeGit(on, { ahead: 0, behind: 0, isDirty: false })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  // The check started with the session ends before the first prompt is sent.
  await $.prompt.context({ blocks: [] })
  expect((await $.tool.call({ tool: 'Write', file_path: '/Users/me/Projekte/app/a.ts', content: 'x' })).deny).toBeUndefined()
})

test('on a feature branch nothing is held', async ($, on) => {
  fakeGit(on, { ahead: 0, behind: 0, isDirty: false, branch: 'feature/login' })
  on('tool.call', () => ({ result: {} }))
  await $.session.start({ cwd: '/Users/me/Projekte/app', surface: 'desktop', isInteractive: true })
  // The check started with the session ends before the first prompt is sent.
  await $.prompt.context({ blocks: [] })
  expect((await $.tool.call({ tool: 'Write', file_path: '/Users/me/Projekte/app/a.ts', content: 'x' })).deny).toBeUndefined()
})
