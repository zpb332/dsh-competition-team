import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A minimal host: one in-memory Session per member plus prompt capture. */
export function makeCtx() {
  const sessions = new Map()
  const prompts = []
  const appends = []
  let seq = 0
  const ctx = {
    logger: { info() {}, warn() {}, error() {} },
    sessionController: {
      async create() {
        const sessionId = `s-${++seq}`
        const session = {
          id: sessionId,
          events: [],
          appended: [],
          snapshotEvents() { return this.events },
          append(type, data) {
            this.appended.push({ type, data })
            appends.push({ sessionId, type, data })
          },
        }
        sessions.set(sessionId, session)
        return { sessionId }
      },
      async rename() {},
      async prompt({ sessionId, content }) {
        prompts.push({ sessionId, text: content.map(part => part.text || '').join('') })
      },
      async modelCatalog() { return { default: null, groups: [] } },
      async selectModel() {},
    },
    sessions: { get: id => sessions.get(id), list: () => [] },
    sessionQuery: {
      async observeSession() { return { events: [], [Symbol.dispose]() {} } },
    },
    agents: { get: () => null },
    workspaceRegistry: { resolveByPath: async () => null, archiveSession: async () => {} },
  }
  return { ctx, sessions, prompts, appends }
}

/** Build one store in a throwaway DSH_HOME and throwaway workspace. */
export async function makeStore() {
  const home = await mkdtemp(join(tmpdir(), 'ct-home-'))
  process.env.DSH_HOME = home
  const mod = await import('../index.js')
  const { ctx, sessions, prompts, appends } = makeCtx()
  const store = new mod.TeamStore(ctx)
  await store.init()
  const cwd = await mkdtemp(join(tmpdir(), 'ct-cwd-'))
  return { store, ctx, sessions, prompts, appends, cwd, mod }
}

export async function makeTeam(store, cwd, overrides = {}) {
  return store.create({
    title: '测试队',
    brief: '这是一个用于状态机测试的题目描述。',
    cwd,
    auto: false,
    members: [
      { role: 'captain', name: '队长', kind: 'captain', task: '负责拆解任务', deps: [] },
      { role: 'member-1', name: '队员', kind: 'member', task: '负责执行', deps: ['captain'] },
    ],
    ...overrides,
  })
}

export function assistantEvent(text) {
  return { type: 'assistant/message', data: { message: { content: [{ type: 'text', text }] } } }
}

/** Simulate a captain turn that produces a real artifact plus a structured hand-off. */
export async function finishCaptain(store, sessions, team, { verdict = null, usage = null } = {}) {
  const { writeFile } = await import('node:fs/promises')
  const captain = team.members.find(member => member.role === 'captain')
  await writeFile(join(team.root, 'artifacts', 'captain', 'note.txt'), 'hello\nThis artifact is intentionally long enough to pass the quality gate.\n', 'utf8')
  const block = {
    role: 'captain',
    status: 'done',
    artifacts: ['artifacts/captain/note.txt'],
    verdict,
    blockers: [],
  }
  await writeFile(
    join(team.root, 'handoffs', 'captain.md'),
    '<!-- competition-team\n' + JSON.stringify(block) + '\n-->\n# 队长 交接\n\n结论：完成\n',
    'utf8',
  )
  const session = sessions.get(captain.sessionId)
  const event = assistantEvent('队长完成汇报：产物已落盘。')
  if (usage) event.data.usage = usage
  session.events.push(event)
  // The live host delivers each event before turn/end; usage accounting only
  // sees it here.
  await store.onSessionEvent(session, event)
  await store.onSessionEvent(session, { type: 'turn/end' })
  return captain
}