/**
 * Accelerated soak test: churn teams through the full state machine with
 * transient errors, stalls, permanent failures, budget cutoffs and cold
 * reloads. Not part of `node --test`; run it with `npm run soak`.
 */
process.env.COMPETITION_STALL_MS = process.env.COMPETITION_STALL_MS || '150'
process.env.COMPETITION_RETRY_MS = process.env.COMPETITION_RETRY_MS || '20'

const { mkdir, readFile, writeFile } = await import('node:fs/promises')
const { join } = await import('node:path')
const { monitorEventLoopDelay } = await import('node:perf_hooks')
const { makeStore, makeTeam, assistantEvent } = await import('../test-support/helpers.mjs')

const TEAMS = Math.max(1, Number(process.env.SOAK_TEAMS) || 30)
const STALL_MS = Number(process.env.COMPETITION_STALL_MS)
const M = {
  teams: 0,
  done: 0,
  failed: 0,
  budgetPaused: 0,
  transientRetries: 0,
  stalls: 0,
  permanent: 0,
  reloads: 0,
  stuck: 0,
  stuckBudget: 0,
  stuckUpstream: 0,
  stuckOther: 0,
  invariantFailures: 0,
}

const { store, sessions, cwd } = await makeStore()
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function rngFactory(seed) {
  let value = seed >>> 0
  return () => {
    value += 0x6d2b79f5
    let t = value
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function waitFor(predicate, timeout = 5000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (Date.now() > deadline) return false
    await sleep(10)
  }
  return true
}

const DEFAULT_MEMBERS = [
  { role: 'captain', name: '队长', kind: 'captain', task: '负责拆解任务并写任务书', deps: [] },
  { role: 'core-a', name: '核心 A', kind: 'core', task: '负责建模与公式推导', deps: ['captain'] },
  { role: 'core-b', name: '核心 B', kind: 'core', task: '负责实现与出图', deps: ['captain', 'core-a'] },
  { role: 'paper', name: '论文手', kind: 'member', task: '负责撰写完整论文', deps: ['captain', 'core-b'] },
  { role: 'reviewer', name: '审核员', kind: 'member', task: '负责审核模型、代码与论文', deps: ['captain', 'core-a', 'core-b', 'paper'], readOnly: true },
]

async function deliver(team, member) {
  const session = sessions.get(member.sessionId)
  if (!session) throw new Error('missing session for ' + member.role)
  const artifacts = []
  if (!member.readOnly) {
    const rel = 'artifacts/' + member.role + '/soak.txt'
    await mkdir(join(team.root, 'artifacts', member.role), { recursive: true })
    await writeFile(join(team.root, rel), 'soak artifact for ' + member.role + '\n' + 'x'.repeat(80) + '\n', 'utf8')
    artifacts.push(rel)
  }
  const block = {
    role: member.role,
    status: 'done',
    artifacts,
    verdict: member.role === 'reviewer' ? 'pass' : null,
    blockers: [],
  }
  await mkdir(join(team.root, 'handoffs'), { recursive: true })
  await writeFile(
    join(team.root, 'handoffs', member.role + '.md'),
    '<!-- competition-team\n' + JSON.stringify(block) + '\n-->\n# ' + member.role + ' 交接\n\n结论：完成\n',
    'utf8',
  )
  const event = assistantEvent(member.name + ' 完成本轮任务。')
  event.data.usage = { inputTokens: 300, outputTokens: 200, totalTokens: 500 }
  session.events.push(event)
  await store.onSessionEvent(session, event)
  await store.onSessionEvent(session, { type: 'turn/end' })
}

const isTerminal = member => ['done', 'failed', 'blocked', 'skipped'].includes(member.status)

async function handleMember(team, member, rng) {
  const faultRate = Number(process.env.SOAK_FAULT_RATE ?? 1)
  const roll = rng()
  if (roll < 0.10 * faultRate) {
    M.transientRetries += 1
    await store.onAgentError({ id: member.sessionId }, Object.assign(new Error('503 service unavailable'), { status: 503 }))
    const recovered = await waitFor(() => member.status === 'running' || isTerminal(member), 5000)
    if (!recovered || member.status !== 'running') return
  } else if (roll < 0.10 * faultRate + 0.06 * faultRate) {
    M.stalls += 1
    await sleep(STALL_MS + 60)
    await store.watchdog()
    const recovered = await waitFor(() => member.status === 'running' || isTerminal(member), 5000)
    if (!recovered || member.status !== 'running') return
  } else if (roll < 0.10 * faultRate + 0.06 * faultRate + 0.03 * faultRate) {
    M.permanent += 1
    await store.onAgentError({ id: member.sessionId }, Object.assign(new Error('401 unauthorized'), { status: 401 }))
    return
  }
  if (member.status === 'running') await deliver(team, member)
}

async function runOneTeam(index, rng) {
  const team = await makeTeam(store, cwd, { auto: true, members: DEFAULT_MEMBERS })
  M.teams += 1
  if (index % 12 === 0) await store.setBudget(team.id, 100)
  await store.confirm(team.id)

  const deadline = Date.now() + 20000
  while (Date.now() < deadline) {
    const running = team.members.filter(member => member.status === 'running')
    if (running.length === 0) {
      if (team.members.every(isTerminal)) break
      await sleep(20)
      continue
    }
    for (const member of running) await handleMember(team, member, rng)
    await sleep(10)
  }

  const stuck = team.members.filter(member => !isTerminal(member))
  if (stuck.length > 0) {
    M.stuck += 1
    const failedRoles = new Set(team.members.filter(member => member.status === 'failed').map(member => member.role))
    const waitsOnFailure = stuck.every(member => member.deps.some(dep => failedRoles.has(dep)))
    if (team.budget.exhaustedAt) {
      M.stuckBudget += 1
      M.budgetPaused += 1
    } else if (waitsOnFailure) {
      M.stuckUpstream += 1
    } else {
      M.stuckOther += 1
    }
  } else if (team.members.some(member => member.status === 'failed')) {
    M.failed += 1
  } else {
    M.done += 1
  }

  const saved = JSON.parse(await readFile(join(team.root, 'team.json'), 'utf8'))
  if (saved.id !== team.id || saved.members.length !== team.members.length) M.invariantFailures += 1

  if (index > 0 && index % 10 === 0 && team.members.every(isTerminal)) {
    const before = team.members.map(member => member.role + ':' + member.status).join(',')
    store.teams.clear()
    await store.loadAll()
    const reloaded = store.teams.get(team.id)
    M.reloads += 1
    if (!reloaded) M.invariantFailures += 1
    else {
      const after = reloaded.members.map(member => member.role + ':' + member.status).join(',')
      if (before !== after) M.invariantFailures += 1
    }
  }
}

const rng = rngFactory(Number(process.env.SOAK_SEED) || 42)
const monitor = monitorEventLoopDelay({ resolution: 20 })
monitor.enable()
const started = Date.now()
let peakHeap = 0

for (let index = 0; index < TEAMS; index += 1) {
  await runOneTeam(index, rng)
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed)
}

monitor.disable()
const elapsed = Date.now() - started
const result = {
  ...M,
  elapsedMs: elapsed,
  teamsPerSecond: Number((M.teams / (elapsed / 1000)).toFixed(2)),
  peakHeapMb: Number((peakHeap / 1024 / 1024).toFixed(1)),
  maxEventLoopDelayMs: Number((monitor.max / 1e6).toFixed(1)),
  ok: M.invariantFailures === 0,
}
console.log(JSON.stringify(result, null, 2))
if (!result.ok) process.exitCode = 1