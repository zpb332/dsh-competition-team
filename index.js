/**
 * Competition Team — Host half.
 *
 * A team is five ordinary, independent DSH Sessions (captain, modeler, coder,
 * writer, reviewer). This module owns the durable team record, creates and
 * titles the member Sessions through the Session Controller, dispatches one
 * turn per member, watches `turn/end` to hand the work to the next member, and
 * reads an upstream member's session log when a downstream member asks for it.
 *
 * Everything the browser shows is derived here and served on one small
 * same-origin JSON route; the browser half never folds session events itself.
 *
 * @module dsh-competition-team
 */

import { randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { parseHandoff, handoffBlock, parseAssignments, parseAssignmentsDetailed, validateWorkflow } from './lib/handoff.mjs'
import { classifyError } from './lib/errors.mjs'
import { qualityCheck } from './lib/quality.mjs'

/** Main-panel id shared by the sidebar row, the page and the footer row. */
export const PANEL_ID = 'competition-team'
const API_PREFIX = '/competition-team/api'
const DATA_DIR = join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'data', 'competition-team')
const INDEX_FILE = join(DATA_DIR, 'index.json')
const TEAM_DIR = '.dsh-competition'
const MAX_BODY = 256 * 1024
const MAX_ARTIFACTS = 80
const MAX_SUMMARY = 4000
const MAX_HANDOFF = 12000
const MAX_LOG = 80
/** Declared artifacts smaller than this are treated as empty stubs. */
const MAX_TRANSIENT_RETRIES = 2
const RETRY_BASE_MS = Number(process.env.COMPETITION_RETRY_MS) > 0
  ? Number(process.env.COMPETITION_RETRY_MS)
  : 5000
/** A running member with no event for this long is reported as stalled. */
const STALL_MS = Number(process.env.COMPETITION_STALL_MS) > 0
  ? Number(process.env.COMPETITION_STALL_MS)
  : 8 * 60 * 1000
/** How long new user feedback waits for more of it before one merged turn. */
const FEEDBACK_DEBOUNCE_MS = 10 * 1000
/** Pending proposals go stale after this long and cannot be approved. */
const PROPOSAL_TTL_MS = 30 * 60 * 1000
/** Default token budget for a new team; 0 disables the budget. */
const DEFAULT_BUDGET = 3_000_000
const BUDGET_WARN_RATIO = 0.8

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.tex': 'text/plain; charset=utf-8',
}

/** Three role kinds: the captain commands, cores think, members execute. */
const KINDS = ['captain', 'core', 'member']

/** Editable starter roster; the user reshapes it on the canvas before work begins. */
const DEFAULT_MEMBERS = [
  {
    role: 'captain', name: '队长', kind: 'captain', deps: [], pos: { x: 0.5, y: 0.1 },
    task: '通读题目与目标，在 artifacts/captain/plan.md 里为每位成员写任务书（目标、输入、产出、依赖、验收口径），并说明谁先谁后。',
  },
  {
    role: 'core-a', name: '核心 A', kind: 'core', deps: ['captain'], pos: { x: 0.28, y: 0.4 },
    task: '负责建模：假设、符号说明、核心公式、求解思路，产出 model.md。',
  },
  {
    role: 'core-b', name: '核心 B', kind: 'core', deps: ['captain', 'core-a'], pos: { x: 0.72, y: 0.4 },
    task: '负责实现：按模型写可复跑代码、求解并出图，产出脚本与图表。',
  },
  {
    role: 'member-a', name: '论文手', kind: 'member', deps: ['captain', 'core-b'], pos: { x: 0.3, y: 0.72 },
    task: '撰写完整竞赛论文，产出 paper.md。',
  },
  {
    role: 'member-b', name: '审核员', kind: 'member', deps: ['captain', 'core-a', 'core-b', 'member-a'], pos: { x: 0.7, y: 0.72 },
    task: '审核建模、代码与论文的一致性，给出结论「通过」或「需返工」。', readOnly: true,
  },
]

/** Stable-enough role id from a display name. */
function slugify(value, fallback) {
  const text = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return text.length > 0 ? text.slice(0, 32) : fallback
}

function clampUnit(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(0.94, Math.max(0.06, number))
}

function normalizeMember(raw, index, taken) {
  const kind = KINDS.includes(raw?.kind) ? raw.kind : 'member'
  let role = String(raw?.role || raw?.id || slugify(raw?.name, `${kind}-${index + 1}`))
  if (taken.has(role)) {
    let suffix = 2
    const base = role
    while (taken.has(`${base}-${suffix}`)) suffix += 1
    role = `${base}-${suffix}`
  }
  taken.add(role)
  const model = raw?.model && typeof raw.model === 'object'
    && typeof raw.model.provider === 'string' && typeof raw.model.model === 'string'
    ? {
      provider: raw.model.provider,
      model: raw.model.model,
      ...(typeof raw.model.reasoningEffort === 'string' && raw.model.reasoningEffort
        ? { reasoningEffort: raw.model.reasoningEffort }
        : {}),
    }
    : null
  return {
    role,
    name: String(raw?.name || role).slice(0, 40),
    kind,
    task: String(raw?.task || '').slice(0, 4000),
    deps: Array.isArray(raw?.deps) ? raw.deps.map(String).filter(dep => dep !== role) : [],
    pos: {
      x: clampUnit(raw?.pos?.x, 0.1 + (index % 3) * 0.3),
      y: clampUnit(raw?.pos?.y, 0.12 + Math.floor(index / 3) * 0.26),
    },
    model,
    readOnly: raw?.readOnly === true,
    taskSource: raw?.taskSource || null,
    taskUpdatedAt: raw?.taskUpdatedAt || null,
    taskPending: raw?.taskPending === true,
    qualityWarnings: Array.isArray(raw?.qualityWarnings) ? raw.qualityWarnings.map(String) : [],
    retryAttempts: Math.max(0, Number(raw?.retryAttempts) || 0),
    retryKind: raw?.retryKind || null,
    retryAt: raw?.retryAt || null,
    errorDetail: raw?.errorDetail || null,
    taskTurnOpen: raw?.taskTurnOpen === true,
    stallResume: raw?.stallResume === true,
    stallRetries: Math.max(0, Number(raw?.stallRetries) || 0),
    resumeKind: raw?.resumeKind || null,
    resumeAttempts: Math.max(0, Number(raw?.resumeAttempts) || 0),
    tokens: Math.max(0, Number(raw?.tokens) || 0),
    guardRetries: Number(raw?.guardRetries) || 0,
    handoffFormat: raw?.handoffFormat || null,
    handoffVerdict: raw?.handoffVerdict || null,
    blockers: Array.isArray(raw?.blockers) ? raw.blockers.map(String) : [],
    declaredArtifacts: Array.isArray(raw?.declaredArtifacts) ? raw.declaredArtifacts.map(String) : [],
    sessionId: raw?.sessionId || null,
    status: raw?.status || STATUS.pending,
    startedAt: raw?.startedAt || null,
    finishedAt: raw?.finishedAt || null,
    summary: raw?.summary || '',
    error: raw?.error || null,
    handoff: raw?.handoff || `handoffs/${role}.md`,
    rounds: Number(raw?.rounds) || 0,
  }
}

/** Normalize a whole roster and drop dependencies that name no surviving role. */
function normalizeRoster(list) {
  const taken = new Set()
  const members = (Array.isArray(list) ? list : DEFAULT_MEMBERS)
    .map((raw, index) => normalizeMember(raw, index, taken))
  const ids = new Set(members.map(member => member.role))
  for (const member of members) {
    member.deps = member.deps.filter(dep => dep !== member.role && ids.has(dep))
  }
  return members
}

const STATUS = {
  pending: 'pending',
  running: 'running',
  done: 'done',
  failed: 'failed',
  stopped: 'stopped',
  blocked: 'blocked',
  stalled: 'stalled',
  skipped: 'skipped',
  retrying: 'retrying',
}

/** Read the first human-readable text out of one assistant message. */
function assistantText(message) {
  const blocks = message && Array.isArray(message.content) ? message.content : []
  const parts = []
  for (const block of blocks) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

function clip(text, limit) {
  const value = typeof text === 'string' ? text : ''
  return value.length > limit ? `${value.slice(0, limit)}\n…（已截断）` : value
}

function clampSummary(text) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > MAX_SUMMARY ? `${value.slice(0, MAX_SUMMARY)}…` : value
}

function nowStamp() {
  return Date.now()
}

function formatSeconds(total) {
  if (!Number.isFinite(total) || total < 0) return ''
  const sec = Math.round(total / 1000)
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m${String(sec % 60).padStart(2, '0')}s`
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m`
}

async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

async function readJson(path, fallback) {
  try {
    const raw = await readFile(path, 'utf8')
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

/** Atomic JSON write: a crash never leaves a half-written team record. */
async function writeJsonAtomic(path, value) {
  await ensureDir(dirname(path))
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

function fileExists(path) {
  return stat(path).then(() => true, () => false)
}

function relPosix(root, abs) {
  return abs.slice(root.length).split(sep).join('/').replace(/^\/+/, '')
}

/** Recursively list artifact files under one team directory. */
async function listFiles(root, limit) {
  const out = []
  const walk = async (dir, depth) => {
    if (out.length >= limit || depth > 4) return
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (out.length >= limit) return
      if (entry.name.startsWith('.')) continue
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(abs, depth + 1)
      } else if (entry.isFile()) {
        let size = 0
        try { size = (await stat(abs)).size } catch { /* keep zero */ }
        const rel = relPosix(root, abs)
        const ext = extname(entry.name).toLowerCase()
        out.push({
          rel,
          name: entry.name,
          size,
          kind: MIME[ext]?.startsWith('image/') ? 'image' : ext === '.md' ? 'markdown' : 'file',
        })
      }
    }
  }
  await walk(root, 0)
  return out
}

/** One team, its five members and their sessions. */
class TeamStore {
  constructor(ctx) {
    this.ctx = ctx
    this.index = []
    this.teams = new Map()
    this.bySession = new Map()
    this.captainBySession = new Map()
    this.live = new Map()
    this.captainBusy = new Map()
    this.feedbackTimers = new Map()
    this.stalled = new Set()
    this.finishing = new Set()
    this.queue = Promise.resolve()
    this.loaded = false
  }

  log(message) {
    try { this.ctx.logger.info(`competition-team: ${message}`) } catch { /* logging is optional */ }
  }

  /** Serialize mutations so a poll never observes a half-applied action. */
  serialize(operation) {
    const run = this.queue.then(operation, operation)
    this.queue = run.catch(() => undefined)
    return run
  }

  async init() {
    await ensureDir(DATA_DIR)
    const saved = await readJson(INDEX_FILE, null)
    this.index = Array.isArray(saved?.teams) ? saved.teams.filter(item => item && item.id && item.cwd) : []
    this.loaded = true
  }

  async saveIndex() {
    this.index.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    if (this.index.length > 40) this.index.length = 40
    await writeJsonAtomic(INDEX_FILE, { version: 1, teams: this.index })
  }

  teamPath(cwd, id) {
    return join(cwd, TEAM_DIR, id)
  }

  async load(teamId) {
    if (this.teams.has(teamId)) return this.teams.get(teamId)
    const entry = this.index.find(item => item.id === teamId)
    if (!entry) return undefined
    const root = this.teamPath(entry.cwd, entry.id)
    const saved = await readJson(join(root, 'team.json'), null)
    if (!saved || !Array.isArray(saved.members)) return undefined
    const legacyVersion = Number(saved.version) || 1
    const team = {
      version: saved.version || 1,
      id: saved.id,
      title: saved.title || '未命名团队',
      brief: saved.brief || '',
      cwd: saved.cwd || entry.cwd,
      root,
      auto: saved.auto !== false,
      createdAt: saved.createdAt || entry.createdAt || nowStamp(),
      updatedAt: saved.updatedAt || entry.updatedAt || nowStamp(),
      ownerSessionId: saved.ownerSessionId || null,
      verdict: saved.verdict || null,
      verdictRole: saved.verdictRole || null,
      audit: Array.isArray(saved.audit) ? saved.audit.slice(-40) : [],
      proposals: Array.isArray(saved.proposals) ? saved.proposals.slice(-20) : [],
      feedbackQueue: Array.isArray(saved.feedbackQueue) ? saved.feedbackQueue.slice(-20) : [],
      feedback: Array.isArray(saved.feedback)
        ? saved.feedback
          .filter(item => item && typeof item.text === 'string'
            && !/^(Time sampled|Browser time zone|Elapsed since)/.test(item.text.trim()))
          .slice(-20)
        : [],
      captainReply: saved.captainReply || null,
      assignmentCheck: saved.assignmentCheck && typeof saved.assignmentCheck === 'object'
        ? saved.assignmentCheck
        : null,
      notifications: Array.isArray(saved.notifications) ? saved.notifications.slice(-30) : [],
      budget: (() => {
        const stored = saved.budget
        if (!stored || typeof stored !== 'object') {
          return { limit: DEFAULT_BUDGET, warnedAt: null, exhaustedAt: null }
        }
        const limit = Number(stored.limit)
        return {
          limit: Number.isFinite(limit) && limit >= 0 ? limit : DEFAULT_BUDGET,
          warnedAt: stored.warnedAt || null,
          exhaustedAt: stored.exhaustedAt || null,
        }
      })(),
      confirmed: saved.confirmed !== false,
      startedOnce: saved.startedOnce === true,
      log: Array.isArray(saved.log) ? saved.log.slice(-MAX_LOG) : [],
      members: normalizeRoster(saved.members.map(raw => ({
        ...raw,
        kind: raw.kind || (raw.role === 'captain' ? 'captain' : raw.role === 'modeler' ? 'core' : 'member'),
        // Teams written before the read-only reviewer existed: audit roles
        // start read-only from this version on.
        ...(legacyVersion < 2 && /审核|review/i.test(String(raw.name || raw.role || ''))
          ? { readOnly: true }
          : {}),
      }))),
    }
    team.version = 2
    team.startedOnce = team.startedOnce
      || team.members.some(member => member.sessionId || member.rounds > 0 || member.tokens > 0)
    this.teams.set(team.id, team)
    for (const member of team.members) {
      if (!member.sessionId) continue
      this.bySession.set(member.sessionId, { teamId: team.id, role: member.role })
      if (member.kind === 'captain') this.captainBySession.set(member.sessionId, team.id)
    }
    for (const member of team.members) {
      if (member.status !== STATUS.done || member.summary) continue
      try {
        member.summary = clampSummary(await readFile(join(team.root, member.handoff), 'utf8'))
      } catch { /* no hand-off file yet */ }
    }
    return team
  }

  async loadAll() {
    if (!this.loaded) await this.init()
    const teams = []
    for (const entry of this.index.slice(0, 12)) {
      const team = await this.load(entry.id).catch(() => undefined)
      if (team) teams.push(team)
    }
    await this.reconcile(teams)
    return teams
  }

  /** A host reload owns no live agent for a row still marked running. */
  async reconcile(teams) {
    for (const team of teams) {
      let dirty = false
      for (const member of team.members) {
        if (member.status === STATUS.retrying) {
          member.status = STATUS.pending
          member.retryAt = null
          dirty = true
          this.note(team, member.name + ' 的重试等待随宿主重载结束，转入待办')
          continue
        }
        if (member.status !== STATUS.running) continue
        const agent = member.sessionId ? this.ctx.agents.get(member.sessionId) : undefined
        if (agent) continue
        member.status = STATUS.failed
        member.error = 'interrupted'
        member.finishedAt = nowStamp()
        if (member.sessionId) this.live.delete(member.sessionId)
        dirty = true
        this.note(team, `${member.name} 的轮次随宿主重载中断`)
      }
      if (dirty) await this.save(team)
    }
  }

  /** Schedule a backoff retry for a transient failure, or fail the member. */
  async handleFailure(team, member, error, context) {
    const info = classifyError(error)
    const message = String(error && error.message ? error.message : error).slice(0, 500)
    member.errorDetail = message
    if (info.transient && (member.retryAttempts || 0) < MAX_TRANSIENT_RETRIES && !this.budgetExhausted(team)) {
      await this.scheduleTransientRetry(team, member, info, message)
      return true
    }
    member.status = STATUS.failed
    member.taskTurnOpen = false
    member.finishedAt = nowStamp()
    member.retryAt = null
    member.error = info.transient ? 'transient-exhausted' : info.code
    this.audit(team, '系统', 'error', member.name, context + '：' + member.error)
    this.note(team, member.name + ' ' + context + '：' + (info.transient ? '临时错误重试次数用尽' : info.code))
    this.notify(team, 'failed', member.name + ' ' + context + '：' + member.error)
    this.propagateUpstreamFailure(team, member.role)
    this.retireLive(member.sessionId)
    await this.save(team)
    return false
  }

  /** Mark every still-pending descendant of a failed member as blocked. */
  propagateUpstreamFailure(team, failedRole) {
    const failed = new Set([failedRole])
    let changed = false
    for (;;) {
      let added = false
      for (const member of team.members) {
        if (member.status !== STATUS.pending) continue
        const blockers = member.deps.filter(dep => failed.has(dep))
        if (blockers.length === 0) continue
        member.status = STATUS.blocked
        member.error = 'upstream-failed:' + blockers.join(',')
        member.taskTurnOpen = false
        member.finishedAt = nowStamp()
        failed.add(member.role)
        changed = true
        added = true
      }
      if (!added) break
    }
    if (changed) {
      this.audit(team, '系统', 'blocked', '下游', '上游失败：' + failedRole)
      this.note(team, '上游 ' + failedRole + ' 失败，下游已标记阻塞')
    }
    return changed
  }

  /** Return downstream members to pending once their failed upstreams were retried or skipped. */
  unblockDependents(team, role) {
    const failed = new Set(team.members.filter(member => member.status === STATUS.failed).map(member => member.role))
    let changed = false
    for (const member of team.members) {
      if (member.status !== STATUS.blocked) continue
      if (!String(member.error || '').startsWith('upstream-failed:')) continue
      if (member.deps.some(dep => failed.has(dep))) continue
      member.status = STATUS.pending
      member.error = null
      member.errorDetail = null
      member.taskTurnOpen = false
      member.finishedAt = null
      changed = true
      this.note(team, member.name + ' 恢复等待：上游已处理')
    }
    if (changed) this.audit(team, '系统', 'unblock', '下游', role + ' 已处理，下游恢复')
    return changed
  }

  async scheduleTransientRetry(team, member, info, message) {
    member.retryAttempts = (member.retryAttempts || 0) + 1
    const delay = RETRY_BASE_MS * (member.retryAttempts === 1 ? 1 : 3)
    member.status = STATUS.retrying
    member.taskTurnOpen = false
    member.retryKind = 'transient'
    member.retryAt = nowStamp() + delay
    member.error = 'retrying'
    member.errorDetail = message
    member.finishedAt = null
    this.retireLive(member.sessionId)
    this.audit(team, '系统', 'retry', member.name, '瞬时错误 ' + info.code + '，第 ' + member.retryAttempts + ' 次重试')
    this.note(team, member.name + ' 临时错误，' + Math.round(delay / 1000) + 's 后重试')
    await this.save(team)
    const timer = setTimeout(async () => {
      try {
        const latest = await this.load(team.id)
        const target = latest && latest.members.find(item => item.role === member.role)
        if (!target || target.status !== STATUS.retrying) return
        target.status = STATUS.pending
        target.retryAt = null
        await this.save(latest)
        await this.start(team.id, target.role, '系统（瞬时重试）', {
          keepVerdict: true,
          keepRetryAttempts: true,
          keepStallRetries: true,
        })
      } catch (error) {
        this.log('retry ' + member.role + ': ' + error)
      }
    }, delay)
    if (typeof timer.unref === 'function') timer.unref()
    return true
  }

  /** Resume members whose turn was cut off by a host reload, once each. */
  async resumeInterrupted(team) {
    let resumed = 0
    for (const member of team.members) {
      if (member.status !== STATUS.failed || member.error !== 'interrupted') continue
      if ((member.resumeAttempts || 0) >= 1) continue
      if (this.budgetExhausted(team)) continue
      if (this.unmetDeps(team, member).length > 0) continue
      member.resumeAttempts = (member.resumeAttempts || 0) + 1
      member.status = STATUS.pending
      member.taskTurnOpen = false
      member.resumeKind = 'interrupted'
      member.finishedAt = null
      this.note(team, member.name + ' 中断后自动续跑一次')
      this.audit(team, '系统', 'resume', member.name, '宿主中断，自动续跑')
      await this.save(team)
      const result = await this.start(team.id, member.role, '系统（中断恢复）', {
        keepResumeAttempts: true,
        keepVerdict: true,
        keepStallRetries: true,
      }).catch(error => ({ ok: false, error: String(error && error.message ? error.message : error) }))
      if (result && result.ok === false) {
        member.status = STATUS.failed
        member.error = 'interrupted'
        member.finishedAt = nowStamp()
        member.taskTurnOpen = false
        this.note(team, member.name + ' 自动续跑失败：' + String(result.error || ''))
        await this.save(team)
      } else {
        resumed += 1
      }
    }
    return resumed
  }

  /** Startup self-heal: resume interrupted members and any ready pending ones. */
  async resumeTeams() {
    const teams = await this.loadAll()
    let resumed = 0
    for (const team of teams) {
      const count = await this.resumeInterrupted(team)
      resumed += count
      if (!team.confirmed || team.auto === false) continue
      if (!team.startedOnce) continue
      if (this.budgetExhausted(team)) continue
      if (team.members.some(member => member.status === STATUS.running || member.status === STATUS.stalled)) continue
      const ready = this.readyMembers(team)
      if (ready.length === 0) continue
      this.note(team, '启动自愈：继续待办成员')
      await this.save(team)
      await this.startReady(team)
      resumed += ready.length
    }
    return resumed
  }

  async save(team) {
    team.updatedAt = nowStamp()
    const entry = this.index.find(item => item.id === team.id)
    const header = {
      id: team.id,
      cwd: team.cwd,
      title: team.title,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    }
    if (entry) Object.assign(entry, header)
    else this.index.unshift(header)
    await writeJsonAtomic(join(team.root, 'team.json'), {
      version: 2,
      id: team.id,
      title: team.title,
      brief: team.brief,
      cwd: team.cwd,
      auto: team.auto,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      ownerSessionId: team.ownerSessionId,
      verdict: team.verdict,
      feedback: (team.feedback || []).slice(-20),
      feedbackQueue: (team.feedbackQueue || []).slice(-20),
      audit: (team.audit || []).slice(-40),
      proposals: (team.proposals || []).slice(-20),
      captainReply: team.captainReply || null,
      startedOnce: team.startedOnce === true,
      assignmentCheck: team.assignmentCheck || null,
      notifications: (team.notifications || []).slice(-30),
      budget: team.budget || { limit: DEFAULT_BUDGET, warnedAt: null, exhaustedAt: null },
      log: team.log.slice(-MAX_LOG),
      members: team.members,
    })
    await this.saveIndex()
  }

  note(team, text) {
    team.log.push({ t: nowStamp(), text: String(text).slice(0, 400) })
    if (team.log.length > MAX_LOG) team.log.splice(0, team.log.length - MAX_LOG)
  }

  defaultCwd() {
    try {
      const sessions = this.ctx.sessions.list()
      for (let i = sessions.length - 1; i >= 0; i -= 1) {
        const cwd = sessions[i]?.header?.cwd
        if (typeof cwd === 'string' && isAbsolute(cwd)) return cwd
      }
    } catch { /* fall through */ }
    return process.cwd()
  }

  async create(options) {
    await this.loadAll()
    const cwd = typeof options.cwd === 'string' && isAbsolute(options.cwd) ? options.cwd : this.defaultCwd()
    const id = `team-${randomUUID().slice(0, 8)}`
    const root = this.teamPath(cwd, id)
    await ensureDir(join(root, 'handoffs'))
    await ensureDir(join(root, 'artifacts'))
    const roster = normalizeRoster(
      Array.isArray(options.members) && options.members.length > 0 ? options.members
        : Array.isArray(options.roles) && options.roles.length > 0 ? options.roles
          : DEFAULT_MEMBERS)
    const team = {
      version: 2,
      id,
      title: String(options.title || '竞赛小组').slice(0, 80),
      brief: String(options.brief || '').slice(0, 20000),
      cwd,
      root,
      auto: options.auto !== false,
      createdAt: nowStamp(),
      updatedAt: nowStamp(),
      ownerSessionId: options.ownerSessionId || null,
      verdict: null,
      verdictRole: null,
      confirmed: options.confirmed === true,
      startedOnce: options.confirmed === true,
      budget: { limit: DEFAULT_BUDGET, warnedAt: null, exhaustedAt: null },
      log: [],
      members: roster.map(member => ({
        ...member,
        sessionId: null,
        status: STATUS.pending,
        startedAt: null,
        finishedAt: null,
        summary: '',
        error: null,
        handoff: `handoffs/${member.role}.md`,
        rounds: 0,
        taskSource: null,
        taskUpdatedAt: null,
        taskPending: false,
      qualityWarnings: [],
      retryAttempts: 0,
      retryKind: null,
      retryAt: null,
      errorDetail: null,
        qualityWarnings: [],
        retryAttempts: 0,
        retryKind: null,
        retryAt: null,
        errorDetail: null,
        tokens: 0,
        taskTurnOpen: false,
        stallResume: false,
        stallRetries: 0,
        resumeKind: null,
        resumeAttempts: 0,
        guardRetries: 0,
        handoffFormat: null,
        handoffVerdict: null,
        blockers: [],
        declaredArtifacts: [],
      })),
    }
    await writeFile(join(root, 'brief.md'), `# ${team.title}\n\n${team.brief || '（未填写题目，请队长先向用户确认）'}\n`, 'utf8')
    for (const member of team.members) {
      await ensureDir(join(root, 'artifacts', member.role))
    }
    this.teams.set(id, team)
    this.note(team, `团队创建 · ${team.members.map(member => member.name).join(' / ')}`)
    if (team.confirmed) this.note(team, '工作流已确认')
    await this.save(team)
    if (team.confirmed) await this.startReady(team)
    return team
  }

  /** Persist a draft workflow. Validation happens on confirm, not while editing. */
  async configure(teamId, members) {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    if (team.confirmed) return { ok: false, error: 'workflow-locked' }
    if (team.members.some(member => member.sessionId)) return { ok: false, error: 'workflow-locked' }
    const roster = normalizeRoster(members)
    team.members = roster.map(member => ({
      ...member,
      sessionId: null,
      status: STATUS.pending,
      startedAt: null,
      finishedAt: null,
      summary: '',
      error: null,
      handoff: `handoffs/${member.role}.md`,
      rounds: 0,
      taskSource: null,
      taskUpdatedAt: null,
      taskPending: false,
      tokens: 0,
      taskTurnOpen: false,
      stallResume: false,
      stallRetries: 0,
      resumeKind: null,
      resumeAttempts: 0,
      guardRetries: 0,
      handoffFormat: null,
      handoffVerdict: null,
      blockers: [],
      declaredArtifacts: [],
    }))
    team.verdict = null
    team.verdictRole = null
    this.note(team, `工作流已保存 · ${team.members.length} 位成员`)
    await this.save(team)
    return { ok: true, teamId, members: this.snapshotFor(team).members }
  }

  /** Dry-run the checks a workflow must pass before any Session is created. */
  async preflight(team) {
    const errors = []
    if (!team.brief || team.brief.trim().length < 10) errors.push('brief-empty')
    const structural = validateWorkflow(team.members)
    errors.push(...structural.errors)
    for (const member of team.members) {
      if (!member.task || member.task.trim().length < 4) errors.push('task-empty:' + member.role)
      if (!member.name || !member.name.trim()) errors.push('name-empty:' + member.role)
    }
    let catalog = null
    try { catalog = await this.ctx.sessionController.modelCatalog() } catch (error) { this.log('catalog: ' + error) }
    if (catalog) {
      const routes = new Set()
      for (const group of catalog.groups || []) {
        for (const model of group.models || []) routes.add(group.id + '::' + model.id)
      }
      for (const member of team.members) {
        if (!member.model) continue
        if (!routes.has(member.model.provider + '::' + member.model.model)) {
          errors.push('model-unavailable:' + member.role)
        }
      }
    }
    return { ok: errors.length === 0, errors }
  }

  /** Lock the workflow and let every currently-ready role start. */
  async confirm(teamId) {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    if (team.confirmed) {
      // Idempotent confirm: a confirmed-but-unstarted team (host reload, an
      // interrupted dispatch) must not stay parked forever.
      const started = await this.startReady(team)
      return { ok: true, already: true, started }
    }
    const preflight = await this.preflight(team)
    if (!preflight.ok) return { ok: false, error: 'preflight-failed', details: preflight.errors }
    team.confirmed = true
    team.startedOnce = true
    team.verdict = null
    team.verdictRole = null
    this.note(team, '工作流确认，开始执行')
    await this.save(team)
    const started = await this.startReady(team)
    return { ok: true, teamId, started }
  }

  unmetDeps(team, member) {
    return member.deps.filter(dep => {
      const upstream = team.members.find(item => item.role === dep)
      return !upstream || (upstream.status !== STATUS.done && upstream.status !== STATUS.skipped)
    })
  }

  readyMembers(team) {
    return team.members.filter(member =>
      member.status === STATUS.pending && this.unmetDeps(team, member).length === 0)
  }

  async startReady(team) {
    if (this.budgetExhausted(team)) return []
    if ((team.proposals || []).some(item => item.type === 'assignments' && item.status === 'pending')) return []
    const ready = this.readyMembers(team)
    for (const member of ready) {
      await this.start(team.id, member.role).catch(error => this.log(`start ${member.role}: ${error}`))
    }
    return ready.map(member => member.role)
  }

  /** Create the member session on first use, keep it reusable afterwards. */
  /** Tokens committed by members plus the live turn's unreported usage. */
  teamTokens(team) {
    let total = 0
    for (const member of team.members) {
      total += Math.max(0, Number(member.tokens) || 0)
      if (!member.sessionId) continue
      const live = this.live.get(member.sessionId)
      total += Math.max(0, Number(live && live.tokens) || 0)
    }
    return total
  }

  budgetLimit(team) {
    const limit = Number(team.budget && team.budget.limit)
    return Number.isFinite(limit) && limit > 0 ? limit : 0
  }

  budgetExhausted(team) {
    const limit = this.budgetLimit(team)
    return limit > 0 && this.teamTokens(team) >= limit
  }

  /** Record the 80% / 100% crossings once; the panel derives its own state. */
  budgetTick(team) {
    const limit = this.budgetLimit(team)
    if (limit <= 0) return
    team.budget = team.budget || { limit }
    const used = this.teamTokens(team)
    if (used >= limit) {
      if (!team.budget.exhaustedAt) {
        team.budget.exhaustedAt = nowStamp()
        this.audit(team, '系统', 'budget', null, '预算用尽：' + used + ' / ' + limit)
        this.note(team, '预算用尽，暂停派发新任务')
        this.notify(team, 'budget', '预算用尽：' + used + ' / ' + limit)
      }
    } else if (used >= limit * BUDGET_WARN_RATIO) {
      if (!team.budget.warnedAt) {
        team.budget.warnedAt = nowStamp()
        this.audit(team, '系统', 'budget', null, '预算已用 80%：' + used + ' / ' + limit)
        this.note(team, '预算已用 80%')
      }
    }
  }

  /** Move the live turn's usage into the member record. */
  applyUsage(team, member, sessionId) {
    const live = this.live.get(sessionId)
    if (live) {
      const delta = Math.max(0, Number(live.tokens) || 0)
      if (delta > 0) {
        member.tokens = (Number(member.tokens) || 0) + delta
        live.tokens = 0
        this.live.set(sessionId, live)
      }
    }
    this.budgetTick(team)
  }

  /** Change the team budget; raising it clears the warn/exhausted markers. */
  async setBudget(teamId, limit, actor = '用户') {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    const value = limit === null || limit === undefined || limit === ''
      ? 0
      : Number(limit)
    if (!Number.isFinite(value) || value < 0) return { ok: false, error: 'invalid-budget' }
    team.budget = { limit: value, warnedAt: null, exhaustedAt: null }
    this.audit(team, actor, 'budget', null, value > 0 ? '预算设为 ' + value : '取消预算上限')
    this.budgetTick(team)
    await this.save(team)
    return { ok: true, budget: team.budget, used: this.teamTokens(team) }
  }

  /** Append one persistent inbox entry (survives reloads; no OS push). */
  notify(team, kind, text) {
    team.notifications = Array.isArray(team.notifications) ? team.notifications : []
    team.notifications.push({
      id: 'n-' + randomUUID().slice(0, 8),
      t: nowStamp(),
      kind: String(kind || 'info'),
      text: String(text || '').slice(0, 300),
      readAt: null,
    })
    if (team.notifications.length > 30) team.notifications.splice(0, team.notifications.length - 30)
  }

  /** Mark every inbox entry read. */
  async readNotifications(teamId) {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    const now = nowStamp()
    for (const item of team.notifications || []) {
      if (!item.readAt) item.readAt = now
    }
    await this.save(team)
    return { ok: true, unread: 0 }
  }

  /** Append one structured action record the panel can verify. */
  audit(team, actor, action, target, summary) {
    team.audit = Array.isArray(team.audit) ? team.audit : []
    team.audit.push({
      t: nowStamp(),
      actor: String(actor || '系统').slice(0, 40),
      action: String(action || ''),
      target: target ? String(target).slice(0, 40) : null,
      summary: String(summary || '').slice(0, 240),
    })
    if (team.audit.length > 40) team.audit.splice(0, team.audit.length - 40)
  }

  /** Resolve the team member behind one live Agent id, if it is one. */
  async memberActor(agentId) {
    if (!agentId) return null
    const owner = this.bySession.get(agentId)
    if (!owner) return null
    const team = await this.load(owner.teamId)
    const member = team && team.members.find(item => item.role === owner.role)
    return member ? { teamId: team.id, role: member.role, name: member.name } : null
  }

  /** Member-initiated changes become proposals; only the user executes them. */
  async propose(team, actor, action, payload) {
    const target = payload?.role
      ? team.members.find(member => member.role === payload.role)
      : null
    team.proposals = Array.isArray(team.proposals) ? team.proposals : []
    const proposal = {
      id: 'p-' + randomUUID().slice(0, 8),
      type: action,
      from: String(actor || '成员').slice(0, 40),
      role: payload?.role ? String(payload.role) : null,
      target: target ? target.name : (payload?.role ? String(payload.role) : null),
      task: payload?.task ? String(payload.task).trim().slice(0, 2000) : null,
      note: payload?.note ? String(payload.note).trim().slice(0, 2000) : null,
      reason: String(payload?.reason || '').trim().slice(0, 600),
      status: 'pending',
      createdAt: nowStamp(),
      decidedAt: null,
      decidedBy: null,
      result: null,
    }
    proposal.base = target
      ? {
        task: target.task,
        status: target.status,
        deps: target.deps.slice(),
        depsDone: target.deps.every(dep => {
          const upstream = team.members.find(member => member.role === dep)
          return Boolean(upstream && upstream.status === STATUS.done)
        }),
      }
      : { status: null }
    proposal.teamVerdict = team.verdict || null
    team.proposals.push(proposal)
    if (team.proposals.length > 20) team.proposals.splice(0, team.proposals.length - 20)
    const summary = [proposal.target || '全局', proposal.task || proposal.note || ''].filter(Boolean).join(' · ')
    this.audit(team, proposal.from, 'propose', proposal.target, (action + '：' + summary).slice(0, 220))
    this.note(team, proposal.from + ' 提交提案，等待批准')
    this.notify(team, 'proposal', proposal.from + ' 提交提案：' + summary)
    await this.save(team)
    return {
      ok: true,
      pending: true,
      proposalId: proposal.id,
      proposal,
      hint: '提案已排队，等用户在面板批准后才会执行。先向用户说明你提了什么；批准/驳回结果会自动通知你。',
    }
  }

  /** Approve or reject one pending proposal, then run it on approval. */
  async decideProposal(teamId, proposalId, decision) {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    team.proposals = Array.isArray(team.proposals) ? team.proposals : []
    const proposal = team.proposals.find(item => item.id === proposalId)
    if (!proposal) return { ok: false, error: 'proposal-not-found' }
    if (proposal.status !== 'pending') return { ok: false, error: 'proposal-done', status: proposal.status }
    if (nowStamp() - proposal.createdAt > PROPOSAL_TTL_MS) {
      proposal.status = 'expired'
      proposal.decidedAt = nowStamp()
      proposal.decidedBy = '系统'
      await this.save(team)
      return { ok: false, error: 'proposal-expired' }
    }
    proposal.decidedAt = nowStamp()
    proposal.decidedBy = '用户'
    if (decision === 'approve') {
      const conflicts = this.proposalConflicts(team, proposal)
      if (conflicts.length > 0) {
        proposal.status = 'stale'
        proposal.conflict = conflicts
        proposal.decidedBy = '系统'
        this.audit(team, '系统', 'stale', proposal.target, conflicts.join(' / '))
        this.note(team, '提案已过期（状态变化）：' + conflicts.join(' / '))
        await this.save(team)
        await this.notifyCaptain(team, proposal, 'stale')
        return { ok: false, error: 'proposal-stale', conflicts, proposal }
      }
    }
    if (decision === 'reject') {
      proposal.status = 'rejected'
      this.audit(team, '用户', 'reject', proposal.target, proposal.type + ' 提案被驳回')
      this.note(team, '用户驳回 ' + proposal.from + ' 的提案')
      await this.save(team)
      if (team.auto) await this.startReady(team)
      await this.notifyCaptain(team, proposal, 'rejected')
      return { ok: true, proposal }
    }
    proposal.status = 'approved'
    await this.save(team)
    let result
    try {
      result = await this.executeProposal(team, proposal)
    } catch (error) {
      result = { ok: false, error: String(error && error.message ? error.message : error) }
    }
    if (result && result.ok === false) {
      proposal.status = 'failed'
      proposal.result = String(result.error || 'failed').slice(0, 300)
      this.audit(team, '用户', 'approve', proposal.target, '批准后执行失败：' + proposal.result)
    } else {
      proposal.result = 'done'
      this.audit(team, '用户', 'approve', proposal.target, proposal.type + ' 提案已执行')
    }
    await this.save(team)
    await this.notifyCaptain(team, proposal, result && result.ok === false ? 'failed' : 'approved')
    return { ok: true, proposal, result }
  }

  /** Adjust a pending proposal before approval; only the user does this. */
  async editProposal(teamId, proposalId, patch, actor = '用户') {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    team.proposals = Array.isArray(team.proposals) ? team.proposals : []
    const proposal = team.proposals.find(item => item.id === proposalId)
    if (!proposal) return { ok: false, error: 'proposal-not-found' }
    if (proposal.status !== 'pending') return { ok: false, error: 'proposal-done', status: proposal.status }
    if (proposal.type === 'assignments') return { ok: false, error: 'assignments-not-editable' }
    if (nowStamp() - proposal.createdAt > PROPOSAL_TTL_MS) {
      proposal.status = 'expired'
      proposal.decidedAt = nowStamp()
      proposal.decidedBy = '系统'
      await this.save(team)
      return { ok: false, error: 'proposal-expired' }
    }
    if (typeof patch?.task === 'string') proposal.task = patch.task.trim().slice(0, 2000) || null
    if (typeof patch?.note === 'string') proposal.note = patch.note.trim().slice(0, 2000) || null
    if (typeof patch?.reason === 'string') proposal.reason = patch.reason.trim().slice(0, 600)
    proposal.editedAt = nowStamp()
    proposal.editedBy = String(actor || '用户').slice(0, 40)
    this.audit(team, actor, 'edit', proposal.target, proposal.type + ' 提案已修改')
    await this.save(team)
    return { ok: true, proposal }
  }

  /** Turn the captain's task book into one batch proposal for the user. */
  async proposeAssignments(team, captain) {
    let planText = null
    let hasPlan = false
    try {
      planText = await readFile(join(team.root, 'artifacts', 'captain', 'plan.md'), 'utf8')
      hasPlan = true
    } catch { /* no plan file */ }
    let handoffText = null
    try { handoffText = await readFile(join(team.root, captain.handoff), 'utf8') } catch { /* optional */ }

    const source = planText || handoffText || ''
    const detailed = parseAssignmentsDetailed(source)
    const warnings = detailed.warnings.slice()
    if (hasPlan && !/<!--\s*competition-team-assignments/i.test(source)) warnings.push('no-block')

    const changes = []
    const seen = new Set()
    for (const item of detailed.assignments) {
      if (seen.has(item.role)) continue
      seen.add(item.role)
      const member = team.members.find(entry => entry.role === item.role)
      if (!member || member.kind === 'captain') {
        warnings.push('unknown-role:' + item.role)
        continue
      }
      if (member.task === item.task) continue
      changes.push({ role: member.role, name: member.name, task: item.task, oldTask: member.task })
    }

    team.assignmentCheck = {
      at: nowStamp(),
      hasPlan,
      parsed: detailed.assignments.length,
      changed: changes.length,
      warnings: warnings.slice(0, 20),
    }
    if (warnings.length > 0) {
      this.audit(team, '系统', 'assignment-warning', '全队', warnings.join(' / ').slice(0, 240))
      this.note(team, '任务书有 ' + warnings.length + ' 处问题'
        + (changes.length > 0 ? '，仍提交 ' + changes.length + ' 位成员' : ''))
    }
    if (changes.length === 0) return null

    team.proposals = Array.isArray(team.proposals) ? team.proposals : []
    const pending = team.proposals.find(item => item.type === 'assignments' && item.status === 'pending')
    if (pending) {
      pending.assignments = changes
      pending.createdAt = nowStamp()
      pending.editedAt = nowStamp()
      this.audit(team, captain.name, 'propose', '全队', '任务书更新（覆盖待批）')
      this.note(team, captain.name + ' 更新了待批的任务书')
      return pending
    }
    const proposal = {
      id: 'p-' + randomUUID().slice(0, 8),
      type: 'assignments',
      from: captain.name,
      role: null,
      target: '全队',
      task: null,
      note: '批准后整队任务按队长任务书更新',
      reason: '队长根据题目动态分配',
      assignments: changes,
      status: 'pending',
      createdAt: nowStamp(),
      decidedAt: null,
      decidedBy: null,
      result: null,
    }
    team.proposals.push(proposal)
    if (team.proposals.length > 20) team.proposals.splice(0, team.proposals.length - 20)
    this.audit(team, captain.name, 'propose', '全队', '任务书：' + changes.map(item => item.role).join('、'))
    this.note(team, captain.name + ' 提交任务书，等待批准')
    this.notify(team, 'assignments', '任务书待批：' + changes.length + ' 位成员')
    return proposal
  }

  async applyAssignments(team, proposal) {
    const applied = []
    for (const item of proposal.assignments || []) {
      const member = team.members.find(entry => entry.role === item.role)
      if (!member || member.kind === 'captain') continue
      member.task = item.task
      member.taskSource = 'captain'
      member.taskUpdatedAt = nowStamp()
      member.taskPending = member.status === STATUS.running || member.taskTurnOpen
      applied.push(member.role)
    }
    if (applied.length === 0) return { ok: false, error: 'no-assignments' }
    this.audit(team, '用户', 'assign', '全队', '按任务书更新：' + applied.join('、'))
    this.note(team, '任务书生效：' + applied.join('、'))
    await this.save(team)
    if (team.auto) await this.startReady(team)
    return { ok: true, applied }
  }

  /** A proposal becomes stale when the state it was built on has changed. */
  proposalConflicts(team, proposal) {
    const conflicts = []
    const target = proposal.role
      ? team.members.find(member => member.role === proposal.role)
      : null
    if (proposal.role && !target) conflicts.push('target-missing')
    const base = proposal.base || {}
    if (target) {
      if ((proposal.type === 'dispatch' || proposal.type === 'message')
        && typeof base.task === 'string' && target.task !== base.task) {
        conflicts.push('task-changed')
      }
      if (proposal.type === 'start' && target.status !== STATUS.pending) {
        conflicts.push('not-pending')
      }
      if (proposal.type === 'stop' && target.status !== STATUS.running) {
        conflicts.push('member-idle')
      }
      if (proposal.type === 'dispatch' || proposal.type === 'start') {
        const depsDone = target.deps.every(dep => {
          const upstream = team.members.find(member => member.role === dep)
          return Boolean(upstream && upstream.status === STATUS.done)
        })
        if (depsDone !== base.depsDone) conflicts.push('deps-changed')
      }
    }
    if (proposal.type === 'revise' && proposal.teamVerdict !== team.verdict) {
      conflicts.push('verdict-changed')
    }
    return conflicts
  }

  /** Tell the captain what the user decided, so it stops waiting and does not re-propose. */
  async notifyCaptain(team, proposal, outcome) {
    const captain = team.members.find(member => member.kind === 'captain')
    if (!captain || !captain.sessionId) return
    const label = outcome === 'approved'
      ? '已批准并执行'
      : outcome === 'failed'
        ? '已批准，但执行失败'
        : outcome === 'rejected' ? '已驳回'
          : outcome === 'stale' ? '已过期（状态已变化，未执行）'
            : String(outcome)
    const detail = proposal.result && proposal.result !== 'done' ? '（' + proposal.result + '）' : ''
    const text = '【提案结果】' + proposal.type + ' → ' + (proposal.target || '全局') + '：' + label + detail
      + '\n你不需要重复提交同一提案；如需跟进，先用 competition_team action=status 看最新状态。'
    this.captainBusy.set(team.id, true)
    this.audit(team, '系统', 'notify', captain.name, label + ' · ' + proposal.id)
    await this.save(team)
    try {
      await this.promptSession(captain.sessionId, text)
    } catch (error) {
      this.captainBusy.delete(team.id)
      this.log('notify captain: ' + error)
    }
  }

  async executeProposal(team, proposal) {
    const role = proposal.role || ''
    if (proposal.type === 'dispatch') {
      return this.dispatch(team.id, role, {
        task: proposal.task || undefined,
        note: proposal.note || '',
        actor: '用户',
      })
    }
    if (proposal.type === 'message') {
      return this.message(team.id, role, proposal.note || proposal.task || '', '用户')
    }
    if (proposal.type === 'assignments') return this.applyAssignments(team, proposal)
    if (proposal.type === 'revise') return this.revise(team.id, '用户')
    if (proposal.type === 'start') return this.start(team.id, role, '用户')
    if (proposal.type === 'stop') return this.stop(team.id, role, '用户')
    return { ok: false, error: 'unknown-proposal-type' }
  }

  /** Resolve the member display name behind one live Agent id. */
  async actorName(agentId) {
    if (!agentId) return null
    const owner = this.bySession.get(agentId)
    if (!owner) return null
    const team = await this.load(owner.teamId)
    const member = team && team.members.find(item => item.role === owner.role)
    return member ? member.name : null
  }

  /** Debounce user feedback so a burst becomes one captain turn. */
  scheduleFeedback(teamId, delay) {
    const existing = this.feedbackTimers.get(teamId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.feedbackTimers.delete(teamId)
      this.flushFeedback(teamId).catch(error => this.log('feedback flush: ' + error))
    }, typeof delay === 'number' ? delay : FEEDBACK_DEBOUNCE_MS)
    if (typeof timer.unref === 'function') timer.unref()
    this.feedbackTimers.set(teamId, timer)
  }

  /** Send every queued opinion as one turn, unless the captain is still busy. */
  async flushFeedback(teamId) {
    const team = await this.load(teamId)
    if (!team) return
    const queue = Array.isArray(team.feedbackQueue) ? team.feedbackQueue : []
    if (queue.length === 0) return
    const captain = team.members.find(member => member.kind === 'captain')
    if (!captain || !captain.sessionId) return
    if (captain.taskTurnOpen || this.captainBusy.get(teamId)) {
      this.scheduleFeedback(teamId, 5000)
      return
    }
    const items = queue.slice()
    team.feedbackQueue = []
    // Record every opinion for the panel; the merged prompt itself is
    // filtered out by its 【用户意见 marker.
    team.feedback = Array.isArray(team.feedback) ? team.feedback : []
    for (const item of items) team.feedback.push({ t: item.t, text: item.text })
    if (team.feedback.length > 20) team.feedback.splice(0, team.feedback.length - 20)
    const body = items.length === 1
      ? items[0].text
      : items.map((item, index) => (index + 1) + '. ' + item.text).join('\n')
        + '\n请按队长协议逐条处理，必要时派活。'
    const text = '【用户意见】\n' + body
    this.captainBusy.set(teamId, true)
    this.audit(team, items.map(item => item.actor || '用户').filter((value, index, all) => all.indexOf(value) === index).join('、'), 'feedback', captain.name, items.map(item => item.text).join(' / '))
    await this.save(team)
    try {
      await this.promptSession(captain.sessionId, text)
    } catch (error) {
      this.captainBusy.delete(teamId)
      this.log('feedback prompt: ' + error)
    }
  }

  /** Mark a running member whose activity went silent; it recovers on the next event. */
  async watchdog() {
    const teams = await this.loadAll()
    let handled = 0
    for (const team of teams) {
      for (const member of team.members) {
        if (member.status !== STATUS.running || !member.taskTurnOpen) continue
        const live = member.sessionId ? this.live.get(member.sessionId) : undefined
        const last = (live && live.at) || member.startedAt || team.updatedAt || nowStamp()
        if (nowStamp() - last <= STALL_MS) continue
        handled += 1
        if (this.budgetExhausted(team)) {
          await this.failStalled(team, member, '预算用尽，不再自动重试')
          continue
        }
        if ((member.stallRetries || 0) < 1) {
          await this.recoverStalled(team, member)
        } else {
          await this.failStalled(team, member, '自动重试后仍无响应')
        }
      }
    }
    return handled
  }

  /** Cancel a silent turn and start it once more with a resume note. */
  async recoverStalled(team, member) {
    member.stallRetries = (member.stallRetries || 0) + 1
    member.status = STATUS.pending
    member.taskTurnOpen = false
    member.stallResume = true
    member.finishedAt = null
    member.error = null
    if (member.sessionId) {
      this.stalled.delete(member.sessionId)
      const agent = this.ctx.agents.get(member.sessionId)
      if (agent && typeof agent.cancel === 'function') {
        try { agent.cancel('stalled') } catch (error) { this.log('cancel stalled: ' + error) }
      }
      this.retireLive(member.sessionId)
    }
    this.note(team, member.name + ' 长时间无响应，自动重试一次')
    this.audit(team, '系统', 'stall', member.name, '自动重试')
    await this.save(team)
    const result = await this.start(team.id, member.role, '系统（停滞恢复）', {
      keepStallRetries: true,
      keepVerdict: true,
    }).catch(error => ({ ok: false, error: String(error && error.message ? error.message : error) }))
    if (result && result.ok === false) {
      await this.failStalled(team, member, '自动重试没有发起：' + String(result.error || ''))
    }
    return result
  }

  async failStalled(team, member, detail) {
    member.status = STATUS.failed
    member.error = 'stalled'
    member.taskTurnOpen = false
    member.finishedAt = nowStamp()
    if (member.sessionId) this.retireLive(member.sessionId)
    this.note(team, member.name + ' 停滞未恢复：' + detail)
    this.notify(team, 'stalled', member.name + ' 停滞未恢复：' + detail)
    this.audit(team, '系统', 'stall', member.name, '停滞未恢复：' + detail)
    this.propagateUpstreamFailure(team, member.role)
    await this.save(team)
  }

  /** Skip a member: downstream keeps going and its prompt says so. */
  async skip(teamId, role, actor = '用户') {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    const member = team.members.find(item => item.role === role)
    if (!member) return { ok: false, error: 'role-not-found' }
    if (member.status === STATUS.running && member.sessionId) {
      const agent = this.ctx.agents.get(member.sessionId)
      if (agent && typeof agent.cancel === 'function') {
        try { agent.cancel('skipped') } catch (error) { this.log('cancel skipped: ' + error) }
      }
    }
    member.status = STATUS.skipped
    member.taskTurnOpen = false
    member.stallResume = false
    member.finishedAt = nowStamp()
    if (member.sessionId) this.retireLive(member.sessionId)
    this.audit(team, actor, 'skip', member.name, '用户跳过该成员')
    this.note(team, '跳过 ' + member.name + '（下游按现有产物继续）')
    this.unblockDependents(team, member.role)
    await this.save(team)
    if (team.auto) await this.startReady(team)
    return { ok: true, skipped: member.role }
  }

  /** Keep the recent-activity ring after a turn so the panel can still show it. */
  retireLive(sessionId) {
    const live = this.live.get(sessionId)
    if (!live) return
    live.progress = ''
    live.tool = null
    live.at = nowStamp()
    this.live.set(sessionId, live)
  }

  /** Send one plain text turn into a member Session. */
  async promptSession(sessionId, text) {
    await this.ctx.sessionController.prompt({
      requestId: 'competition-' + randomUUID(),
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: String(text) }],
    }, new AbortController().signal)
  }

  async ensureSession(team, member) {
    // Reuse the recorded Session even when it is cold: `prompt` resumes it.
    // Creating a fresh one here would silently split a member's conversation.
    if (member.sessionId) return member.sessionId
    // Join the existing project record so the member Session lands under the
    // same sidebar group as the rest of the workspace instead of "Ungrouped".
    let target = { cwd: team.cwd }
    try {
      const registry = this.ctx.workspaceRegistry
      if (registry && typeof registry.resolveByPath === 'function') {
        const workspace = await registry.resolveByPath(team.cwd)
        if (workspace) target = { workspaceId: workspace.id }
      }
    } catch (error) {
      this.log(`workspace lookup: ${error}`)
    }
    const created = await this.ctx.sessionController.create(target)
    member.sessionId = created.sessionId
    this.bySession.set(member.sessionId, { teamId: team.id, role: member.role })
    if (member.kind === 'captain') this.captainBySession.set(member.sessionId, team.id)
    try {
      await this.ctx.sessionController.rename({
        sessionId: member.sessionId,
        title: `[${team.title}] ${member.name}`,
      })
    } catch (error) {
      this.log(`rename ${member.role}: ${error}`)
    }
    if (member.readOnly) {
      try {
        const session = this.ctx.sessions.get(member.sessionId)
        if (session) {
          // Same durable knob events the permission presets write. Appending
          // here keeps the plugin free of extra package imports and applies
          // after the creation-time default pin.
          session.append('sandbox/mode', { mode: 'read-only' })
          session.append('approval/policy', { policy: 'never' })
          member.readOnlyApplied = true
        }
      } catch (error) {
        member.readOnlyApplied = false
        this.log('read-only ' + member.role + ': ' + error)
      }
    }
    if (member.model && member.model.provider && member.model.model) {
      try {
        await this.ctx.sessionController.selectModel({
          sessionId: member.sessionId,
          provider: member.model.provider,
          model: member.model.model,
          ...(member.model.reasoningEffort ? { reasoningEffort: member.model.reasoningEffort } : {}),
        })
      } catch (error) {
        this.log(`model ${member.role}: ${error}`)
      }
    }
    return member.sessionId
  }

  buildPrompt(team, member) {
    const lines = []
    lines.push(`【竞赛智队 · ${member.name}】`)
    lines.push(`队伍：${team.title}`)
    lines.push(`共享工作目录：${team.root}`)
    lines.push(`题目与总目标：${join(team.root, 'brief.md')}（开工前先读）`)
    lines.push(`你的任务：${member.task}`)
    if (member.kind !== 'captain') {
      lines.push('你的直属上级是队长：所有成员都直接向队长汇报，不需要层层转达。')
      lines.push(`开工前先读队长的任务书：${join(team.root, 'artifacts', 'captain', 'plan.md')}（属于你的那一段）。`)
      lines.push('任务书和你的固定任务冲突时，以队长任务书为准，并在交接里说明。')
    }
    if (member.stallResume) {
      lines.push('【停滞恢复】上一轮长时间没有响应，已被取消并重发。请继续完成原任务；如果确实无法继续，把交接元数据里的 status 写成 "blocked" 并说明原因。')
    }
    if (member.retryKind === 'transient') {
      lines.push('【网络重试】上一轮因临时错误中断（不是你的问题）。请继续完成原任务；已经落盘的产物不用重写。')
    }
    if (member.resumeKind === 'interrupted') {
      lines.push('【中断恢复】宿主重启打断了上一轮。请继续完成原任务；已经落盘的产物不用重写，如果确实无法继续，把交接元数据里的 status 写成 "blocked" 并说明原因。')
    }
    lines.push('')
    lines.push('=== 交接协议 ===')
    lines.push('1. 开工前先读前序交接文件（存在才读）：')
    const upstream = team.members.filter(other => member.deps.includes(other.role))
    if (upstream.length === 0) {
      lines.push('   （你是第一位，没有前序交接）')
    } else {
      for (const other of upstream) {
        lines.push(other.status === STATUS.skipped
          ? `   - ${other.name}（已跳过，没有交接；按现有产物继续）`
          : `   - ${join(team.root, other.handoff)}（${other.name}）`)
      }
    }
    lines.push(`2. 你的产物一律写进 ${join(team.root, 'artifacts', member.role)}/，文件名用英文。`)
    lines.push(`3. 结束时必须写交接文件 ${join(team.root, member.handoff)}，第一行是结构化元数据块，然后才是正文：`)
    lines.push('   <!-- competition-team')
    lines.push('   {"role":"' + member.role + '","status":"done","artifacts":["artifacts/' + member.role + '/<真实文件名>"],"verdict":null,"blockers":[]}')
    lines.push('   -->')
    lines.push(`   # ${member.name} 交接`)
    lines.push('   ## 结论（3-5 行）')
    lines.push('   ## 关键产出（文件路径 + 一句话说明）')
    lines.push('   ## 给下游的要求')
    lines.push('   ## 风险/待确认')
    lines.push('   元数据里的 artifacts 必须是你真实写出的文件；写不出来就把 status 改成 "blocked" 并在 blockers 说明原因。')
    lines.push('4. 最后一条回复用 5-8 行向队长汇报：完成情况、关键结论、产出路径、下游注意事项。')
    lines.push('5. 不要修改其他角色的产物；需要返工时在交接里写清楚。')
    if (member.kind === 'captain') {
      lines.push('')
      lines.push('=== 队长频道 ===')
      lines.push('你是所有成员的直属上级：读题后直接把每个人的任务写进 plan.md，让他们各自读任务书开工，不要层层转达。')
      lines.push('plan.md 里每个成员单独一段：目标、需要什么输入、交付什么、依赖谁、验收口径。')
      lines.push('并在 plan.md 末尾附一段机器可读的任务书（角色 id 用画布上的 role），插件会据此生成待批提案：')
      lines.push('<!-- competition-team-assignments')
      lines.push('[{"role":"core-a","task":"给核心 A 的具体任务"},{"role":"member-a","task":"给论文手的具体任务"}]')
      lines.push('-->')
      lines.push('同时你是这支队伍对用户的门面：用户会直接在这个会话里提意见。')
      lines.push('收到意见时按这个顺序处理：')
      lines.push('1. 先读上下文：competition_team action=status 看全局，action=read 读相关成员的结果；')
      lines.push('2. 再决策：用 action=dispatch 给某位成员派/改任务（task + note），用 action=message 追加一句指令，用 action=revise 让判定角色返工；')
      lines.push('3. 最后用 2-4 行回报你改了什么、谁在做什么、下一步等谁。')
      lines.push('不要替成员写产物，也不要在没有依据时替他们下结论。')
    }
    if (member.kind === 'captain') {
      lines.push('6. 你是总指挥：先读 brief，把任务拆给下游并收紧口径；不要替下游写他们的产物。')
    } else if (member.kind === 'core') {
      lines.push('6. 你是二级大脑：为本环节定方法与判断，给下游可执行的结论和口径，别只给过程。')
    }
    if (member.readOnly) {
      lines.push('6. 你以只读权限运行：不要写任何文件、不要修改他人产物。把交接元数据块和审核结论直接放进最后一条回复，插件会替你落盘。')
    }
    if (/审核|review/i.test(`${member.name}${member.role}`)) {
      lines.push('7. 逐项核对上游产物，最后一行必须是「结论：通过」或「结论：需返工」。')
    }
    return lines.join('\n')
  }

  async start(teamId, role, actor = '用户', options = {}) {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    if (!team.confirmed) return { ok: false, error: 'workflow-not-confirmed' }
    const member = team.members.find(item => item.role === role)
    if (!member) return { ok: false, error: 'role-not-found' }
    if (member.status === STATUS.running) return { ok: true, already: true }
    const unmet = this.unmetDeps(team, member)
    if (unmet.length > 0) {
      return { ok: false, error: 'deps-unmet', unmet }
    }
    if (this.budgetExhausted(team)) {
      return { ok: false, error: 'budget-exhausted', used: this.teamTokens(team), limit: this.budgetLimit(team) }
    }
    const sessionId = await this.ensureSession(team, member)
    const prompt = this.buildPrompt(team, member)
    member.stallResume = false
    member.resumeKind = null
    member.taskPending = false
    member.qualityWarnings = []
    member.errorDetail = null
    member.retryKind = null
    member.retryAt = null
    if (!options.keepRetryAttempts) member.retryAttempts = 0
    member.guardRetries = 0
    member.taskTurnOpen = true
    member.status = STATUS.running
    if (!options.keepStallRetries) member.stallRetries = 0
    if (!options.keepResumeAttempts) member.resumeAttempts = 0
    if (!options.keepVerdict) team.verdict = null
    if (member.kind === 'captain') this.captainBusy.set(team.id, true)
    this.audit(team, actor, 'start', member.name, '开始执行本轮任务')
    member.startedAt = nowStamp()
    member.finishedAt = null
    member.error = null
    member.rounds += 1
    this.unblockDependents(team, member.role)
    this.live.set(sessionId, {
      progress: '已派发，等待模型开工…', tool: null, at: nowStamp(), recent: [],
      captain: member.kind === 'captain',
    })
    this.note(team, `${member.name} 开工`)
    await this.save(team)
    try {
      await this.ctx.sessionController.prompt({
        requestId: `competition-${randomUUID()}`,
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: prompt }],
      }, new AbortController().signal)
    } catch (error) {
      member.taskTurnOpen = false
      const message = String(error && error.message ? error.message : error)
      await this.handleFailure(team, member, error, '派发失败')
      return { ok: false, error: message }
    }
    return { ok: true, teamId, role, sessionId }
  }

  async stop(teamId, role, actor = '用户') {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    const member = team.members.find(item => item.role === role)
    if (!member || !member.sessionId) return { ok: false, error: 'no-session' }
    this.applyUsage(team, member, member.sessionId)
    const agent = this.ctx.agents.get(member.sessionId)
    if (agent) {
      try { agent.cancel('user') } catch (error) { this.log(`cancel: ${error}`) }
    }
    member.status = STATUS.stopped
    member.taskTurnOpen = false
    member.finishedAt = nowStamp()
    this.retireLive(member.sessionId)
    if (member.kind === 'captain') this.captainBusy.delete(team.id)
    this.audit(team, actor, 'stop', member.name, '停止该成员')
    this.note(team, `${member.name} 被停止`)
    await this.save(team)
    return { ok: true }
  }

  async message(teamId, role, text, actor = '用户') {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    const member = team.members.find(item => item.role === role)
    if (!member) return { ok: false, error: 'role-not-found' }
    const unmet = this.unmetDeps(team, member)
    if (unmet.length > 0) return { ok: false, error: 'deps-unmet', unmet }
    if (this.budgetExhausted(team)) {
      return { ok: false, error: 'budget-exhausted', used: this.teamTokens(team), limit: this.budgetLimit(team) }
    }
    const sessionId = await this.ensureSession(team, member)
    await this.ctx.sessionController.prompt({
      requestId: `competition-${randomUUID()}`,
      sessionId,
      mode: 'queue',
      content: [{ type: 'text', text: String(text || '').slice(0, 8000) }],
    }, new AbortController().signal)
    if (member.status === STATUS.done || member.status === STATUS.failed || member.status === STATUS.stopped) {
      member.status = STATUS.running
      member.startedAt = nowStamp()
      member.finishedAt = null
      member.error = null
    }
    member.taskTurnOpen = true
    if (member.kind === 'captain') this.captainBusy.set(team.id, true)
    this.live.set(sessionId, {
      progress: '已收到追加指令…', tool: null, at: nowStamp(), recent: [],
      captain: member.kind === 'captain',
    })
    this.audit(team, actor, 'message', member.name, String(text || '').slice(0, 160))
    this.note(team, `给 ${member.name} 追加指令`)
    await this.save(team)
    return { ok: true, sessionId }
  }

  /** The captain's dispatch: update one member's task and start it. */
  async dispatch(teamId, role, options) {
    const team = await this.load(teamId)
    const actor = options?.actor || '用户'
    if (!team) return { ok: false, error: 'team-not-found' }
    if (!team.confirmed) return { ok: false, error: 'workflow-not-confirmed' }
    const member = team.members.find(item => item.role === role)
    if (!member) return { ok: false, error: 'role-not-found' }
    const unmet = this.unmetDeps(team, member)
    if (unmet.length > 0) return { ok: false, error: 'deps-unmet', unmet }
    if (typeof options?.task === 'string' && options.task.trim()) {
      member.task = options.task.trim().slice(0, 4000)
    }
    const note = typeof options?.note === 'string' ? options.note.trim().slice(0, 4000) : ''
    if (this.budgetExhausted(team)) {
      return { ok: false, error: 'budget-exhausted', used: this.teamTokens(team), limit: this.budgetLimit(team) }
    }
    const sessionId = await this.ensureSession(team, member)
    const prompt = [
      '【队长派活 · ' + member.name + '】',
      '你的任务已更新为：' + member.task,
      note ? '队长补充：' + note : '',
      '按交接协议完成：产物写进 ' + join(team.root, 'artifacts', member.role) + '/，交接写进 ' + join(team.root, member.handoff) + '（首行是结构化元数据块）。',
      '完成后用 5-8 行向队长汇报。',
    ].filter(Boolean).join('\n')
    member.status = STATUS.running
    member.taskTurnOpen = true
    member.startedAt = nowStamp()
    member.finishedAt = null
    member.error = null
    member.blockers = []
    member.guardRetries = 0
    this.live.set(sessionId, {
      progress: '队长已派活，等待开工…', tool: null, at: nowStamp(), recent: [],
      captain: member.kind === 'captain',
    })
    this.audit(team, actor, 'dispatch', member.name, member.task.slice(0, 160))
    this.note(team, '队长给 ' + member.name + ' 派活')
    await this.save(team)
    try {
      await this.promptSession(sessionId, prompt)
    } catch (error) {
      member.taskTurnOpen = false
      const message = String(error && error.message ? error.message : error)
      await this.handleFailure(team, member, error, '派活失败')
      return { ok: false, error: message }
    }
    return { ok: true, teamId, role, sessionId }
  }

  /** Queue a user's opinion; a burst becomes one merged captain turn. */
  async feedback(teamId, text, actor = '用户') {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    if (!team.confirmed) return { ok: false, error: 'workflow-not-confirmed' }
    const captain = team.members.find(member => member.kind === 'captain')
    if (!captain) return { ok: false, error: 'no-captain' }
    if (!captain.sessionId) return { ok: false, error: 'captain-not-started' }
    if (this.budgetExhausted(team)) {
      return { ok: false, error: 'budget-exhausted', used: this.teamTokens(team), limit: this.budgetLimit(team) }
    }
    const trimmed = String(text || '').trim().slice(0, 4000)
    if (!trimmed) return { ok: false, error: 'empty' }
    team.feedbackQueue = Array.isArray(team.feedbackQueue) ? team.feedbackQueue : []
    team.feedbackQueue.push({ t: nowStamp(), text: trimmed, actor: String(actor || '用户').slice(0, 40) })
    if (team.feedbackQueue.length > 20) team.feedbackQueue.splice(0, team.feedbackQueue.length - 20)
    this.note(team, '用户向队长提出意见（排队中）')
    await this.save(team)
    this.scheduleFeedback(teamId)
    return {
      ok: true,
      teamId,
      queued: team.feedbackQueue.length,
      sessionId: captain.sessionId,
    }
  }

  async remove(teamId, options) {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    if (options && options.archiveSessions) {
      for (const member of team.members) {
        if (!member.sessionId) continue
        try {
          await this.ctx.workspaceRegistry.archiveSession(member.sessionId)
        } catch (error) {
          this.log('archive ' + member.role + ': ' + error)
        }
      }
    }
    this.index = this.index.filter(item => item.id !== teamId)
    this.teams.delete(teamId)
    for (const member of team.members) {
      if (!member.sessionId) continue
      this.bySession.delete(member.sessionId)
      this.captainBySession.delete(member.sessionId)
    }
    await this.saveIndex()
    return { ok: true }
  }

  async setAuto(teamId, auto, actor = '用户') {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    team.auto = Boolean(auto)
    this.audit(team, actor, 'setAuto', null, team.auto ? '开启自动接力' : '关闭自动接力')
    await this.save(team)
    if (team.auto) await this.startReady(team)
    return { ok: true }
  }

  /** Reset the role that asked for revision (and its downstream) and run again. */
  async revise(teamId, actor = '用户') {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    const target = team.members.find(member => member.role === team.verdictRole)
      || [...team.members].reverse().find(member => member.status === STATUS.done)
    if (!target) return { ok: false, error: 'no-target' }
    if (this.budgetExhausted(team)) {
      return { ok: false, error: 'budget-exhausted', used: this.teamTokens(team), limit: this.budgetLimit(team) }
    }
    const downstream = new Set([target.role])
    let changed = true
    while (changed) {
      changed = false
      for (const member of team.members) {
        if (downstream.has(member.role)) continue
        if (member.deps.some(dep => downstream.has(dep))) {
          downstream.add(member.role)
          changed = true
        }
      }
    }
    for (const member of team.members) {
      if (!downstream.has(member.role)) continue
      member.status = STATUS.pending
      member.error = null
      member.finishedAt = null
      member.summary = ''
    }
    team.verdict = null
    team.verdictRole = null
    this.audit(team, actor, 'revise', target.name, '重置该角色及其下游')
    this.note(team, `返工：${target.name} 及其下游`)
    await this.save(team)
    await this.startReady(team)
    return { ok: true, reset: [...downstream] }
  }

  /** Read one member's session log — the cross-session read path. */
  async read(teamId, role, limit = 4) {
    const team = await this.load(teamId)
    if (!team) return { ok: false, error: 'team-not-found' }
    const member = team.members.find(item => item.role === role)
    if (!member) return { ok: false, error: 'role-not-found' }
    let texts = []
    if (member.sessionId) {
      try {
        texts = await this.readSessionTexts(member.sessionId, limit)
      } catch (error) {
        this.log(`read ${role}: ${error}`)
      }
    }
    let handoff = member.summary
    try {
      handoff = await readFile(join(team.root, member.handoff), 'utf8')
    } catch { /* fall back to the captured summary */ }
    const artifacts = (await listFiles(join(team.root, 'artifacts'), MAX_ARTIFACTS))
      .filter(file => file.rel.startsWith(`${role}/`))
      .map(file => ({ ...file, rel: `artifacts/${file.rel}` }))
    return {
      ok: true,
      teamId,
      role,
      name: member.name,
      status: member.status,
      sessionId: member.sessionId,
      summary: clip(member.summary, MAX_SUMMARY),
      handoff: clip(handoff, MAX_HANDOFF),
      messages: texts.map(text => clip(text, 6000)),
      artifacts,
    }
  }

  async readSessionTexts(sessionId, limit) {
    const events = []
    const live = this.ctx.sessions.get(sessionId)
    if (live && typeof live.snapshotEvents === 'function') {
      events.push(...live.snapshotEvents())
    } else {
      const observation = await this.ctx.sessionQuery.observeSession(sessionId, { projectionMode: 'none' })
      const dispose = observation[Symbol.dispose]?.bind(observation) ?? observation.dispose?.bind(observation)
      try {
        events.push(...observation.events)
      } finally {
        try { dispose?.() } catch { /* already disposed */ }
      }
    }
    const texts = []
    for (const event of events) {
      if (event.type !== 'assistant/message') continue
      const text = assistantText(event.data?.message)
      if (text) texts.push(text)
    }
    return texts.slice(-Math.max(1, Math.min(12, limit)))
  }

  /** Copy a member's final answer into its hand-off file when it forgot to. */
  async ensureHandoff(team, member) {
    const path = join(team.root, member.handoff)
    if (await fileExists(path)) return false
    const artifacts = (await listFiles(join(team.root, 'artifacts'), MAX_ARTIFACTS))
      .filter(file => file.rel.startsWith(member.role + '/'))
    const body = [
      handoffBlock(member, artifacts, member.handoffVerdict),
      '',
      '# ' + member.name + ' 交接',
      '',
      '## 结论',
      member.summary || '（本轮没有留下文字结论）',
      '',
      '## 关键产出',
      artifacts.length > 0 ? artifacts.map(file => '- `artifacts/' + file.rel + '`').join('\n') : '（无）',
      '',
      '## 给下游的要求',
      '（自动记录：详见该成员的会话原文）',
      '',
    ].join('\n')
    await ensureDir(dirname(path))
    await writeFile(path, body, 'utf8')
    return true
  }

  /** Persist the facts a structured hand-off reported. */
  recordHandoff(member, parsed) {
    member.handoffFormat = parsed.format
    member.handoffVerdict = parsed.meta && typeof parsed.meta.verdict === 'string' ? parsed.meta.verdict : null
    member.blockers = parsed.meta && Array.isArray(parsed.meta.blockers) ? parsed.meta.blockers.map(String) : []
    member.declaredArtifacts = parsed.meta && Array.isArray(parsed.meta.artifacts)
      ? parsed.meta.artifacts.map(String)
      : []
  }

  /** Prompt that asks a member to repair a missing hand-off or product. */
  guardPrompt(team, member, detail) {
    const path = join(team.root, member.handoff)
    return [
      detail ? `【交接守卫 · ${detail}】` : '【交接守卫】',
      '上一轮结束时没有检测到合格的交接或产物。请立即补上，不要解释过程：',
      '1. 写出交接文件 ' + path + '，第一行是结构化元数据块：',
      '<!-- competition-team',
      '{"role":"' + member.role + '","status":"done","artifacts":["artifacts/' + member.role + '/<文件名>"],"verdict":null,"blockers":[]}',
      '-->',
      '2. 至少在 ' + join(team.root, 'artifacts', member.role) + '/ 下产出一个真实文件；',
      '3. 确实无法完成时，把 status 改成 "blocked" 并在 blockers 里写明原因。',
    ].join('\n')
  }

  async retryWithGuard(team, member, sessionId, detail) {
    member.guardRetries = (member.guardRetries || 0) + 1
    member.taskTurnOpen = true
    member.status = STATUS.running
    member.startedAt = member.startedAt || nowStamp()
    this.note(team, member.name + ' 未通过交接检查，提醒补做一次' + (detail ? '（' + detail + '）' : ''))
    await this.save(team)
    try {
      await this.ctx.sessionController.prompt({
        requestId: 'competition-' + randomUUID(),
        sessionId,
        mode: 'queue',
        content: [{ type: 'text', text: this.guardPrompt(team, member, detail) }],
      }, new AbortController().signal)
    } catch (error) {
      this.log('guard retry ' + member.role + ': ' + error)
    }
  }

  async blockMember(team, member, reason, detail) {
    member.status = STATUS.blocked
    member.taskTurnOpen = false
    member.error = reason
    member.finishedAt = nowStamp()
    this.retireLive(member.sessionId)
    this.note(team, member.name + ' 阻塞：' + (detail || reason))
    this.notify(team, 'blocked', member.name + ' 阻塞：' + (detail || reason))
    await this.save(team)
  }

  async finish(team, member, sessionId) {
    if (member.status !== STATUS.running) return
    this.applyUsage(team, member, sessionId)
    if (this.finishing.has(sessionId)) return
    this.finishing.add(sessionId)
    try {
      await this.finalize(team, member, sessionId)
    } finally {
      this.finishing.delete(sessionId)
    }
  }

  async finalize(team, member, sessionId) {
    let texts = []
    try { texts = await this.readSessionTexts(sessionId, 2) } catch { /* unreadable log */ }
    member.summary = clampSummary(texts.join('\n---\n'))
    const handoffPath = join(team.root, member.handoff)
    const hadHandoff = await fileExists(handoffPath)
    let handoffText = ''
    if (hadHandoff) {
      try { handoffText = await readFile(handoffPath, 'utf8') } catch { /* optional */ }
    }
    if (!member.summary && handoffText) member.summary = clampSummary(handoffText)
    const parsed = parseHandoff(handoffText || member.summary)
    this.recordHandoff(member, parsed)
    const artifacts = (await listFiles(join(team.root, 'artifacts'), MAX_ARTIFACTS))
      .filter(file => file.rel.startsWith(member.role + '/'))
    const declaredBlocked = Boolean(parsed.meta && parsed.meta.status === 'blocked')
    const hasOutput = hadHandoff || artifacts.length > 0 || declaredBlocked || (member.readOnly && member.summary.length > 0)

    if (!hasOutput) {
      if ((member.guardRetries || 0) < 1) {
        await this.retryWithGuard(team, member, sessionId, '没有交接或产物')
        return
      }
      await this.blockMember(team, member, 'no-output', '连续两轮没有交接文件或真实产物')
      return
    }

    const missing = []
    if (!member.readOnly) {
      const root = resolve(team.root)
      for (const rel of member.declaredArtifacts || []) {
        const target = resolve(team.root, rel)
        if (target !== root && !target.startsWith(root + sep)) { missing.push(rel); continue }
        if (!(await fileExists(target))) missing.push(rel)
      }
    }
    if (missing.length > 0) {
      if ((member.guardRetries || 0) < 1) {
        await this.retryWithGuard(team, member, sessionId, '声明的产物不存在：' + missing.join('、'))
        return
      }
      await this.blockMember(team, member, 'missing-artifacts', '交接声明的产物不存在：' + missing.join('、'))
      return
    }

    const qualityErrors = []
    const qualityWarnings = []
    if (!member.readOnly) {
      const root = resolve(team.root)
      for (const rel of member.declaredArtifacts || []) {
        const target = resolve(team.root, rel)
        if (target !== root && !target.startsWith(root + sep)) continue
        if (!(await fileExists(target))) continue
        const result = await qualityCheck(target, rel, member)
        qualityErrors.push(...result.errors)
        qualityWarnings.push(...result.warnings)
      }
    }
    member.qualityWarnings = qualityWarnings.map(item => item.code + ':' + item.path)
    if (qualityWarnings.length > 0) {
      const detail = member.qualityWarnings.join('、')
      this.audit(team, '系统', 'quality', member.name, '产物告警：' + detail)
      this.note(team, member.name + ' 产物告警：' + detail)
    }
    if (qualityErrors.length > 0) {
      const detail = qualityErrors.map(item => item.code + '：' + item.path).join('、')
      if ((member.guardRetries || 0) < 1) {
        await this.retryWithGuard(team, member, sessionId, '产物质量不合格：' + detail)
        return
      }
      await this.blockMember(team, member, 'low-quality-artifacts', '产物质量不合格：' + detail)
      return
    }

    if (declaredBlocked) {
      const blockers = (parsed.meta && Array.isArray(parsed.meta.blockers) ? parsed.meta.blockers : []).join('；')
      await this.blockMember(team, member, 'member-blocked', blockers || '成员声明无法完成')
      return
    }

    member.status = STATUS.done
    member.taskTurnOpen = false
    member.finishedAt = nowStamp()
    member.guardRetries = 0
    if (member.kind === 'captain') {
      this.captainBusy.delete(team.id)
      if ((team.feedbackQueue || []).length > 0) this.scheduleFeedback(team.id, 0)
    }
    this.retireLive(member.sessionId)
    try { await this.ensureHandoff(team, member) } catch (error) { this.log('handoff ' + member.role + ': ' + error) }
    if (!member.summary) {
      try { member.summary = clampSummary(await readFile(handoffPath, 'utf8')) } catch { /* optional */ }
    }
    let evidence = member.summary
    try { evidence += '\n' + await readFile(handoffPath, 'utf8') } catch { /* optional */ }
    const isJudge = /审核|review/i.test(member.name + member.role)
    const verdict = isJudge
      ? (member.handoffVerdict
        || (/结论\s*[:：]\s*需返工/.test(evidence) || /结论\s*[:：]\s*不通过/.test(evidence) ? 'revise'
          : /结论\s*[:：]\s*通过/.test(evidence) ? 'pass' : null))
      : null
    if (verdict === 'revise' || verdict === 'pass') {
      team.verdict = verdict
      team.verdictRole = member.role
      this.note(team, member.name + ' 判定：' + (verdict === 'pass' ? '通过' : '需返工'))
    }
    if (member.kind === 'captain') {
      try { await this.proposeAssignments(team, member) } catch (error) { this.log('assignments: ' + error) }
    }
    const seconds = member.startedAt ? formatSeconds(nowStamp() - member.startedAt) : ''
    this.note(team, member.name + ' 完成' + (seconds ? ' · ' + seconds : ''))
    await this.save(team)
    if (team.auto) await this.startReady(team)
  }

  async onSessionEvent(session, event) {
    const owner = this.bySession.get(session.id)
    if (!owner) return
    if (this.stalled.delete(session.id)) {
      const team = await this.load(owner.teamId)
      const member = team && team.members.find(item => item.role === owner.role)
      if (member && member.status === STATUS.stalled) {
        member.status = STATUS.running
        member.error = null
        await this.save(team)
      }
    }
    const live = this.live.get(session.id) || { progress: '', tool: null, at: nowStamp(), recent: [] }
    if (!Array.isArray(live.recent)) live.recent = []
    const isCaptain = this.captainBySession.get(session.id) === owner.teamId
    const pushRecent = text => {
      const value = String(text || '').replace(/\s+/g, ' ').trim()
      if (!value) return
      live.recent.push({ t: nowStamp(), text: value.slice(0, 200) })
      if (live.recent.length > 6) live.recent.splice(0, live.recent.length - 6)
    }
    if (event.type === 'tool/call') {
      const name = event.data?.call?.name || event.data?.name || 'tool'
      live.tool = String(name)
      live.progress = '正在调用 ' + live.tool + '…'
      live.at = nowStamp()
      pushRecent('调用 ' + live.tool)
      this.live.set(session.id, live)
      return
    }
    if (event.type === 'user/message') {
      // `user/message` carries the UserMessage itself; `assistant/message`
      // wraps it under `message`.
      const text = assistantText(event.data)
      if (!text) return
      // Only real user turns: injected time/context messages carry their own
      // source kind and must not appear as user feedback.
      const source = event.data?.source
      if (source && typeof source.kind === 'string' && source.kind !== 'user') return
      if (/^(Time sampled|Browser time zone|Elapsed since)/.test(text.trim())) return
      live.at = nowStamp()
      if (/^【竞赛智队|^【交接守卫|^【用户意见|^【提案结果】/.test(text.trim())) {
        live.progress = '已派发任务…'
        this.live.set(session.id, live)
        return
      }
      if (isCaptain) {
        this.captainBusy.set(owner.teamId, true)
        const team = await this.load(owner.teamId)
        if (team) {
          team.feedback = Array.isArray(team.feedback) ? team.feedback : []
          team.feedback.push({ t: nowStamp(), text: text.slice(0, 2000) })
          if (team.feedback.length > 20) team.feedback.splice(0, team.feedback.length - 20)
          live.progress = '收到用户意见，队长正在分析…'
          pushRecent('用户意见：' + text.slice(0, 80))
          this.live.set(session.id, live)
          await this.save(team)
        }
      }
      return
    }
    if (event.type === 'assistant/message') {
      const text = assistantText(event.data?.message)
      const usage = event.data?.usage
      if (usage && typeof usage === 'object') {
        const total = Number(usage.totalTokens)
        const fallback = (Number(usage.inputTokens) || 0) + (Number(usage.outputTokens) || 0)
        const delta = Number.isFinite(total) && total > 0 ? total : fallback
        if (delta > 0) live.tokens = (Number(live.tokens) || 0) + delta
      }
      live.at = nowStamp()
      if (text) {
        live.progress = text.replace(/\s+/g, ' ').slice(0, 120)
        live.tool = null
        pushRecent(text.slice(0, 160))
        if (isCaptain) live.pendingReply = { t: nowStamp(), text: text.slice(0, 2000) }
      }
      this.live.set(session.id, live)
      return
    }
    if (event.type === 'turn/end') {
      const team = await this.load(owner.teamId)
      if (!team) return
      const member = team.members.find(item => item.role === owner.role)
      if (!member) return
      this.applyUsage(team, member, session.id)
      if (isCaptain && live.pendingReply) {
        team.captainReply = live.pendingReply
        live.pendingReply = null
        this.live.set(session.id, live)
      }
      if (member.taskTurnOpen) {
        await this.finish(team, member, session.id)
      } else {
        live.progress = ''
        live.tool = null
        // The captain may revise the task book in a captain-channel turn.
        if (isCaptain) {
          try { await this.proposeAssignments(team, member) } catch (error) { this.log('assignments: ' + error) }
        }
        await this.save(team)
      }
      if (isCaptain) {
        this.captainBusy.delete(team.id)
        if ((team.feedbackQueue || []).length > 0) this.scheduleFeedback(team.id, 0)
      }
    }
  }

  async onAgentStatus(agent, status) {
    const owner = this.bySession.get(agent.id)
    if (!owner) return
    if (status === 'running') {
      const live = this.live.get(agent.id) || { progress: '模型正在思考…', tool: null, at: nowStamp(), recent: [] }
      if (!live.progress) live.progress = '模型正在思考…'
      this.live.set(agent.id, live)
      return
    }
    const team = await this.load(owner.teamId)
    if (!team) return
    const member = team.members.find(item => item.role === owner.role)
    if (member && member.status === STATUS.running && member.taskTurnOpen) {
      // A turn/end usually lands just before idle; finish here too so a
      // cancelled or closed task turn never strands the row in "running".
      await this.finish(team, member, agent.id)
    }
  }

  async onAgentError(agent, error) {
    const owner = this.bySession.get(agent.id)
    if (!owner) return
    const team = await this.load(owner.teamId)
    if (!team) return
    const member = team.members.find(item => item.role === owner.role)
    if (!member) return
    this.applyUsage(team, member, agent.id)
    await this.handleFailure(team, member, error, '模型调用失败')
  }

  snapshotFor(team, artifactBag) {
    const bag = Array.isArray(artifactBag) ? artifactBag : []
    const members = team.members.map(member => {
      const live = member.sessionId ? this.live.get(member.sessionId) : undefined
      const artifacts = bag.filter(file => file.rel.startsWith(`${member.role}/`))
      return {
        role: member.role,
        name: member.name,
        kind: member.kind,
        pos: member.pos,
        model: member.model,
        readOnly: member.readOnly === true,
        readOnlyApplied: member.readOnlyApplied === true,
        guardRetries: member.guardRetries || 0,
        handoffFormat: member.handoffFormat || null,
        blockers: member.blockers || [],
        task: member.task,
        taskSource: member.taskSource || null,
        taskPending: member.taskPending === true,
        qualityWarnings: member.qualityWarnings || [],
        retryAttempts: member.retryAttempts || 0,
        retryAt: member.retryAt || null,
        errorDetail: member.errorDetail || null,
        deps: member.deps,
        status: member.status,
        sessionId: member.sessionId,
        progress: live?.progress || '',
        tool: live?.tool || null,
        recent: Array.isArray(live?.recent) ? live.recent.slice(-6) : [],
        lastEventAt: live?.at || member.finishedAt || member.startedAt || null,
        startedAt: member.startedAt,
        finishedAt: member.finishedAt,
        elapsed: member.startedAt ? (member.finishedAt || nowStamp()) - member.startedAt : 0,
        summary: clip(member.summary, 1200),
        rounds: member.rounds,
        stallRetries: member.stallRetries || 0,
        tokens: Math.max(0, Number(member.tokens) || 0) + Math.max(0, Number(live?.tokens) || 0),
        snippet: member.summary
          ? member.summary
            .replace(/```[\s\S]*?```/g, ' ')
            .replace(/^#{1,6}\s*/gm, '')
            .replace(/#{1,6}\s/g, '')
            .replace(/\*\*/g, '')
            .replace(/[`>|]/g, '')
            .replace(/\s+/g, ' ').trim().slice(0, 140)
          : '',
        error: member.error,
        handoff: member.handoff,
        artifacts: artifacts.slice(0, 12).map(file => ({ ...file, rel: `artifacts/${file.rel}` })),
        artifactCount: artifacts.length,
      }
    })
    const done = members.filter(member => member.status === STATUS.done).length
    const running = members.filter(member => member.status === STATUS.running).length
    const failed = members.filter(member => member.status === STATUS.failed).length
    const blocked = members.filter(member => member.status === STATUS.blocked).length
    const stalled = members.filter(member => member.status === STATUS.stalled).length
    const skipped = members.filter(member => member.status === STATUS.skipped).length
    const retrying = members.filter(member => member.status === STATUS.retrying).length
    let status = 'idle'
    if (blocked > 0) status = 'blocked'
    else if (stalled > 0) status = 'stalled'
    else if (running > 0 || retrying > 0) status = 'running'
    else if (team.verdict === 'revise') status = 'needsRevision'
    else if (done + skipped === members.length) status = 'done'
    else if (failed > 0) status = 'failed'
    return {
      id: team.id,
      title: team.title,
      brief: clip(team.brief, 4000),
      cwd: team.cwd,
      root: team.root,
      auto: team.auto,
      confirmed: team.confirmed,
      status,
      verdict: team.verdict,
      verdictRole: team.verdictRole,
      captain: (() => {
        const captain = team.members.find(member => member.kind === 'captain')
        return captain
          ? {
            role: captain.role,
            name: captain.name,
            sessionId: captain.sessionId,
            status: captain.status,
            feedback: (team.feedback || []).slice(-5),
            queue: (team.feedbackQueue || []).length,
            busy: this.captainBusy.get(team.id) === true,
            audit: (team.audit || []).slice(-8),
            reply: team.captainReply || null,
          }
          : null
      })(),
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
      assignmentCheck: team.assignmentCheck || null,
      notifications: (team.notifications || []).slice(-10),
      unread: (team.notifications || []).filter(item => !item.readAt).length,
      budget: (() => {
        const limit = this.budgetLimit(team)
        const used = this.teamTokens(team)
        const state = limit <= 0 ? 'ok' : used >= limit ? 'exhausted' : used >= limit * BUDGET_WARN_RATIO ? 'warned' : 'ok'
        return {
          limit: limit > 0 ? limit : null,
          used,
          percent: limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0,
          state,
        }
      })(),
      proposals: (team.proposals || []).slice(-10).map(({ base, ...item }) => ({
        ...item,
        edited: Boolean(item.editedAt),
        expired: item.status === 'pending' && nowStamp() - item.createdAt > PROPOSAL_TTL_MS,
      })),
      progress: { done, total: members.length, running, skipped },
      members,
      log: team.log.slice(-12).reverse(),
    }
  }

  async snapshot() {
    const teams = await this.loadAll()
    const enriched = []
    let active = 0
    for (const team of teams) {
      const bag = await listFiles(join(team.root, 'artifacts'), MAX_ARTIFACTS)
      const snap = this.snapshotFor(team, bag)
      if (snap.status === 'running') active += 1
      enriched.push(snap)
    }
    return {
      ok: true,
      now: nowStamp(),
      defaultCwd: this.defaultCwd(),
      teams: enriched,
      active,
    }
  }

  async defaultTeam() {
    const teams = await this.loadAll()
    return teams.find(team => team.members.some(member => member.status === STATUS.running)) || teams[0]
  }
}

const HTTP_TOKEN_NAME = '__COMPETITION_TEAM_TOKEN__'
const HTTP_TOKEN_FILE = join(DATA_DIR, 'http-token')

/** Load the per-install HTTP token, creating it on first use. */
function loadOrCreateHttpToken() {
  try {
    const existing = readFileSync(HTTP_TOKEN_FILE, 'utf8').trim()
    if (existing.length >= 32) return existing
  } catch { /* create below */ }
  const token = randomUUID().replace(/-/g, '')
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    writeFileSync(HTTP_TOKEN_FILE, token, { encoding: 'utf8', mode: 0o600 })
  } catch { /* read-only profile: fall back to an in-memory token */ }
  return token
}

/** Constant-time check of the token header. */
function tokenValid(request, token) {
  const supplied = request.headers['x-competition-team-token']
  if (typeof supplied !== 'string' || supplied.length !== token.length) return false
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
}

/** Route helpers. Only same-origin JSON is accepted. */
function sameOrigin(request) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin.length === 0) return true
  try {
    const url = new URL(origin)
    return url.host === request.headers.host
  } catch {
    return false
  }
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  response.end(body)
}

function readBody(request, limit) {
  return new Promise((resolvePromise, reject) => {
    const chunks = []
    let size = 0
    request.on('data', chunk => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolvePromise(Buffer.concat(chunks)))
    request.on('error', reject)
  })
}

function serveFile(response, root, rel) {
  const target = resolve(root, rel)
  const normalizedRoot = resolve(root)
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${sep}`)) {
    sendJson(response, 404, { ok: false, error: 'outside-team' })
    return
  }
  const ext = extname(target).toLowerCase()
  const type = MIME[ext] || 'application/octet-stream'
  const stream = createReadStream(target)
  stream.on('error', () => {
    if (!response.headersSent) sendJson(response, 404, { ok: false, error: 'not-found' })
    else response.destroy()
  })
  stream.once('open', () => {
    response.writeHead(200, {
      'content-type': type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    })
    stream.pipe(response)
  })
}

/** The agent-facing tool: one action surface over the same store the UI uses. */
function toolDefinition(ctx, store) {
  return {
    name: 'competition_team',
    description: [
      '竞赛智队：把一场比赛拆成多个独立会话。角色分三类——队长（总指挥）、核心（二级大脑）、队员（执行）。',
      '建队后团队处于草稿态：用户在左侧「竞赛智队」面板的画布上改角色、连工作流、给每个角色选模型，确认后才开工。',
      'action=create 建草稿队（可带 members 自定义角色）；action=configure 保存角色与工作流；action=confirm 确认并开跑；',
      'action=status 看进度；action=read 读某位成员的会话汇报与交接（跨会话读取）；action=dispatch 给成员派/改任务；action=message 追加指令；action=stop 停止；action=revise 让失败的判定角色及其下游返工。',
      '队长频道：用户会直接在队长会话里提意见。你（队长）收到后先 status/read，再 dispatch/message/revise，最后回报改了什么。',
      '注意：成员（含队长）对团队的任何改动都会先变成提案，等用户在面板批准后才执行；返回 pending=true 时不要声称已经派活，向用户说明你提了什么、等批准。',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'configure', 'confirm', 'status', 'start', 'stop', 'message', 'dispatch', 'read', 'revise', 'delete', 'setAuto'],
          description: '要执行的操作。',
        },
        title: { type: 'string', description: '队伍名称（create）。' },
        brief: { type: 'string', description: '题目与目标原文（create）；写在共享目录的 brief.md 里供所有成员读取。' },
        cwd: { type: 'string', description: '共享工作目录的绝对路径（create）；省略时用当前会话目录。' },
        teamId: { type: 'string', description: '团队 id；省略时用最近一个、优先正在运行的团队。' },
        role: { type: 'string', description: '成员角色 id（草稿里每个角色的 role 字段）。' },
        text: { type: 'string', description: '追加给成员的原话（message）。' },
        task: { type: 'string', description: '派活时成员的新任务（dispatch）。' },
        note: { type: 'string', description: '派活时给成员的补充说明（dispatch）。' },
        reason: { type: 'string', description: '提案理由：为什么此刻要改这个成员的任务（dispatch/message/revise）。' },
        auto: { type: 'boolean', description: '是否自动接力（create / setAuto）。' },
        archiveSessions: { type: 'boolean', description: 'delete 时是否同时归档成员会话（默认 false，只从列表移除团队）。' },
        members: {
          type: 'array',
          description: '角色表（create / configure）。每项：role(id)、name、kind(captain|core|member)、task、deps(依赖的 role 数组)、pos({x,y} 画布位置 0-1)、model({provider,model,reasoningEffort?})。省略时用内置三分类模板。',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string' },
              name: { type: 'string' },
              kind: { type: 'string', enum: ['captain', 'core', 'member'] },
              task: { type: 'string' },
              deps: { type: 'array', items: { type: 'string' } },
              pos: {
                type: 'object',
                properties: { x: { type: 'number' }, y: { type: 'number' } },
              },
              readOnly: { type: 'boolean', description: '以只读权限运行（不能写文件；审核类角色建议开启）' },
              model: {
                type: 'object',
                properties: {
                  provider: { type: 'string' },
                  model: { type: 'string' },
                  reasoningEffort: { type: 'string' },
                },
              },
            },
          },
        },
      },
      required: ['action'],
    },
    output: {
      schema: { type: 'object' },
      render(args, value) {
        const payload = {
          ok: value?.ok !== false,
          ...value,
        }
        return [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
      },
    },
    async execute(args, exec) {
      const action = String(args?.action || '')
      const actor = (await store.actorName(exec.agent?.id)) || '模型'
      const owner = await store.memberActor(exec.agent?.id)
      if (owner && ['create', 'configure', 'confirm', 'delete', 'setAuto'].includes(action)) {
        return {
          ok: false,
          error: 'member-cannot-admin',
          hint: '成员不能管理团队；只能 status/read，以及对成员提 dispatch/message/revise/start/stop 提案。',
        }
      }
      const resolveTeam = async () => {
        if (args?.teamId) return store.load(String(args.teamId))
        return store.defaultTeam()
      }
      if (action === 'create') {
        const cwd = typeof args?.cwd === 'string' && isAbsolute(args.cwd) ? args.cwd : exec.agent?.session?.header?.cwd
        const team = await store.create({
          title: args?.title,
          brief: args?.brief,
          cwd,
          auto: args?.auto,
          members: Array.isArray(args?.members) ? args.members : undefined,
          ownerSessionId: exec.agent?.id,
        })
        return {
          ok: true,
          teamId: team.id,
          title: team.title,
          cwd: team.cwd,
          root: team.root,
          confirmed: team.confirmed,
          members: team.members.map(member => ({
            role: member.role,
            name: member.name,
            kind: member.kind,
            deps: member.deps,
          })),
          hint: '团队目前是草稿态：让用户在左侧「竞赛智队」面板的卡片画布上确认角色与工作流，或由你调用 action=confirm 直接开跑。',
        }
      }
      if (action === 'configure') {
        const team = await resolveTeam()
        if (!team) return { ok: false, error: 'no-team' }
        return store.configure(team.id, Array.isArray(args?.members) ? args.members : [])
      }
      if (action === 'confirm') {
        const team = await resolveTeam()
        if (!team) return { ok: false, error: 'no-team' }
        return store.confirm(team.id)
      }
      if (action === 'status') {
        const teams = await store.loadAll()
        const payload = []
        for (const team of teams) {
          const bag = await listFiles(join(team.root, 'artifacts'), MAX_ARTIFACTS)
          payload.push(store.snapshotFor(team, bag))
        }
        return { ok: true, teams: payload }
      }
      if (action === 'read') {
        const team = await resolveTeam()
        if (!team) return { ok: false, error: 'no-team' }
        return store.read(team.id, String(args?.role || '').trim() || 'modeler', 4)
      }
      const team = await resolveTeam()
      if (!team) return { ok: false, error: 'no-team' }
      if (owner && owner.teamId === team.id && ['dispatch', 'message', 'revise', 'start', 'stop'].includes(action)) {
        return store.propose(team, owner.name, action, {
          role: args?.role,
          task: args?.task,
          note: args?.text || args?.note,
          reason: args?.reason,
        })
      }
      if (action === 'start') return store.start(team.id, String(args?.role || ''), actor)
      if (action === 'stop') return store.stop(team.id, String(args?.role || ''), actor)
      if (action === 'message') return store.message(team.id, String(args?.role || ''), String(args?.text || ''), actor)
      if (action === 'dispatch') return store.dispatch(team.id, String(args?.role || ''), { task: args?.task, note: args?.note, actor })
      if (action === 'revise') return store.revise(team.id, actor)
      if (action === 'delete') return store.remove(team.id, { archiveSessions: args?.archiveSessions === true })
      if (action === 'setAuto') return store.setAuto(team.id, args?.auto !== false, actor)
      return { ok: false, error: `unknown-action:${action}` }
    },
  }
}

/** Serve the panel's state, mutations and artifact bytes. */
function handleHttp(ctx, store, token, request, response) {
  const url = new URL(request.url || '/', 'http://127.0.0.1')
  if (!sameOrigin(request)) {
    sendJson(response, 403, { ok: false, error: 'cross-origin' })
    return
  }
  const guarded = url.pathname === `${API_PREFIX}/state`
    || url.pathname === `${API_PREFIX}/models`
    || url.pathname === `${API_PREFIX}/action`
  if (guarded && !tokenValid(request, token)) {
    sendJson(response, 403, { ok: false, error: 'token' })
    return
  }
  if (url.pathname === `${API_PREFIX}/state`) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    store.snapshot().then(payload => sendJson(response, 200, payload), error => {
      sendJson(response, 500, { ok: false, error: String(error && error.message ? error.message : error) })
    })
    return
  }
  if (url.pathname === `${API_PREFIX}/models`) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    Promise.resolve(ctx.sessionController.modelCatalog()).then(catalog => {
      sendJson(response, 200, {
        ok: true,
        default: catalog.default,
        groups: (catalog.groups || []).map(group => ({
          id: group.id,
          name: group.name,
          models: (group.models || []).map(model => ({
            id: model.id,
            name: model.name,
            ...(model.reasoning ? {
              efforts: model.reasoning.efforts,
              defaultEffort: model.reasoning.defaultEffort,
            } : {}),
          })),
        })),
      })
    }, error => sendJson(response, 500, { ok: false, error: String(error && error.message ? error.message : error) }))
    return
  }
  if (url.pathname === `${API_PREFIX}/file`) {
    const teamId = url.searchParams.get('team') || ''
    const rel = url.searchParams.get('path') || ''
    if (!teamId || !rel) {
      sendJson(response, 400, { ok: false, error: 'missing-params' })
      return
    }
    store.load(teamId).then(team => {
      if (!team) {
        sendJson(response, 404, { ok: false, error: 'team-not-found' })
        return
      }
      serveFile(response, team.root, rel)
    }, () => sendJson(response, 404, { ok: false, error: 'team-not-found' }))
    return
  }
  if (url.pathname === `${API_PREFIX}/action`) {
    if (request.method !== 'POST') {
      sendJson(response, 405, { ok: false, error: 'method' })
      return
    }
    if (request.headers['x-competition-team'] !== '1') {
      sendJson(response, 403, { ok: false, error: 'header' })
      return
    }
    readBody(request, MAX_BODY).then(async body => {
      let payload
      try {
        payload = JSON.parse(body.toString('utf8') || '{}')
      } catch {
        sendJson(response, 400, { ok: false, error: 'bad-json' })
        return
      }
      const action = String(payload.action || '')
      try {
        const result = await store.serialize(async () => {
          if (action === 'create') {
            const team = await store.create({
              title: payload.title,
              brief: payload.brief,
              cwd: payload.cwd,
              auto: payload.auto !== false,
              members: Array.isArray(payload.members) ? payload.members : undefined,
            })
            return { ok: true, teamId: team.id, confirmed: team.confirmed, teams: [store.snapshotFor(team)] }
          }
          const team = payload.teamId ? await store.load(String(payload.teamId)) : await store.defaultTeam()
          if (!team) return { ok: false, error: 'no-team' }
          if (action === 'configure') return store.configure(team.id, Array.isArray(payload.members) ? payload.members : [])
          if (action === 'dispatch') return store.dispatch(team.id, String(payload.role || ''), { task: payload.task, note: payload.note })
          if (action === 'feedback') return store.feedback(team.id, String(payload.text || ''), '用户')
          if (action === 'checkStalled') return { ok: true, stalled: await store.watchdog() }
          if (action === 'approveProposal') return store.decideProposal(team.id, String(payload.proposalId || ''), 'approve')
          if (action === 'rejectProposal') return store.decideProposal(team.id, String(payload.proposalId || ''), 'reject')
          if (action === 'editProposal') {
            return store.editProposal(team.id, String(payload.proposalId || ''), {
              task: payload.task,
              note: payload.note,
              reason: payload.reason,
            })
          }
          if (action === 'confirm') return store.confirm(team.id)
          if (action === 'start') return store.start(team.id, String(payload.role || ''))
          if (action === 'stop') return store.stop(team.id, String(payload.role || ''))
          if (action === 'read') return store.read(team.id, String(payload.role || ''), Number(payload.limit) || 3)
          if (action === 'message') return store.message(team.id, String(payload.role || ''), String(payload.text || ''))
          if (action === 'revise') return store.revise(team.id)
          if (action === 'skip') return store.skip(team.id, String(payload.role || ''))
          if (action === 'readNotifications') return store.readNotifications(team.id)
          if (action === 'delete') return store.remove(team.id, { archiveSessions: payload.archiveSessions === true })
          if (action === 'setAuto') return store.setAuto(team.id, payload.auto !== false)
          if (action === 'setBudget') {
            const limit = payload.limit === null || payload.limit === undefined || payload.limit === ''
              ? null
              : Number(payload.limit)
            return store.setBudget(team.id, limit)
          }
          return { ok: false, error: `unknown-action:${action}` }
        })
        sendJson(response, 200, result ?? { ok: true })
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error && error.message ? error.message : error) })
      }
    }).catch(error => {
      sendJson(response, 400, { ok: false, error: String(error && error.message ? error.message : error) })
    })
    return
  }
  sendJson(response, 404, { ok: false, error: 'not-found' })
}

/** Host entry point. */
export function apply(ctx) {
  const store = new TeamStore(ctx)
  const httpToken = loadOrCreateHttpToken()
  ctx.on('webserver/index-inject', table => {
    table.push({ kind: 'global', name: HTTP_TOKEN_NAME, value: httpToken })
  })
  ctx.effect(() => {
    store.init()
      // Load once eagerly so `session/event` handlers know their teams even
      // before the first panel poll arrives.
      .then(() => store.loadAll())
      .then(() => store.resumeTeams())
      .then(() => {
        for (const team of store.teams.values()) {
          if ((team.feedbackQueue || []).length > 0) store.scheduleFeedback(team.id, 1500)
        }
      })
      .catch(error => ctx.logger.warn(`competition-team: index unavailable: ${String(error)}`))
  }, 'competition-team:index')
  ctx.effect(() => {
    const timer = setInterval(() => {
      store.watchdog().catch(error => store.log('watchdog: ' + error))
    }, 60 * 1000)
    if (typeof timer.unref === 'function') timer.unref()
    return () => clearInterval(timer)
  }, 'competition-team:watchdog')
  ctx.effect(() => ctx.tools.register(toolDefinition(ctx, store)), 'competition-team:tool')
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix',
    path: API_PREFIX,
    handler: (request, response) => {
      try {
        handleHttp(ctx, store, httpToken, request, response)
      } catch (error) {
        sendJson(response, 500, { ok: false, error: String(error && error.message ? error.message : error) })
      }
    },
  }), 'competition-team:routes')
  ctx.on('session/event', (session, event) => {
    store.onSessionEvent(session, event).catch(error => store.log(`session event: ${error}`))
  })
  ctx.on('agent/status', (payload) => {
    store.onAgentStatus(payload.agent, payload.status).catch(error => store.log(`agent status: ${error}`))
  })
  ctx.on('agent/error', (payload) => {
    store.onAgentError(payload.agent, payload.error).catch(error => store.log(`agent error: ${error}`))
  })
}

export const inject = ['tools', 'sessionController', 'sessions', 'sessionQuery', 'webServer', 'agents', 'workspaceRegistry']

// Exported for the node:test suite; the browser never imports the host half.
export { TeamStore, parseHandoff, handoffBlock, validateWorkflow, parseAssignments, parseAssignmentsDetailed, qualityCheck, classifyError }