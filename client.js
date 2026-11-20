/**
 * Competition Team — browser half.
 *
 * Registers three seats through the official slots:
 *   - `sidebar.panellist`      left-rail entry icon
 *   - `main` keyed by the panel id   the tree page
 *   - `sidebar.footer.action`  the live "3/5" row above Settings
 *
 * All data comes from one same-origin JSON route served by the Host half; the
 * browser never folds session events. Polling lives in one module store so the
 * page and the sidebar row share a single request per tick.
 */
window.__ModuleLoader__.load({
  id: 'dsh-competition-team',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } = React

    /** Panel id shared with the Host half and the `main` keyed slot. */
    const PANEL = 'competition-team'
    const NS = 'competition-team'
    const API = '/competition-team/api'
    const TOKEN = typeof window !== 'undefined' && window.__COMPETITION_TEAM_TOKEN__
      ? String(window.__COMPETITION_TEAM_TOKEN__)
      : ''
    const TOKEN_HEADER = TOKEN ? { 'x-competition-team-token': TOKEN } : {}
    const POLL_MS = 2000

    const ZH = {
      'entry.label': '竞赛智队',
      'panel.title': '竞赛智队',
      'panel.subtitle': '每位成员一个独立会话，结果自动交接',
      'panel.empty': '还没有团队。创建后队长先拆题，建模、编程、论文、审核依次接力。',
      'panel.create': '新建竞赛团队',
      'panel.createTitle': '队伍名称',
      'panel.createBrief': '题目与目标',
      'panel.createCwd': '共享工作目录',
      'panel.createAuto': '建好后自动接力',
      'panel.cancel': '取消',
      'panel.confirm': '创建，去配置流程',
      'panel.auto': '自动接力',
      'panel.manual': '手动推进',
      'panel.refresh': '刷新',
      'panel.running': '进行中',
      'panel.done': '已完成',
      'panel.pending': '等待',
      'panel.failed': '失败',
      'panel.stopped': '已停止',
      'panel.waitingDeps': '等待 {names}',
      'panel.noSession': '尚未开会话',
      'panel.openSession': '打开会话',
      'panel.start': '开始',
      'panel.retry': '重试',
      'panel.stop': '停止',
      'panel.send': '追加指令',
      'panel.sendPlaceholder': '给这位成员补一句话…',
      'panel.summary': '本轮汇报',
      'panel.handoff': '交接文件',
      'panel.artifacts': '产物',
      'panel.noHandoff': '还没有交接文件',
      'panel.noSummary': '本轮没有留下文字汇报',
      'panel.rerun': '重跑',
      'panel.confirmRerun': '确认重跑？',
      'panel.blockedBy': '需先完成：',
      'panel.close': '关闭',
      'panel.loading': '加载中…',
      'panel.idle': '待推进',
      'panel.blocked': '已阻塞',
      'panel.stalled': '可能停滞',
      'panel.skipped': '已跳过',
      'panel.retrying': '重试中',
      'panel.retryWaiting': '临时错误，等待重试',
      'panel.retryExhausted': '临时错误重试次数用尽',
      'panel.retryCount': '重试 {n} / 2',
      'panel.continue': '继续',
      'panel.skip': '跳过',
      'panel.stalledReason': '停滞未恢复',
      'panel.interrupted': '宿主重启中断',
      'panel.reportsTo': '直属上级',
      'footer.stalled': '有成员停滞',
      'captain.queued': '排队 {n} 条',
      'proposal.pending': '待批准 {n}',
      'proposal.title': '待批准的提案',
      'proposal.approve': '批准',
      'proposal.reject': '驳回',
      'proposal.task': '新任务',
      'proposal.note': '说明',
      'proposal.reason': '理由',
      'proposal.expired': '已过期',
      'proposal.failed': '执行失败',
      'proposal.done': '已处理',
      'proposal.type.dispatch': '派活',
      'proposal.type.message': '追加指令',
      'proposal.type.revise': '返工',
      'proposal.type.start': '开工',
      'proposal.type.stop': '停止',
      'proposal.needConfirm': '成员的操作会先变成提案，批准后执行',
      'proposal.edit': '编辑',
      'proposal.editSave': '保存修改',
      'proposal.editCancel': '取消',
      'proposal.edited': '已修改',
      'proposal.history': '已处理',
      'proposal.status.approved': '已批准',
      'proposal.status.rejected': '已驳回',
      'proposal.status.stale': '已过期',
      'proposal.status.expired': '已过期',
      'proposal.status.failed': '执行失败',
      'proposal.status.pending': '待批准',
      'proposal.type.assignments': '任务书',
      'proposal.assignmentsNote': '批准后整队任务按任务书更新',
      'proposal.assignmentsCount': '任务书 · {n} 人',
      'panel.taskFromCaptain': '任务书已更新',
      'panel.taskPending': '任务已更新，下一轮生效',
      'panel.taskBook': '任务书',
      'panel.taskBookWarn': '任务书有 {n} 处问题',
      'panel.taskBookNoBlock': '缺少机器可读任务书块',
      'panel.taskBookBadJson': 'JSON 解析失败',
      'panel.taskBookNotArray': '不是数组',
      'panel.taskBookBadEntry': '条目缺 role/task',
      'panel.taskBookUnknownRole': '未知角色',
      'panel.taskBookShort': '任务过短',
      'panel.upstreamFailed': '上游失败，等待重跑或跳过：',
      'panel.qualityWarnings': '产物质量告警',
      'panel.qualityLow': '产物质量不合格',
      'quality.missingSections': '缺少常见章节标题',
      'proposal.stale': '提案已过期（状态已变化，未执行）',
      'notify.enable': '开启通知',
      'budget.label': '预算',
      'budget.unlimited': '不限',
      'budget.edit': '调整预算',
      'budget.placeholder': 'token 数，留空 = 不限',
      'budget.save': '保存',
      'budget.cancel': '取消',
      'budget.exhausted': '预算用尽，已暂停派发',
      'budget.percent': '预算 {n}%',
      'budget.invalid': '请输入有效数字',
      'notify.blocked': '成员阻塞',
      'notify.inbox': '通知',
      'notify.markRead': '全部已读',
      'notify.empty': '没有通知',
      'notify.kind.proposal': '提案',
      'notify.kind.assignments': '任务书',
      'notify.kind.blocked': '阻塞',
      'notify.kind.stalled': '停滞',
      'notify.kind.failed': '失败',
      'notify.kind.budget': '预算',
      'notify.stalled': '成员停滞',
      'captain.busy': '队长思考中',
      'captain.audit': '队长操作记录',
      'captain.act.dispatch': '派活',
      'captain.act.message': '追加指令',
      'captain.act.start': '开始',
      'captain.act.stop': '停止',
      'captain.act.revise': '返工',
      'captain.act.feedback': '收到意见',
      'captain.act.stall': '停滞',
      'captain.act.setAuto': '自动接力',
      'panel.recent': '最近动态',
      'captain.channel': '队长频道',
      'captain.empty': '有意见直接告诉队长，它会分析并给成员派活',
      'captain.open': '打开队长会话',
      'captain.send': '给队长留言',
      'captain.placeholder': '比如：核心 B 的图太丑，让它重画一版；论文结论别动。',
      'captain.notStarted': '队长还没开工；先点「开始执行」，或者直接去队长会话里说。',
      'captain.sent': '已转达给队长',
      'captain.failed': '转达失败',
      'panel.resume': '开始执行',
      'panel.readOnlyChip': '只读',
      'panel.blockedNoOutput': '连续两轮没有交接或产物',
      'panel.blockedMissing': '交接里声明的产物不存在',
      'panel.blockedMember': '成员声明无法完成',
      'panel.blockers': '阻塞原因',
      'editor.readOnly': '只读运行（不能写文件）',
      'editor.readOnlyHint': '审核类角色建议开启：插件替你落盘交接，避免自己改完自己审',
      'editor.preflightBrief': '题目太短，先把 brief 写清楚',
      'editor.preflightTask': '有角色没填职责',
      'editor.preflightName': '有角色没填名称',
      'editor.preflightModel': '模型不可用',
      'footer.blocked': '有成员阻塞',
      'editor.draft': '草稿',
      'editor.subtitle': '草稿 · 在画布上定义角色与流程，确认后开跑',
      'editor.hint': '拖动卡片摆位置；从卡片底部圆点拖到另一张卡片顶部即可连线；点连线可删除。',
      'editor.addCaptain': '+ 队长',
      'editor.addCore': '+ 核心',
      'editor.addMember': '+ 队员',
      'editor.save': '保存草稿',
      'editor.confirm': '确认并开跑',
      'editor.name': '名称',
      'editor.kind': '类别',
      'editor.task': '职责',
      'editor.model': '模型',
      'editor.defaultModel': '默认模型（跟随会话设置）',
      'editor.deps': '前置角色',
      'editor.delete': '删除角色',
      'editor.captain': '队长',
      'editor.core': '核心',
      'editor.member': '队员',
      'editor.saved': '草稿已保存',
      'editor.needCaptain': '必须恰好有一位队长',
      'editor.needMore': '至少需要两名成员',
      'editor.cycle': '前置关系成环了',
      'editor.missingDep': '存在不存在的依赖',
      'editor.selfDep': '角色不能依赖自己',
      'editor.confirmHint': '确认后锁定工作流并开始执行',
      'editor.loading': '加载模型列表…',
      'footer.draft': '待配置',
      'panel.noArtifacts': '还没有产物',
      'panel.progressOf': '进度 {done}/{total}',
      'panel.created': '团队已创建',
      'panel.started': '已派发',
      'panel.stoppedMsg': '已停止',
      'panel.sentMsg': '指令已排队',
      'panel.delete': '删除团队',
      'panel.deleteConfirm': '再点一次确认删除',
      'panel.verdictPass': '审核通过',
      'panel.verdictRevise': '需返工',
      'panel.log': '动态',
      'footer.label': '智队',
      'footer.none': '未建队',
      'footer.running': '{name}进行中',
      'footer.done': '全部完成',
      'footer.revise': '待返工',
      'footer.failed': '有成员失败',
      'footer.idle': '待推进',
    }

    const EN = {
      'entry.label': 'Competition Team',
      'panel.title': 'Competition Team',
      'panel.subtitle': 'One independent Session per member, handed off automatically',
      'panel.empty': 'No team yet. Create one and the captain splits the brief first.',
      'panel.create': 'New team',
      'panel.createTitle': 'Team name',
      'panel.createBrief': 'Problem and goal',
      'panel.createCwd': 'Shared working directory',
      'panel.createAuto': 'Start the hand-off chain immediately',
      'panel.cancel': 'Cancel',
      'panel.confirm': 'Create and configure',
      'panel.auto': 'Auto hand-off',
      'panel.manual': 'Manual',
      'panel.refresh': 'Refresh',
      'panel.running': 'Running',
      'panel.done': 'Done',
      'panel.pending': 'Waiting',
      'panel.failed': 'Failed',
      'panel.stopped': 'Stopped',
      'panel.waitingDeps': 'Waiting for {names}',
      'panel.noSession': 'No Session yet',
      'panel.openSession': 'Open Session',
      'panel.start': 'Start',
      'panel.retry': 'Retry',
      'panel.stop': 'Stop',
      'panel.send': 'Follow-up',
      'panel.sendPlaceholder': 'Add one instruction for this member…',
      'panel.summary': 'This round',
      'panel.handoff': 'Hand-off note',
      'panel.artifacts': 'Artifacts',
      'panel.noHandoff': 'No hand-off note yet',
      'panel.noSummary': 'No written report this round',
      'panel.rerun': 'Run again',
      'panel.confirmRerun': 'Confirm run?',
      'panel.blockedBy': 'Finish first:',
      'panel.close': 'Close',
      'panel.loading': 'Loading…',
      'panel.idle': 'Idle',
      'panel.blocked': 'Blocked',
      'panel.stalled': 'Stalled',
      'panel.skipped': 'Skipped',
      'panel.retrying': 'Retrying',
      'panel.retryWaiting': 'Transient error; waiting to retry',
      'panel.retryExhausted': 'Transient retries exhausted',
      'panel.retryCount': 'Retry {n} / 2',
      'panel.continue': 'Continue',
      'panel.skip': 'Skip',
      'panel.stalledReason': 'Stalled and not recovered',
      'panel.interrupted': 'Interrupted by host reload',
      'panel.reportsTo': 'Reports to',
      'footer.stalled': 'A member stalled',
      'captain.queued': '{n} queued',
      'proposal.pending': '{n} to approve',
      'proposal.title': 'Pending proposals',
      'proposal.approve': 'Approve',
      'proposal.reject': 'Reject',
      'proposal.task': 'New task',
      'proposal.note': 'Note',
      'proposal.reason': 'Why',
      'proposal.expired': 'Expired',
      'proposal.failed': 'Failed',
      'proposal.done': 'Decided',
      'proposal.type.dispatch': 'dispatch',
      'proposal.type.message': 'message',
      'proposal.type.revise': 'revise',
      'proposal.type.start': 'start',
      'proposal.type.stop': 'stop',
      'proposal.needConfirm': 'Member changes become proposals; you approve before they run',
      'proposal.edit': 'Edit',
      'proposal.editSave': 'Save changes',
      'proposal.editCancel': 'Cancel',
      'proposal.edited': 'Edited',
      'proposal.history': 'Decided',
      'proposal.status.approved': 'Approved',
      'proposal.status.rejected': 'Rejected',
      'proposal.status.stale': 'Stale',
      'proposal.status.expired': 'Expired',
      'proposal.status.failed': 'Failed',
      'proposal.status.pending': 'Pending',
      'proposal.type.assignments': 'Task book',
      'proposal.assignmentsNote': 'Approving updates every listed task',
      'proposal.assignmentsCount': 'Task book · {n}',
      'panel.taskFromCaptain': 'Task book applied',
      'panel.taskPending': 'Task updated; takes effect next turn',
      'panel.taskBook': 'Task book',
      'panel.taskBookWarn': 'Task book has {n} issue(s)',
      'panel.taskBookNoBlock': 'Missing machine-readable block',
      'panel.taskBookBadJson': 'JSON parse failed',
      'panel.taskBookNotArray': 'Not an array',
      'panel.taskBookBadEntry': 'Entry missing role/task',
      'panel.taskBookUnknownRole': 'Unknown role',
      'panel.taskBookShort': 'Task too short',
      'panel.upstreamFailed': 'Upstream failed; retry or skip it first: ',
      'panel.qualityWarnings': 'Artifact quality warnings',
      'panel.qualityLow': 'Artifact quality failed',
      'quality.missingSections': 'Missing common section headings',
      'proposal.stale': 'Stale proposal — state changed, not executed',
      'notify.enable': 'Enable notifications',
      'budget.label': 'Budget',
      'budget.unlimited': 'unlimited',
      'budget.edit': 'Edit budget',
      'budget.placeholder': 'tokens; empty = unlimited',
      'budget.save': 'Save',
      'budget.cancel': 'Cancel',
      'budget.exhausted': 'Budget exhausted — dispatch paused',
      'budget.percent': 'Budget {n}%',
      'budget.invalid': 'Enter a valid number',
      'notify.blocked': 'Member blocked',
      'notify.inbox': 'Inbox',
      'notify.markRead': 'Mark all read',
      'notify.empty': 'No notifications',
      'notify.kind.proposal': 'Proposal',
      'notify.kind.assignments': 'Task book',
      'notify.kind.blocked': 'Blocked',
      'notify.kind.stalled': 'Stalled',
      'notify.kind.failed': 'Failed',
      'notify.kind.budget': 'Budget',
      'notify.stalled': 'Member stalled',
      'captain.busy': 'Captain thinking',
      'captain.audit': 'Captain actions',
      'captain.act.dispatch': 'dispatch',
      'captain.act.message': 'message',
      'captain.act.start': 'start',
      'captain.act.stop': 'stop',
      'captain.act.revise': 'revise',
      'captain.act.feedback': 'feedback',
      'captain.act.stall': 'stall',
      'captain.act.setAuto': 'auto',
      'panel.recent': 'Recent activity',
      'captain.channel': 'Captain channel',
      'captain.empty': 'Tell the captain what to change; it will analyze and dispatch.',
      'captain.open': 'Open captain Session',
      'captain.send': 'Message the captain',
      'captain.placeholder': 'e.g. Core B should redraw the chart; do not change the conclusion.',
      'captain.notStarted': 'The captain has not started yet; run "Start now" or open its Session.',
      'captain.sent': 'Sent to the captain',
      'captain.failed': 'Could not deliver',
      'panel.resume': 'Start now',
      'panel.readOnlyChip': 'Read-only',
      'panel.blockedNoOutput': 'No hand-off or artifact for two rounds',
      'panel.blockedMissing': 'Declared artifacts are missing',
      'panel.blockedMember': 'The member reported it cannot continue',
      'panel.blockers': 'Blockers',
      'editor.readOnly': 'Run read-only (cannot write files)',
      'editor.readOnlyHint': 'Recommended for review roles: the plugin writes the hand-off for them, so they cannot audit their own edits.',
      'editor.preflightBrief': 'The brief is too short — write it out first',
      'editor.preflightTask': 'A role has no responsibility text',
      'editor.preflightName': 'A role has no name',
      'editor.preflightModel': 'Model unavailable',
      'footer.blocked': 'A member is blocked',
      'editor.draft': 'Draft',
      'editor.subtitle': 'Draft · shape the roles and workflow on the canvas, then confirm to start',
      'editor.hint': 'Drag cards to arrange; drag from a card bottom dot to another card to link; click a link to remove it.',
      'editor.addCaptain': '+ Captain',
      'editor.addCore': '+ Core',
      'editor.addMember': '+ Member',
      'editor.save': 'Save draft',
      'editor.confirm': 'Confirm and start',
      'editor.name': 'Name',
      'editor.kind': 'Kind',
      'editor.task': 'Responsibility',
      'editor.model': 'Model',
      'editor.defaultModel': 'Default model (follows the session setting)',
      'editor.deps': 'Depends on',
      'editor.delete': 'Delete role',
      'editor.captain': 'Captain',
      'editor.core': 'Core',
      'editor.member': 'Member',
      'editor.saved': 'Draft saved',
      'editor.needCaptain': 'Exactly one captain is required',
      'editor.needMore': 'At least two members are required',
      'editor.cycle': 'The dependencies form a cycle',
      'editor.missingDep': 'A dependency names a missing role',
      'editor.selfDep': 'A role cannot depend on itself',
      'editor.confirmHint': 'Confirming locks the workflow and starts work',
      'editor.loading': 'Loading models…',
      'footer.draft': 'Draft',
      'panel.noArtifacts': 'No artifacts yet',
      'panel.progressOf': 'Progress {done}/{total}',
      'panel.created': 'Team created',
      'panel.started': 'Dispatched',
      'panel.stoppedMsg': 'Stopped',
      'panel.sentMsg': 'Instruction queued',
      'panel.delete': 'Delete team',
      'panel.deleteConfirm': 'Click again to delete',
      'panel.verdictPass': 'Review passed',
      'panel.verdictRevise': 'Revision needed',
      'panel.log': 'Activity',
      'footer.label': 'Team',
      'footer.none': 'No team',
      'footer.running': '{name} running',
      'footer.done': 'All done',
      'footer.revise': 'Revision needed',
      'footer.failed': 'A member failed',
      'footer.idle': 'Idle',
    }

    // ---------------------------------------------------------------- store --
    function createStore() {
      let snapshot = { loaded: false, error: null, teams: [], defaultCwd: '', active: 0 }
      const listeners = new Set()
      let inflight = null
      const get = () => snapshot
      const set = next => {
        if (next === snapshot) return
        if (JSON.stringify(next) === JSON.stringify(snapshot)) return
        snapshot = next
        for (const listener of Array.from(listeners)) listener()
      }
      const subscribe = listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
      return { get, set, subscribe, get inflight() { return inflight }, setInflight(v) { inflight = v } }
    }

    const store = createStore()

    const sleepers = new Set()
    const wake = () => {
      for (const fn of Array.from(sleepers)) {
        try { fn() } catch { /* listener errors are contained */ }
      }
    }

    async function refresh() {
      if (store.inflight) return store.inflight
      const run = fetch(`${API}/state`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'x-competition-team': '1', ...TOKEN_HEADER },
      }).then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()
        store.set({
          loaded: true,
          error: null,
          teams: Array.isArray(data.teams) ? data.teams : [],
          defaultCwd: data.defaultCwd || '',
          active: Number(data.active) || 0,
        })
      }).catch(error => {
        store.set({ ...store.get(), loaded: true, error: String(error && error.message ? error.message : error) })
      }).finally(() => {
        store.setInflight(null)
        wake()
      })
      store.setInflight(run)
      return run
    }

    async function act(payload) {
      const response = await fetch(`${API}/action`, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', 'x-competition-team': '1', ...TOKEN_HEADER },
        body: JSON.stringify(payload),
      })
      let data = {}
      try { data = await response.json() } catch { data = { ok: false, error: `HTTP ${response.status}` } }
      await refresh()
      return data
    }

    function fileUrl(teamId, rel) {
      return `${API}/file?team=${encodeURIComponent(teamId)}&path=${encodeURIComponent(rel)}`
    }

    // ------------------------------------------------------------- helpers --
    const STATUS_KEY = {
      running: 'panel.running',
      done: 'panel.done',
      pending: 'panel.pending',
      failed: 'panel.failed',
      stopped: 'panel.stopped',
      blocked: 'panel.blocked',
      stalled: 'panel.stalled',
      skipped: 'panel.skipped',
      retrying: 'panel.retrying',
    }

    function elapsedText(ms) {
      if (!Number.isFinite(ms) || ms <= 0) return ''
      const sec = Math.round(ms / 1000)
      if (sec < 60) return `${sec}s`
      const min = Math.floor(sec / 60)
      if (min < 60) return `${min}m${String(sec % 60).padStart(2, '0')}s`
      return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, '0')}m`
    }

    function formatTokens(value) {
      const n = Math.max(0, Number(value) || 0)
      if (n < 1000) return String(n)
      if (n < 1000000) return (n / 1000).toFixed(n < 10000 ? 1 : 0) + 'k'
      return (n / 1000000).toFixed(2) + 'M'
    }

    function fill(template, params) {
      return String(template || '').replace(/\{(\w+)\}/g, (match, name) =>
        params && name in params ? String(params[name]) : match)
    }

    function toneOf(status) {
      if (status === 'running') return 'running'
      if (status === 'done') return 'done'
      if (status === 'failed') return 'failed'
      if (status === 'blocked') return 'blocked'
      if (status === 'stalled') return 'stalled'
      if (status === 'skipped') return 'skipped'
      if (status === 'retrying') return 'retrying'
      if (status === 'stopped') return 'stopped'
      return 'pending'
    }

    function blockedText(t, reason) {
      if (reason === 'stalled') return t('panel.stalledReason')
      if (reason === 'interrupted') return t('panel.interrupted')
      if (reason === 'retrying') return t('panel.retryWaiting')
      if (reason === 'transient-exhausted') return t('panel.retryExhausted')
      if (reason === 'low-quality-artifacts') return t('panel.qualityLow')
      if (reason === 'no-output') return t('panel.blockedNoOutput')
      if (reason === 'missing-artifacts') return t('panel.blockedMissing')
      if (reason === 'member-blocked') return t('panel.blockedMember')
      if (reason.startsWith('upstream-failed:')) {
        return t('panel.upstreamFailed') + reason.slice('upstream-failed:'.length).split(',').join('、')
      }
      return String(reason || '')
    }

    // ------------------------------------------------------------ icon/svg --
    function PanelGlyph({ size }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, 'data-dsh-panel-entry': PANEL,
      },
        h('circle', { cx: 12, cy: 5, r: 2.4 }),
        h('circle', { cx: 4.8, cy: 18.5, r: 2.4 }),
        h('circle', { cx: 12, cy: 18.5, r: 2.4 }),
        h('circle', { cx: 19.2, cy: 18.5, r: 2.4 }),
        h('path', { d: 'M12 7.4v5.1' }),
        h('path', { d: 'M12 12.5 5.6 16.4' }),
        h('path', { d: 'M12 12.5v3.6' }),
        h('path', { d: 'M12 12.5l6.4 3.9' }),
      )
    }

    // ---------------------------------------------------------------- css ---
    const CSS = `
.ct-root { position:relative; display:flex; flex-direction:column; box-sizing:border-box; width:100%; height:100%; min-width:0; min-height:0;
  background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary);
  font-family:var(--dsw-font-family, inherit); font-size:13px; }
.ct-head { display:flex; align-items:center; gap:12px; padding:14px 18px 12px; border-bottom:1px solid var(--dsw-alias-border-l1); flex:none; }
.ct-head-main { display:flex; flex-direction:column; gap:2px; min-width:0; }
.ct-title { display:flex; align-items:center; gap:8px; font-size:15px; font-weight:600; }
.ct-sub { color:var(--dsw-alias-label-tertiary); font-size:12px; }
.ct-head-actions { margin-left:auto; display:flex; align-items:center; gap:8px; flex:none; }
.ct-btn { height:28px; padding:0 10px; border-radius:8px; border:1px solid var(--dsw-alias-border-l2);
  background:transparent; color:var(--dsw-alias-label-primary); font-size:12px; cursor:pointer; display:inline-flex; align-items:center; gap:6px; }
.ct-btn:hover { background:var(--dsw-alias-interactive-bg-hover); }
.ct-btn:disabled { opacity:.5; cursor:default; }
.ct-btn.primary { background:var(--dsw-alias-button-primary-fill); border-color:transparent; color:var(--dsw-alias-label-primary-foreground); }
.ct-btn.primary:hover { background:var(--dsw-alias-button-primary-hover); }
.ct-btn.danger { color:var(--dsw-alias-state-error-primary); }
.ct-btn.small { height:24px; padding:0 8px; font-size:11px; border-radius:6px; }
.ct-select { height:28px; border-radius:8px; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary); font-size:12px; padding:0 8px; }
.ct-toggle { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--dsw-alias-label-secondary); cursor:pointer; user-select:none; }
.ct-switch { width:28px; height:16px; border-radius:999px; background:var(--dsw-alias-border-l2); position:relative; transition:background .15s; }
.ct-switch.on { background:var(--dsw-alias-state-business-primary); }
.ct-switch i { position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%; background:#fff; transition:transform .15s; }
.ct-switch.on i { transform:translateX(12px); }
.ct-body { flex:1; min-height:0; display:grid; grid-template-columns:minmax(300px, 42%) minmax(0, 1fr); gap:0; }
.ct-tree { overflow:auto; padding:12px 10px 18px 18px; border-right:1px solid var(--dsw-alias-border-l1); }
.ct-detail { overflow:auto; padding:16px 20px 24px; min-width:0; }
.ct-section { font-size:11px; letter-spacing:.04em; text-transform:uppercase; color:var(--dsw-alias-label-tertiary); margin:0 0 8px; }
.ct-row { display:grid; grid-template-columns:20px minmax(0,1fr) auto; gap:10px; position:relative; padding:8px 8px 10px 0; cursor:pointer; border-radius:8px; }
.ct-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.ct-row.selected { background:var(--dsw-alias-bg-layer-2); box-shadow:inset 2px 0 0 var(--dsw-alias-state-business-primary); }
.ct-rail { display:flex; justify-content:center; position:relative; padding-top:6px; }
.ct-rail::before { content:''; position:absolute; top:22px; bottom:-16px; left:50%; width:1px; background:var(--dsw-alias-border-l2); }
.ct-row:last-child .ct-rail::before { display:none; }
.ct-dot { width:9px; height:9px; border-radius:50%; border:2px solid var(--dsw-alias-border-l3); background:var(--dsw-alias-bg-base); box-sizing:border-box; z-index:1; }
.ct-dot.running { border-color:var(--dsw-alias-state-business-primary); background:var(--dsw-alias-state-business-primary); animation:ct-pulse 1.2s ease-in-out infinite; }
.ct-dot.done { border-color:var(--dsw-alias-state-success-primary); background:var(--dsw-alias-state-success-primary); }
.ct-dot.failed { border-color:var(--dsw-alias-state-error-primary); background:var(--dsw-alias-state-error-primary); }
.ct-dot.stopped { border-color:var(--dsw-alias-state-warn-primary); background:var(--dsw-alias-state-warn-secondary); }
.ct-dot.blocked { border-color:var(--dsw-alias-state-error-primary); background:var(--dsw-alias-state-error-secondary); }
.ct-dot.stalled { border-color:var(--dsw-alias-state-warn-primary); background:var(--dsw-alias-state-warn-secondary); animation:ct-pulse 1.6s ease-in-out infinite; }
.ct-dot.skipped { border-color:var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-3); }
.ct-dot.retrying { border-color:var(--dsw-alias-state-warn-primary); background:var(--dsw-alias-state-warn-secondary); animation:ct-pulse 1.2s ease-in-out infinite; }
.ct-status.retrying { color:var(--dsw-alias-state-warn-primary); }
.ct-status.skipped { color:var(--dsw-alias-label-tertiary); }
.ct-status.stalled { color:var(--dsw-alias-state-warn-primary); }
.ct-foot-badge.stalled { background:var(--dsw-alias-state-warn-primary); }
.ct-mini i.stalled { background:var(--dsw-alias-state-warn-primary); }
.ct-proposals { display:flex; flex-direction:column; gap:8px; padding:10px 16px; flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); }
.ct-proposal { border:1px solid var(--dsw-alias-border-l2); border-radius:8px; padding:8px 10px;
  background:var(--dsw-alias-bg-base); display:flex; flex-direction:column; gap:3px; }
.ct-proposal-head { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:600; }
.ct-proposal-body { font-size:12px; color:var(--dsw-alias-label-secondary); white-space:pre-wrap; }
.ct-proposal-actions { display:flex; gap:8px; margin-top:4px; }
.ct-proposal-editor { display:flex; flex-direction:column; gap:6px; margin-top:4px; }
.ct-proposal-editor textarea { min-height:52px; resize:vertical; }
.ct-proposal-history { border-top:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base);
  padding:8px 16px; flex:none; }
.ct-proposal-history summary { cursor:pointer; font-size:12px; color:var(--dsw-alias-label-secondary); }
.ct-history-list { display:flex; flex-direction:column; gap:3px; margin-top:6px; max-height:170px; overflow:auto; }
.ct-history-row { display:flex; gap:8px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.ct-history-time { flex:none; font-variant-numeric:tabular-nums; }
.ct-history-status { flex:none; }
.ct-history-status.approved { color:var(--dsw-alias-state-success-primary); }
.ct-history-status.rejected, .ct-history-status.stale, .ct-history-status.expired { color:var(--dsw-alias-state-warn-primary); }
.ct-history-status.failed { color:var(--dsw-alias-state-error-primary); }
.ct-budget { cursor:pointer; }
.ct-budget.warned { color:var(--dsw-alias-state-warn-primary); border-color:var(--dsw-alias-state-warn-primary); }
.ct-budget.exhausted { color:var(--dsw-alias-state-error-primary); border-color:var(--dsw-alias-state-error-primary); }
.ct-budget-form { display:flex; gap:8px; align-items:center; padding:8px 16px; flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); }
.ct-captain-audit { display:flex; flex-direction:column; gap:2px; padding:6px 16px; flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); }
.ct-inbox { display:flex; flex-direction:column; gap:3px; padding:8px 16px; flex:none;
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); max-height:180px; overflow:auto; }
.ct-inbox-head { display:flex; align-items:center; gap:8px; justify-content:space-between; font-size:12px; }
.ct-inbox-row { display:flex; gap:8px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.ct-inbox-row.unread { color:var(--dsw-alias-label-primary); }
.ct-inbox-time { flex:none; font-variant-numeric:tabular-nums; }
.ct-assign-warn { padding:6px 16px; flex:none; font-size:11px; color:var(--dsw-alias-state-warn-primary);
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); }
.ct-budget-note { padding:6px 16px; flex:none; font-size:11px; color:var(--dsw-alias-state-error-primary);
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); }
  border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-base); }
.ct-captain-audit .ct-recent-line { font-size:11px; }
.ct-status.blocked { color:var(--dsw-alias-state-error-primary); }
.ct-foot-badge.blocked { background:var(--dsw-alias-state-error-primary); }
.ct-mini i.blocked { background:var(--dsw-alias-state-error-primary); }
@keyframes ct-pulse { 0%,100% { opacity:1; box-shadow:0 0 0 0 rgba(64,128,255,.35); } 50% { opacity:.65; box-shadow:0 0 0 4px rgba(64,128,255,0); } }
.ct-row-top { display:flex; align-items:baseline; gap:8px; min-width:0; }
.ct-name { font-weight:600; font-size:13px; white-space:nowrap; }
.ct-status { font-size:11px; color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.ct-status.running { color:var(--dsw-alias-state-business-primary); }
.ct-status.done { color:var(--dsw-alias-state-success-primary); }
.ct-status.failed { color:var(--dsw-alias-state-error-primary); }
.ct-elapsed { margin-left:auto; font-size:11px; color:var(--dsw-alias-label-tertiary); font-variant-numeric:tabular-nums; }
.ct-task { color:var(--dsw-alias-label-secondary); font-size:12px; margin-top:3px; line-height:1.45; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ct-progress { color:var(--dsw-alias-label-tertiary); font-size:11px; margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ct-row-side { display:flex; flex-direction:column; align-items:flex-end; gap:4px; }
.ct-chip { font-size:10px; color:var(--dsw-alias-label-tertiary); border:1px solid var(--dsw-alias-border-l1); border-radius:999px; padding:1px 7px; white-space:nowrap; }
.ct-empty { margin:24px; border:1px dashed var(--dsw-alias-border-l2); border-radius:12px; padding:28px; text-align:center; color:var(--dsw-alias-label-secondary); }
.ct-empty p { margin:0 0 14px; line-height:1.6; }
.ct-detail-head { display:flex; align-items:center; gap:10px; margin-bottom:4px; }
.ct-detail-name { font-size:16px; font-weight:600; }
.ct-detail-actions { display:flex; flex-wrap:wrap; gap:8px; margin:12px 0 18px; }
.ct-block { margin-bottom:18px; min-width:0; }
.ct-pre { margin:0; padding:10px 12px; border-radius:10px; background:var(--dsw-alias-bg-layer-2); border:1px solid var(--dsw-alias-border-l1);
  font-size:12px; line-height:1.6; white-space:pre-wrap; word-break:break-word; color:var(--dsw-alias-label-secondary); }
.ct-detail-inner { max-width:780px; }
.ct-preview-mask { position:absolute; inset:0; z-index:40; background:var(--dsw-alias-bg-mask-1);
  display:flex; align-items:center; justify-content:center; padding:24px; }
.ct-preview { width:min(940px, 94%); max-height:90%; display:flex; flex-direction:column; gap:10px;
  background:var(--dsw-alias-bg-base); border:1px solid var(--dsw-alias-border-l2); border-radius:12px;
  padding:14px; box-shadow:var(--dsw-shadow-lv3); }
.ct-preview-head { display:flex; align-items:center; gap:10px; }
.ct-preview-title { font-weight:600; font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ct-preview img { display:block; max-width:100%; max-height:72vh; margin:0 auto; object-fit:contain;
  background:var(--dsw-alias-bg-layer-2); border-radius:8px; }
.ct-preview pre { max-height:66vh; overflow:auto; }
.ct-summary { cursor:pointer; list-style:none; user-select:none; }
.ct-summary::before { content:'▸ '; }
details[open] > .ct-summary::before { content:'▾ '; }
.ct-log-line.error { color:var(--dsw-alias-state-error-primary); }
.ct-mini i.done { background:var(--dsw-alias-state-success-primary); }
.ct-mini i.warn { background:var(--dsw-alias-state-warn-primary); }
.ct-foot-badge.warn { background:var(--dsw-alias-state-warn-primary); }
.ct-gallery { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:10px; }
.ct-shot { border:1px solid var(--dsw-alias-border-l1); border-radius:10px; overflow:hidden; background:var(--dsw-alias-bg-layer-2); }
.ct-shot button { display:block; width:100%; padding:0; border:0; background:transparent; cursor:zoom-in; }
.ct-shot img { display:block; width:100%; height:120px; object-fit:contain; background:var(--dsw-alias-bg-layer-2); }
.ct-shot figcaption { padding:5px 8px; font-size:11px; color:var(--dsw-alias-label-tertiary); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ct-files { display:flex; flex-direction:column; gap:4px; }
.ct-file { font-size:12px; color:var(--dsw-alias-label-secondary); text-align:left; width:100%; padding:5px 8px; border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); cursor:pointer; font-family:inherit; }
.ct-file:hover { background:var(--dsw-alias-interactive-bg-hover); border-color:var(--dsw-alias-border-l1); }
.ct-composer { display:flex; gap:8px; align-items:flex-end; }
.ct-input { flex:1; min-height:30px; max-height:120px; resize:vertical; border-radius:8px; border:1px solid var(--dsw-alias-border-l2);
  background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary); padding:6px 9px; font-size:12px; font-family:inherit; }
.ct-form { display:flex; flex-direction:column; gap:10px; padding:14px 18px; border-bottom:1px solid var(--dsw-alias-border-l1); background:var(--dsw-alias-bg-layer-2); }
.ct-field { display:flex; flex-direction:column; gap:4px; }
.ct-field label { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.ct-field input, .ct-field textarea { border-radius:8px; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary); padding:7px 9px; font-size:12px; font-family:inherit; }
.ct-field textarea { min-height:72px; resize:vertical; }
.ct-form-row { display:flex; gap:10px; }
.ct-form-row .ct-field { flex:1; }
.ct-log { flex:none; border-top:1px solid var(--dsw-alias-border-l1); padding:8px 18px; max-height:84px; overflow:auto;
  display:flex; flex-direction:column; gap:2px; }
.ct-log-line { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.ct-note { font-size:12px; color:var(--dsw-alias-state-error-primary); }
.ct-verdict { font-size:11px; border-radius:999px; padding:2px 8px; border:1px solid currentColor; }
.ct-verdict.revise { color:var(--dsw-alias-state-warn-primary); }
.ct-verdict.pass { color:var(--dsw-alias-state-success-primary); }
.ct-foot-row { display:flex; align-items:center; gap:8px; width:100%; padding:6px 8px; border-radius:8px; cursor:pointer;
  color:var(--dsw-alias-label-secondary); font-size:12px; min-width:0; }
.ct-foot-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
.ct-foot-rail { display:flex; align-items:center; justify-content:center; width:32px; height:32px; border-radius:8px; cursor:pointer; position:relative; color:var(--dsw-alias-label-secondary); }
.ct-foot-rail:hover { background:var(--dsw-alias-interactive-bg-hover); }
.ct-foot-badge { position:absolute; right:2px; bottom:2px; width:7px; height:7px; border-radius:50%; border:2px solid var(--dsw-alias-bg-base); }
.ct-foot-badge.running { background:var(--dsw-alias-state-business-primary); animation:ct-pulse 1.2s ease-in-out infinite; }
.ct-foot-badge.done { background:var(--dsw-alias-state-success-primary); }
.ct-foot-badge.idle { background:var(--dsw-alias-label-tertiary); }
.ct-foot-label { font-weight:600; white-space:nowrap; color:var(--dsw-alias-label-primary); }
.ct-foot-pending { flex:none; font-size:11px; color:var(--dsw-alias-state-warn-primary); }
.ct-foot-meta { margin-left:auto; font-size:11px; color:var(--dsw-alias-label-tertiary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ct-mini { width:60px; height:4px; border-radius:999px; background:var(--dsw-alias-border-l1); overflow:hidden; flex:none; }
.ct-mini i { display:block; height:100%; background:var(--dsw-alias-state-business-primary); transition:width .3s; }
.ct-captain { display:flex; align-items:center; gap:10px; padding:7px 16px; border-bottom:1px solid var(--dsw-alias-border-l1);
  flex:none; background:var(--dsw-alias-bg-layer-2); }
.ct-captain-label { font-weight:600; font-size:12px; white-space:nowrap; }
.ct-captain-latest { flex:1; min-width:0; font-size:12px; color:var(--dsw-alias-label-tertiary);
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ct-captain-form { display:flex; gap:8px; align-items:flex-end; padding:10px 16px; border-bottom:1px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-layer-2); flex:none; }
.ct-recent { display:flex; flex-direction:column; gap:3px; }
.ct-recent-line { display:flex; gap:8px; font-size:11px; color:var(--dsw-alias-label-tertiary); }
.ct-recent-time { flex:none; font-variant-numeric:tabular-nums; }
.ct-editor { flex:1; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 320px;
  background:var(--dsw-alias-bg-layer-2); }
.ct-canvas-wrap { display:flex; flex-direction:column; min-width:0; min-height:0; border-right:1px solid var(--dsw-alias-border-l1); }
.ct-toolbar { display:flex; align-items:center; gap:8px; padding:9px 14px; border-bottom:1px solid var(--dsw-alias-border-l1); flex-wrap:wrap; flex:none; }
.ct-toolbar .ct-hint { font-size:11px; color:var(--dsw-alias-label-tertiary); margin-right:auto; max-width:520px; line-height:1.4; }
.ct-canvas { position:relative; flex:1; min-height:360px; overflow:hidden;
  background-image:radial-gradient(circle, var(--dsw-alias-border-l1) 1px, transparent 1px);
  background-size:22px 22px; background-color:var(--dsw-alias-bg-base); }
.ct-edges { position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
.ct-edge { fill:none; stroke:var(--dsw-alias-state-business-primary); stroke-width:1.6; opacity:.9; vector-effect:non-scaling-stroke; }
.ct-edge-hit { fill:none; stroke:transparent; stroke-width:14; pointer-events:stroke; cursor:pointer; }
.ct-edge-hit:hover + .ct-edge, .ct-edge.hover { opacity:1; }
.ct-node { position:absolute; width:190px; transform:translate(-50%,-50%); touch-action:none; }
.ct-node-card { position:relative; border:1px solid var(--dsw-alias-border-l2); border-left:3px solid var(--dsw-alias-border-l3);
  border-radius:10px; padding:8px 10px; background:var(--dsw-alias-bg-layer-2); cursor:grab; box-shadow:var(--dsw-shadow-lv1); }
.ct-node-card.kind-captain { border-left-color:var(--dsw-alias-state-business-primary); }
.ct-node-card.kind-core { border-left-color:var(--dsw-alias-state-warn-primary); }
.ct-node-card.kind-member { border-left-color:var(--dsw-alias-label-tertiary); }
.ct-node-card.selected { border-color:var(--dsw-alias-state-business-primary); box-shadow:0 0 0 1px var(--dsw-alias-state-business-primary); }
.ct-node-head { display:flex; align-items:center; gap:6px; min-width:0; }
.ct-node-name { font-weight:600; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ct-kind { font-size:10px; padding:1px 6px; border-radius:999px; border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-tertiary); white-space:nowrap; }
.ct-kind.kind-captain { color:var(--dsw-alias-state-business-primary); border-color:currentColor; }
.ct-kind.kind-core { color:var(--dsw-alias-state-warn-primary); border-color:currentColor; }
.ct-node-task { font-size:11px; color:var(--dsw-alias-label-tertiary); margin-top:4px; max-height:28px; overflow:hidden; }
.ct-node-model { font-size:10px; color:var(--dsw-alias-label-tertiary); margin-top:4px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ct-port { position:absolute; width:13px; height:13px; border-radius:50%; border:2px solid var(--dsw-alias-state-business-primary);
  background:var(--dsw-alias-bg-base); cursor:crosshair; z-index:2; }
.ct-port.in { top:-7px; left:50%; transform:translateX(-50%); }
.ct-port.out { bottom:-7px; left:50%; transform:translateX(-50%); }
.ct-inspector { overflow:auto; padding:14px; display:flex; flex-direction:column; gap:10px; min-width:0; }
.ct-seg { display:flex; gap:4px; }
.ct-seg button { flex:1; height:26px; font-size:11px; border-radius:6px; border:1px solid var(--dsw-alias-border-l2);
  background:transparent; color:var(--dsw-alias-label-secondary); cursor:pointer; }
.ct-seg button.on { border-color:var(--dsw-alias-state-business-primary); color:var(--dsw-alias-state-business-primary); }
.ct-deps { display:flex; flex-wrap:wrap; gap:4px; min-height:20px; }
.ct-dep { display:inline-flex; align-items:center; gap:4px; font-size:11px; border:1px solid var(--dsw-alias-border-l1);
  border-radius:999px; padding:2px 7px; color:var(--dsw-alias-label-secondary); }
.ct-dep button { border:0; background:transparent; color:inherit; cursor:pointer; padding:0; font-size:12px; line-height:1; }
@media (max-width: 900px) { .ct-editor { grid-template-columns:1fr; } .ct-inspector { border-top:1px solid var(--dsw-alias-border-l1); } }
@media (max-width: 820px) { .ct-body { grid-template-columns:1fr; } .ct-detail { border-top:1px solid var(--dsw-alias-border-l1); } }
`

    // ------------------------------------------------------------- pieces ---
    function StatusPill({ status, t }) {
      const key = STATUS_KEY[status] || 'panel.pending'
      return h('span', { className: `ct-status ${toneOf(status)}` }, t(key))
    }

    function MemberRow({ member, team, selected, onSelect, t }) {
      const depNames = member.deps.map(dep => {
        const upstream = team.members.find(item => item.role === dep)
        return upstream ? upstream.name : dep
      })
      const waiting = member.status === 'pending' && depNames.length > 0
        ? fill(t('panel.waitingDeps'), { names: depNames.join('、') })
        : ''
      const progress = member.progress || waiting || (member.status === 'done' ? (member.snippet || '') : '')
      const chips = []
      if (member.readOnly) chips.push(h('span', { key: 'r', className: 'ct-chip' }, t('panel.readOnlyChip')))
      if (member.artifactCount > 0) chips.push(h('span', { key: 'a', className: 'ct-chip' }, `${member.artifactCount} 产物`))
      if (member.sessionId) chips.push(h('span', { key: 's', className: 'ct-chip' }, '会话'))
      return h('div', {
        className: `ct-row${selected ? ' selected' : ''}`,
        role: 'button',
        tabIndex: 0,
        onClick: () => onSelect(member.role),
        onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(member.role) } },
        'data-role': member.role,
        'data-status': member.status,
      },
        h('span', { className: 'ct-rail' }, h('i', { className: `ct-dot ${toneOf(member.status)}` })),
        h('div', { style: { minWidth: 0 } },
          h('div', { className: 'ct-row-top' },
            h('span', { className: 'ct-name' }, member.name),
            h('span', { className: 'ct-kind kind-' + (member.kind || 'member') }, kindText(t, member.kind || 'member')),
            h(StatusPill, { status: member.status, t }),
            member.status === 'running' || member.status === 'done'
              ? h('span', { className: 'ct-elapsed' }, elapsedText(member.elapsed))
              : null,
          ),
          h('div', { className: 'ct-task' }, member.task || '—'),
          progress ? h('div', { className: 'ct-progress' }, progress) : null,
        ),
        h('div', { className: 'ct-row-side' }, chips),
      )
    }

    function ArtifactGrid({ team, artifacts, t, onPreview }) {
      const images = artifacts.filter(file => file.kind === 'image')
      const files = artifacts.filter(file => file.kind !== 'image')
      if (artifacts.length === 0) return h('div', { className: 'ct-progress' }, t('panel.noArtifacts'))
      const open = (file) => onPreview({
        kind: file.kind === 'image' ? 'image' : 'text',
        url: fileUrl(team.id, file.rel),
        name: file.name,
        rel: file.rel,
      })
      return h('div', null,
        images.length > 0
          ? h('div', { className: 'ct-gallery' }, images.map(file => h('figure', { key: file.rel, className: 'ct-shot' },
            h('button', { type: 'button', onClick: () => open(file), title: file.rel },
              h('img', { src: fileUrl(team.id, file.rel), alt: file.name, loading: 'lazy' })),
            h('figcaption', { title: file.rel }, file.name),
          )))
          : null,
        files.length > 0
          ? h('div', { className: 'ct-files', style: { marginTop: images.length ? 10 : 0 } }, files.map(file =>
            h('button', {
              key: file.rel, type: 'button', className: 'ct-file', title: file.rel,
              onClick: () => open(file),
            }, `${file.name} · ${Math.max(1, Math.round(file.size / 102.4) / 10)} KB`)))
          : null,
      )
    }

    function PreviewOverlay({ preview, onClose, t }) {
      const [text, setText] = useState('')
      const [failure, setFailure] = useState('')
      useEffect(() => {
        setText('')
        setFailure('')
        if (!preview || preview.kind !== 'text') return undefined
        let cancelled = false
        fetch(preview.url, { cache: 'no-store', credentials: 'same-origin' })
          .then(response => (response.ok ? response.text() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then(value => { if (!cancelled) setText(value.slice(0, 200000)) })
          .catch(error => { if (!cancelled) setFailure(String(error && error.message ? error.message : error)) })
        return () => { cancelled = true }
      }, [preview && preview.url])
      useEffect(() => {
        if (!preview) return undefined
        const onKey = event => { if (event.key === 'Escape') onClose() }
        document.addEventListener('keydown', onKey)
        return () => document.removeEventListener('keydown', onKey)
      }, [preview, onClose])
      if (!preview) return null
      return h('div', {
        className: 'ct-preview-mask',
        role: 'dialog',
        'aria-label': preview.name,
        onClick: onClose,
      },
        h('div', { className: 'ct-preview', onClick: event => event.stopPropagation() },
          h('div', { className: 'ct-preview-head' },
            h('span', { className: 'ct-preview-title', title: preview.rel || preview.name }, preview.name),
            h('button', { className: 'ct-btn small', onClick: onClose }, t('panel.close')),
          ),
          preview.kind === 'image'
            ? h('img', { src: preview.url, alt: preview.name })
            : h('pre', { className: 'ct-pre' }, failure || text || t('panel.loading')),
        ))
    }

    function DetailPane({ team, member, t, actions, onPreview }) {
      const [handoff, setHandoff] = useState('')
      const [message, setMessage] = useState('')
      const [busy, setBusy] = useState('')
      const [failure, setFailure] = useState('')
      const [confirmRerun, setConfirmRerun] = useState(false)

      useEffect(() => {
        let cancelled = false
        setHandoff('')
        if (!member) return undefined
        fetch(fileUrl(team.id, member.handoff), { cache: 'no-store', credentials: 'same-origin' })
          .then(response => (response.ok ? response.text() : ''))
          .then(text => { if (!cancelled) setHandoff(text) })
          .catch(() => { if (!cancelled) setHandoff('') })
        return () => { cancelled = true }
      }, [team.id, member && member.role, member && member.handoff, team.updatedAt])

      if (!member) {
        return h('div', { className: 'ct-empty' }, h('p', null, t('panel.subtitle')))
      }

      const run = async (label, payload) => {
        setBusy(label)
        setFailure('')
        try {
          const result = await actions.act(payload)
          if (result && result.ok === false) {
            const names = (result.unmet || []).map(role => {
              const upstream = team.members.find(item => item.role === role)
              return upstream ? upstream.name : role
            })
            setFailure(names.length > 0
              ? `${t('panel.blockedBy')} ${names.join('、')}`
              : String(result.error || 'failed'))
          }
        } catch (error) {
          setFailure(String(error && error.message ? error.message : error))
        } finally {
          setBusy('')
        }
      }

      const unmet = member.deps.filter(dep => {
        const upstream = team.members.find(item => item.role === dep)
        return !upstream || (upstream.status !== 'done' && upstream.status !== 'skipped')
      })
      const canStart = member.status !== 'running'
      const rerun = member.rounds > 0 || member.status === 'done'
      return h('div', { className: 'ct-detail-inner' },
        h('div', { className: 'ct-detail-head' },
          h('span', { className: `ct-dot ${toneOf(member.status)}` }),
          h('span', { className: 'ct-detail-name' }, member.name),
          h(StatusPill, { status: member.status, t }),
          member.elapsed ? h('span', { className: 'ct-elapsed' }, elapsedText(member.elapsed)) : null,
          member.tokens ? h('span', { className: 'ct-elapsed', title: 'tokens' }, formatTokens(member.tokens)) : null,
        ),
        h('div', { className: 'ct-task', style: { whiteSpace: 'normal', marginTop: 6 } }, member.task || '—'),
        member.taskSource === 'captain'
          ? h('div', { className: 'ct-progress', style: { marginTop: 4 } },
            t('panel.taskFromCaptain') + (member.taskPending ? ' · ' + t('panel.taskPending') : ''))
          : null,
        member.kind !== 'captain'
          ? h('div', { className: 'ct-progress', style: { marginTop: 4 } },
            t('panel.reportsTo') + '：' + ((team.captain && team.captain.name) || '队长'))
          : null,
        member.error ? h('div', { className: 'ct-note', style: { marginTop: 8 } }, blockedText(t, member.error)) : null,
        member.retryAttempts > 0 && (member.status === 'retrying' || member.retryAttempts >= 2)
          ? h('div', { className: 'ct-progress', style: { marginTop: 4 } }, fill(t('panel.retryCount'), { n: member.retryAttempts }))
          : null,
        member.qualityWarnings && member.qualityWarnings.length > 0
          ? h('div', { className: 'ct-note', style: { marginTop: 6 } },
            t('panel.qualityWarnings') + '：' + member.qualityWarnings.map(code => {
              const [kind, ...rest] = String(code).split(':')
              if (kind === 'missing-sections') return t('quality.missingSections') + '：' + rest.join(':')
              return code
            }).join('；'))
          : null,
        member.readOnly ? h('div', { className: 'ct-progress', style: { marginTop: 6 } }, t('panel.readOnlyChip') + ' · ' + t('editor.readOnlyHint')) : null,
        member.blockers && member.blockers.length > 0
          ? h('div', { className: 'ct-note', style: { marginTop: 6 } }, t('panel.blockers') + '：' + member.blockers.join('；'))
          : null,
        failure ? h('div', { className: 'ct-note', style: { marginTop: 8 } }, failure) : null,
        h('div', { className: 'ct-detail-actions' },
          member.sessionId ? h('button', {
            className: 'ct-btn small',
            onClick: () => actions.openSession(member.sessionId),
          }, t('panel.openSession')) : null,
          canStart ? h('button', {
            className: 'ct-btn small',
            disabled: busy === 'start' || unmet.length > 0,
            title: unmet.length > 0 ? `${t('panel.blockedBy')} ${unmet.map(role => (team.members.find(item => item.role === role) || {}).name || role).join('、')}` : '',
            onClick: () => {
              if (rerun && !confirmRerun) { setConfirmRerun(true); return }
              setConfirmRerun(false)
              run('start', { action: 'start', teamId: team.id, role: member.role })
            },
          }, confirmRerun
            ? t('panel.confirmRerun')
            : member.status === 'stalled' || member.status === 'failed' || member.status === 'skipped'
              ? t('panel.continue')
              : rerun ? t('panel.rerun') : t('panel.start')) : null,
          member.status === 'stalled' || member.status === 'failed' || member.status === 'blocked'
            ? h('button', {
              className: 'ct-btn small',
              disabled: busy === 'skip',
              title: t('panel.blockedBy'),
              onClick: () => run('skip', { action: 'skip', teamId: team.id, role: member.role }),
            }, t('panel.skip'))
            : null,
          member.status === 'running' ? h('button', {
            className: 'ct-btn small danger',
            disabled: busy === 'stop',
            onClick: () => run('stop', { action: 'stop', teamId: team.id, role: member.role }),
          }, t('panel.stop')) : null,
        ),
        member.recent && member.recent.length > 0 ? h('div', { className: 'ct-block' },
          h('p', { className: 'ct-section' }, t('panel.recent')),
          h('div', { className: 'ct-recent' }, member.recent.slice().reverse().map((item, index) =>
            h('div', { key: index, className: 'ct-recent-line' },
              h('span', { className: 'ct-recent-time' }, new Date(item.t).toLocaleTimeString()),
              h('span', null, item.text),
            ))),
        ) : null,
        (member.artifacts || []).length > 0 ? h('div', { className: 'ct-block' },
          h('p', { className: 'ct-section' }, t('panel.artifacts')),
          h(ArtifactGrid, { team, artifacts: member.artifacts || [], t, onPreview }),
        ) : null,
        h('div', { className: 'ct-block' },
          h('p', { className: 'ct-section' }, t('panel.summary')),
          h('pre', { className: 'ct-pre' }, member.summary || t('panel.noSummary')),
        ),
        handoff ? h('details', { className: 'ct-block' },
          h('summary', { className: 'ct-section ct-summary' }, t('panel.handoff')),
          h('pre', { className: 'ct-pre' }, handoff),
        ) : h('div', { className: 'ct-block' },
          h('p', { className: 'ct-section' }, t('panel.handoff')),
          h('pre', { className: 'ct-pre' }, t('panel.noHandoff')),
        ),
        h('div', { className: 'ct-block' },
          h('p', { className: 'ct-section' }, t('panel.send')),
          h('div', { className: 'ct-composer' },
            h('textarea', {
              className: 'ct-input',
              placeholder: t('panel.sendPlaceholder'),
              value: message,
              onChange: event => setMessage(event.target.value),
            }),
            h('button', {
              className: 'ct-btn primary',
              disabled: busy === 'message' || message.trim().length === 0,
              onClick: async () => {
                const text = message.trim()
                if (!text) return
                setMessage('')
                await run('message', { action: 'message', teamId: team.id, role: member.role, text })
              },
            }, t('panel.send')),
          ),
        ),
      )
    }

    function CreateForm({ t, actions, defaultCwd, onClose }) {
      const [title, setTitle] = useState('')
      const [brief, setBrief] = useState('')
      const [cwd, setCwd] = useState(defaultCwd || '')
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      return h('div', { className: 'ct-form' },
        h('div', { className: 'ct-form-row' },
          h('div', { className: 'ct-field', style: { flex: 2 } },
            h('label', null, t('panel.createTitle')),
            h('input', { value: title, onChange: event => setTitle(event.target.value), placeholder: '例如：APMCM 2025 B 题' }),
          ),
          h('div', { className: 'ct-field', style: { flex: 1 } },
            h('label', null, t('panel.createCwd')),
            h('input', { value: cwd, onChange: event => setCwd(event.target.value), placeholder: defaultCwd || '' }),
          ),
        ),
        h('div', { className: 'ct-field' },
          h('label', null, t('panel.createBrief')),
          h('textarea', {
            value: brief,
            onChange: event => setBrief(event.target.value),
            placeholder: '把题目原文、数据位置、交付要求贴进来。成员都会读到这份 brief。',
          }),
        ),
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12 } },
          h('span', { className: 'ct-progress' }, t('editor.confirmHint')),
          error ? h('span', { className: 'ct-note' }, error) : null,
          h('span', { style: { marginLeft: 'auto', display: 'flex', gap: 8 } },
            h('button', { className: 'ct-btn', onClick: onClose }, t('panel.cancel')),
            h('button', {
              className: 'ct-btn primary',
              disabled: busy || title.trim().length === 0,
              onClick: async () => {
                setBusy(true)
                setError('')
                try {
                  const result = await actions.act({ action: 'create', title: title.trim(), brief, cwd })
                  if (result && result.ok === false) setError(result.error || 'failed')
                  else onClose()
                } catch (cause) {
                  setError(String(cause && cause.message ? cause.message : cause))
                } finally { setBusy(false) }
              },
            }, t('panel.confirm')),
          ),
        ),
      )
    }

    const KIND_ORDER = ['captain', 'core', 'member']

    function kindText(t, kind) {
      return kind === 'captain' ? t('editor.captain') : kind === 'core' ? t('editor.core') : t('editor.member')
    }

    function nodeModelText(model, catalog) {
      if (!model || !model.provider || !model.model) return null
      if (!catalog) return model.provider + ' / ' + model.model
      const group = (catalog.groups || []).find(item => item.id === model.provider)
      const found = group ? (group.models || []).find(item => item.id === model.model) : null
      return (group ? group.name : model.provider) + ' / ' + (found ? found.name : model.model)
    }

    function topoOk(nodes) {
      const indegree = new Map(nodes.map(node => [node.role, 0]))
      const children = new Map(nodes.map(node => [node.role, []]))
      for (const node of nodes) {
        for (const dep of node.deps) {
          if (!children.has(dep)) continue
          indegree.set(node.role, (indegree.get(node.role) || 0) + 1)
          children.get(dep).push(node.role)
        }
      }
      const queue = nodes.filter(node => (indegree.get(node.role) || 0) === 0).map(node => node.role)
      let seen = 0
      while (queue.length > 0) {
        const id = queue.shift()
        seen += 1
        for (const child of children.get(id) || []) {
          const next = (indegree.get(child) || 0) - 1
          indegree.set(child, next)
          if (next === 0) queue.push(child)
        }
      }
      return seen === nodes.length
    }

    function localValidate(nodes) {
      const errors = []
      const ids = new Set(nodes.map(node => node.role))
      if (nodes.length < 2) errors.push('need-more-members')
      if (nodes.filter(node => node.kind === 'captain').length !== 1) errors.push('need-exactly-one-captain')
      for (const node of nodes) {
        for (const dep of node.deps) {
          if (dep === node.role) errors.push('self-dependency')
          else if (!ids.has(dep)) errors.push('missing-dependency')
        }
      }
      if (!topoOk(nodes)) errors.push('cycle')
      return errors
    }

    function validationText(t, code, nodes) {
      if (code === 'need-exactly-one-captain') return t('editor.needCaptain')
      if (code === 'need-more-members') return t('editor.needMore')
      if (code === 'cycle') return t('editor.cycle')
      if (code === 'missing-dependency') return t('editor.missingDep')
      if (code === 'self-dependency') return t('editor.selfDep')
      if (code === 'brief-empty') return t('editor.preflightBrief')
      const roleName = role => {
        const node = (nodes || []).find(item => item.role === role)
        return node ? node.name : role
      }
      if (code.startsWith('task-empty:')) return t('editor.preflightTask') + '：' + roleName(code.slice('task-empty:'.length))
      if (code.startsWith('name-empty:')) return t('editor.preflightName') + '：' + roleName(code.slice('name-empty:'.length))
      if (code.startsWith('model-unavailable:')) return t('editor.preflightModel') + '：' + roleName(code.slice('model-unavailable:'.length))
      return code
    }

    function ModelPicker({ value, onChange, catalog, t }) {
      if (!catalog) return h('select', { className: 'ct-select', disabled: true }, h('option', null, t('editor.loading')))
      const current = value && value.provider && value.model ? value.provider + '::' + value.model : ''
      return h('select', {
        className: 'ct-select',
        value: current,
        onChange: event => {
          const raw = event.target.value
          if (!raw) { onChange(null); return }
          const parts = raw.split('::')
          onChange({ provider: parts[0], model: parts[1] })
        },
      },
        h('option', { value: '' }, t('editor.defaultModel')),
        (catalog.groups || []).map(group => h('optgroup', { key: group.id, label: group.name },
          (group.models || []).map(model => h('option', {
            key: group.id + '::' + model.id,
            value: group.id + '::' + model.id,
          }, model.name)))),
      )
    }

    function WorkflowEditor({ team, t, actions }) {
      const toNode = item => ({
        role: item.role,
        name: item.name,
        kind: item.kind || 'member',
        task: item.task || '',
        deps: Array.isArray(item.deps) ? item.deps.slice() : [],
        pos: item.pos && Number.isFinite(item.pos.x) && Number.isFinite(item.pos.y)
          ? { x: item.pos.x, y: item.pos.y }
          : { x: 0.5, y: 0.5 },
        model: item.model || null,
        readOnly: item.readOnly === true,
      })
      const [nodes, setNodes] = useState(() => team.members.map(toNode))
      const [selectedId, setSelectedId] = useState(() => (team.members[0] || {}).role || null)
      const [catalog, setCatalog] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [busy, setBusy] = useState('')
      const [linkFrom, setLinkFrom] = useState(null)
      const [cursor, setCursor] = useState({ x: 0, y: 0 })
      const canvasRef = useRef(null)
      const dragRef = useRef(null)

      useEffect(() => {
        setNodes(team.members.map(toNode))
        setSelectedId((team.members[0] || {}).role || null)
      }, [team.id])

      useEffect(() => {
        let dead = false
        fetch('/competition-team/api/models', { cache: 'no-store', credentials: 'same-origin', headers: TOKEN_HEADER })
          .then(response => (response.ok ? response.json() : null))
          .then(value => { if (!dead && value && value.ok) setCatalog(value) })
          .catch(() => { /* the model list is optional */ })
        return () => { dead = true }
      }, [])

      const selected = nodes.find(node => node.role === selectedId) || null
      const patchNode = (id, patch) => {
        setNodes(list => list.map(node => (node.role === id ? { ...node, ...patch } : node)))
      }
      const setKind = (id, kind) => {
        setNodes(list => list.map(node => {
          if (node.role === id) return { ...node, kind }
          if (kind === 'captain' && node.kind === 'captain') return { ...node, kind: 'core' }
          return node
        }))
      }
      const addNode = kind => {
        const ids = new Set(nodes.map(node => node.role))
        const base = kind === 'captain' ? 'captain' : kind + '-'
        let index = 1
        let role = kind === 'captain' ? 'captain' : base + index
        while (ids.has(role)) { index += 1; role = base + index }
        const name = kind === 'captain' ? '队长' : kind === 'core' ? '核心 ' + index : '队员 ' + index
        setNodes(list => [...list, {
          role, name, kind, task: '', deps: [], model: null,
          pos: { x: 0.5, y: 0.5 },
        }])
        setSelectedId(role)
      }
      const removeNode = id => {
        setNodes(list => list.filter(node => node.role !== id).map(node => ({
          ...node, deps: node.deps.filter(dep => dep !== id),
        })))
        if (selectedId === id) {
          const next = nodes.find(node => node.role !== id)
          setSelectedId(next ? next.role : null)
        }
      }

      const startDrag = (event, node) => {
        if (event.button !== 0) return
        if (event.target.closest && event.target.closest('.ct-port')) return
        event.stopPropagation()
        setSelectedId(node.role)
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const drag = {
          id: node.role,
          rect,
          offsetX: event.clientX - (rect.left + node.pos.x * rect.width),
          offsetY: event.clientY - (rect.top + node.pos.y * rect.height),
        }
        dragRef.current = drag
        const move = moveEvent => {
          const active = dragRef.current
          if (!active) return
          const x = Math.min(0.92, Math.max(0.08, (moveEvent.clientX - active.rect.left - active.offsetX) / active.rect.width))
          const y = Math.min(0.92, Math.max(0.08, (moveEvent.clientY - active.rect.top - active.offsetY) / active.rect.height))
          setNodes(list => list.map(item => (item.role === active.id ? { ...item, pos: { x, y } } : item)))
        }
        const up = () => {
          dragRef.current = null
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }

      const startLink = (event, node) => {
        event.stopPropagation()
        event.preventDefault()
        setLinkFrom(node.role)
        const canvas = canvasRef.current
        if (!canvas) return
        const rect = canvas.getBoundingClientRect()
        const track = moveEvent => {
          setCursor({
            x: Math.min(1, Math.max(0, (moveEvent.clientX - rect.left) / rect.width)),
            y: Math.min(1, Math.max(0, (moveEvent.clientY - rect.top) / rect.height)),
          })
        }
        const finish = upEvent => {
          const target = document.elementFromPoint(upEvent.clientX, upEvent.clientY)
          const holder = target && target.closest ? target.closest('[data-node]') : null
          const toId = holder ? holder.getAttribute('data-node') : null
          if (toId && toId !== node.role) {
            setNodes(list => list.map(item => (item.role === toId
              ? { ...item, deps: item.deps.includes(node.role) ? item.deps : [...item.deps, node.role] }
              : item)))
            setLinkFrom(null)
          }
          window.removeEventListener('pointermove', track)
          window.removeEventListener('pointerup', finish)
        }
        window.addEventListener('pointermove', track)
        window.addEventListener('pointerup', finish)
      }

      const edgePath = (from, to) => {
        const x1 = from.pos.x * 100
        const y1 = from.pos.y * 100 + 4
        const x2 = to.pos.x * 100
        const y2 = to.pos.y * 100 - 4
        const bend = Math.max(5, Math.abs(y2 - y1) / 2)
        return 'M ' + x1 + ' ' + y1 + ' C ' + x1 + ' ' + (y1 + bend) + ', ' + x2 + ' ' + (y2 - bend) + ', ' + x2 + ' ' + y2
      }

      const edges = []
      for (const node of nodes) {
        for (const dep of node.deps) {
          const from = nodes.find(item => item.role === dep)
          if (from) edges.push({ from, to: node })
        }
      }

      const serialize = () => nodes.map(node => ({
        role: node.role,
        name: node.name,
        kind: node.kind,
        task: node.task,
        deps: node.deps,
        pos: node.pos,
        model: node.model,
        readOnly: node.readOnly === true,
      }))

      const run = async confirm => {
        setError('')
        setNotice('')
        const errors = localValidate(nodes)
        if (confirm && errors.length > 0) {
          setError(errors.map(code => validationText(t, code)).join('；'))
          return
        }
        setBusy(confirm ? 'confirm' : 'save')
        try {
          const saved = await actions.act({ action: 'configure', teamId: team.id, members: serialize() })
          if (!saved || saved.ok === false) {
            setError(String((saved && saved.error) || 'save-failed'))
            return
          }
          if (!confirm) {
            setNotice(t('editor.saved'))
            return
          }
          const done = await actions.act({ action: 'confirm', teamId: team.id })
          if (!done || done.ok === false) {
            const details = done && Array.isArray(done.details) ? '：' + done.details.join('、') : ''
            setError(String((done && done.error) || 'confirm-failed') + details)
          }
        } catch (cause) {
          setError(String(cause && cause.message ? cause.message : cause))
        } finally {
          setBusy('')
        }
      }

      const linkSource = linkFrom ? nodes.find(node => node.role === linkFrom) : null

      return h('div', { className: 'ct-editor' },
        h('div', { className: 'ct-canvas-wrap' },
          h('div', { className: 'ct-toolbar' },
            h('span', { className: 'ct-hint' }, t('editor.hint')),
            h('button', {
              className: 'ct-btn small',
              disabled: nodes.some(node => node.kind === 'captain'),
              onClick: () => addNode('captain'),
            }, t('editor.addCaptain')),
            h('button', { className: 'ct-btn small', onClick: () => addNode('core') }, t('editor.addCore')),
            h('button', { className: 'ct-btn small', onClick: () => addNode('member') }, t('editor.addMember')),
            h('button', {
              className: 'ct-btn small',
              disabled: busy !== '',
              onClick: () => run(false),
            }, t('editor.save')),
            h('button', {
              className: 'ct-btn primary small',
              disabled: busy !== '',
              onClick: () => run(true),
            }, t('editor.confirm')),
          ),
          error ? h('div', { className: 'ct-form' }, h('span', { className: 'ct-note' }, error)) : null,
          notice ? h('div', { className: 'ct-form' }, h('span', { className: 'ct-progress' }, notice)) : null,
          h('div', {
            className: 'ct-canvas',
            ref: canvasRef,
            onClick: () => { if (linkFrom) setLinkFrom(null) },
          },
            h('svg', { className: 'ct-edges', viewBox: '0 0 100 100', preserveAspectRatio: 'none' },
              edges.map(edge => h('g', { key: edge.from.role + '>' + edge.to.role },
                h('path', { className: 'ct-edge', d: edgePath(edge.from, edge.to) }),
                h('path', {
                  className: 'ct-edge-hit',
                  d: edgePath(edge.from, edge.to),
                  onClick: event => {
                    event.stopPropagation()
                    setNodes(list => list.map(item => (item.role === edge.to.role
                      ? { ...item, deps: item.deps.filter(dep => dep !== edge.from.role) }
                      : item)))
                  },
                }),
              )),
              linkSource ? h('path', {
                className: 'ct-edge',
                style: { opacity: 0.35, strokeDasharray: '3 3' },
                d: edgePath(linkSource, { pos: cursor }),
              }) : null,
            ),
            nodes.map(node => h('div', {
              key: node.role,
              className: 'ct-node',
              'data-node': node.role,
              style: { left: node.pos.x * 100 + '%', top: node.pos.y * 100 + '%' },
              onPointerDown: event => startDrag(event, node),
              onClick: event => {
                event.stopPropagation()
                if (linkFrom && linkFrom !== node.role) {
                  setNodes(list => list.map(item => (item.role === node.role
                    ? { ...item, deps: item.deps.includes(linkFrom) ? item.deps : [...item.deps, linkFrom] }
                    : item)))
                  setLinkFrom(null)
                  return
                }
                setSelectedId(node.role)
              },
            },
              h('div', { className: 'ct-node-card kind-' + node.kind + (selectedId === node.role ? ' selected' : '') },
                h('div', { className: 'ct-node-head' },
                  h('span', { className: 'ct-node-name' }, node.name),
                  h('span', { className: 'ct-kind kind-' + node.kind }, kindText(t, node.kind)),
                  node.readOnly ? h('span', { className: 'ct-kind' }, t('panel.readOnlyChip')) : null,
                ),
                h('div', { className: 'ct-node-task' }, node.task || '—'),
                h('div', { className: 'ct-node-model' }, nodeModelText(node.model, catalog) || t('editor.defaultModel')),
                h('span', { className: 'ct-port in' }),
                h('span', { className: 'ct-port out', onPointerDown: event => startLink(event, node) }),
              ),
            )),
          ),
        ),
        h('div', { className: 'ct-inspector' },
          selected
            ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 10 } },
              h('div', { className: 'ct-field' },
                h('label', null, t('editor.name')),
                h('input', {
                  value: selected.name,
                  onChange: event => patchNode(selected.role, { name: event.target.value }),
                }),
              ),
              h('div', { className: 'ct-field' },
                h('label', null, t('editor.kind')),
                h('div', { className: 'ct-seg' }, KIND_ORDER.map(kind => h('button', {
                  key: kind,
                  className: selected.kind === kind ? 'on' : '',
                  onClick: () => setKind(selected.role, kind),
                }, kindText(t, kind)))),
              ),
              h('div', { className: 'ct-field' },
                h('label', null, t('editor.task')),
                h('textarea', {
                  value: selected.task,
                  onChange: event => patchNode(selected.role, { task: event.target.value }),
                }),
              ),
              h('div', { className: 'ct-field' },
                h('label', null, t('editor.model')),
                h(ModelPicker, {
                  value: selected.model,
                  catalog,
                  t,
                  onChange: value => patchNode(selected.role, { model: value }),
                }),
              ),
              h('div', { className: 'ct-field' },
                h('label', { className: 'ct-toggle', style: { color: 'var(--dsw-alias-label-secondary)' } },
                  h('input', {
                    type: 'checkbox',
                    checked: selected.readOnly === true,
                    onChange: event => patchNode(selected.role, { readOnly: event.target.checked }),
                  }),
                  t('editor.readOnly'),
                ),
                h('span', { className: 'ct-progress' }, t('editor.readOnlyHint')),
              ),
              h('div', { className: 'ct-field' },
                h('label', null, t('editor.deps')),
                h('div', { className: 'ct-deps' }, selected.deps.length === 0
                  ? h('span', { className: 'ct-progress' }, '—')
                  : selected.deps.map(dep => {
                    const source = nodes.find(node => node.role === dep)
                    return h('span', { key: dep, className: 'ct-dep' },
                      source ? source.name : dep,
                      h('button', {
                        onClick: () => patchNode(selected.role, {
                          deps: selected.deps.filter(item => item !== dep),
                        }),
                      }, '×'))
                  })),
              ),
              h('button', {
                className: 'ct-btn danger small',
                disabled: nodes.length <= 1,
                onClick: () => removeNode(selected.role),
              }, t('editor.delete')),
            )
            : h('div', { className: 'ct-progress' }, t('editor.hint')),
        ),
      )
    }

    function CaptainChannel({ team, t, actions, onPreview }) {
      const captain = team.captain || null
      const feedback = captain && Array.isArray(captain.feedback) ? captain.feedback : []
      const latest = feedback.length > 0 ? feedback[feedback.length - 1] : null
      const reply = captain && captain.reply ? captain.reply : null
      const [open, setOpen] = useState(false)
      const [text, setText] = useState('')
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState('')
      const audit = captain && Array.isArray(captain.audit) ? captain.audit : []
      const budget = team.budget || { used: 0, limit: null, percent: 0, state: 'ok' }
      const check = team.assignmentCheck || null
      const warningText = code => {
        if (code === 'no-block') return t('panel.taskBookNoBlock')
        if (code === 'malformed-json') return t('panel.taskBookBadJson')
        if (code === 'not-array') return t('panel.taskBookNotArray')
        if (code === 'bad-entry') return t('panel.taskBookBadEntry')
        if (code.startsWith('unknown-role:')) return t('panel.taskBookUnknownRole') + '：' + code.slice('unknown-role:'.length)
        if (code.startsWith('task-too-short:')) return t('panel.taskBookShort') + '：' + code.slice('task-too-short:'.length)
        return code
      }
      const [inboxOpen, setInboxOpen] = useState(false)
      const notifications = Array.isArray(team.notifications) ? team.notifications : []
      const unread = Number(team.unread) || 0
      const kindText = kind => {
        const key = 'notify.kind.' + kind
        const label = t(key)
        return label === key ? kind : label
      }
      const markRead = async () => {
        try {
          await actions.act({ action: 'readNotifications', teamId: team.id })
        } catch { /* refresh handles errors */ }
      }
      const [budgetOpen, setBudgetOpen] = useState(false)
      const [budgetValue, setBudgetValue] = useState(budget.limit ? String(budget.limit) : '')
      const [budgetError, setBudgetError] = useState('')
      const saveBudget = async () => {
        const raw = budgetValue.trim()
        const limit = raw === '' ? null : Number(raw)
        if (limit !== null && (!Number.isFinite(limit) || limit < 0)) {
          setBudgetError(t('budget.invalid'))
          return
        }
        setBudgetError('')
        try {
          const result = await actions.act({ action: 'setBudget', teamId: team.id, limit })
          if (result && result.ok === false) setBudgetError(String(result.error || 'failed'))
          else setBudgetOpen(false)
        } catch (error) {
          setBudgetError(String(error && error.message ? error.message : error))
        }
      }
      const proposals = (team.proposals || []).filter(item => item.status === 'pending' && !item.expired)
      const [deciding, setDeciding] = useState(null)
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState({ task: '', note: '' })
      const startEdit = proposal => {
        setEditing(proposal.id)
        setDraft({ task: proposal.task || '', note: proposal.note || '' })
        setNotice('')
      }
      const saveEdit = async proposal => {
        setNotice('')
        try {
          const result = await actions.act({
            action: 'editProposal',
            teamId: team.id,
            proposalId: proposal.id,
            task: draft.task,
            note: draft.note,
          })
          if (result && result.ok === false) {
            setNotice(t('proposal.failed') + '：' + String(result.error || ''))
          } else {
            setEditing(null)
          }
        } catch (error) {
          setNotice(String(error && error.message ? error.message : error))
        }
      }
      const [permission, setPermission] = useState(
        typeof Notification === 'undefined' ? 'denied' : Notification.permission,
      )
      const askPermission = async () => {
        try {
          const result = await Notification.requestPermission()
          setPermission(result)
        } catch {
          setPermission('denied')
        }
      }
      const decide = async (proposal, decision) => {
        setDeciding(proposal.id)
        setNotice('')
        try {
          const result = await actions.act({
            action: decision === 'approve' ? 'approveProposal' : 'rejectProposal',
            teamId: team.id,
            proposalId: proposal.id,
          })
          if (result && result.ok === false) {
            const code = String(result.error || '')
            if (code === 'proposal-stale') {
              const conflicts = Array.isArray(result.conflicts) ? '：' + result.conflicts.join(' / ') : ''
              setNotice(t('proposal.stale') + conflicts)
            } else {
              setNotice(t(decision === 'approve' ? 'proposal.failed' : 'proposal.done') + '：' + code)
            }
          }
        } catch (error) {
          setNotice(String(error && error.message ? error.message : error))
        } finally {
          setDeciding(null)
        }
      }
      const proposalStatus = proposal => {
        const key = 'proposal.status.' + (proposal.expired ? 'expired' : proposal.status)
        const label = t(key)
        return label === key ? proposal.status : label
      }
      const history = (team.proposals || [])
        .filter(item => item.status !== 'pending' || item.expired)
        .slice()
        .reverse()
      const proposalType = type => {
        const key = 'proposal.type.' + type
        const label = t(key)
        return label === key ? type : label
      }
      const actionText = action => {
        const key = 'captain.act.' + action
        const label = t(key)
        return label === key ? action : label
      }

      const latestText = !captain || !captain.sessionId
        ? t('captain.notStarted')
        : reply && latest
          ? (reply.t >= latest.t ? reply.text : latest.text)
          : reply ? reply.text : latest ? latest.text : t('captain.empty')

      const send = async () => {
        const value = text.trim()
        if (!value) return
        setBusy(true)
        setNotice('')
        try {
          const result = await actions.act({ action: 'feedback', teamId: team.id, text: value })
          if (result && result.ok === false) {
            setNotice(String(result.error) === 'budget-exhausted'
              ? t('budget.exhausted')
              : t('captain.failed') + '：' + String(result.error || ''))
          } else {
            setText('')
            setOpen(false)
            setNotice(t('captain.sent'))
          }
        } catch (error) {
          setNotice(t('captain.failed') + '：' + String(error && error.message ? error.message : error))
        } finally {
          setBusy(false)
        }
      }

      return h('div', null,
        h('div', { className: 'ct-captain' },
          h('span', { className: 'ct-captain-label' }, t('captain.channel')),
          captain && captain.busy ? h('span', { className: 'ct-chip' }, t('captain.busy')) : null,
          captain && captain.queue > 0 ? h('span', { className: 'ct-chip' }, fill(t('captain.queued'), { n: captain.queue })) : null,
          proposals.length > 0 ? h('span', { className: 'ct-chip' }, fill(t('proposal.pending'), { n: proposals.length })) : null,
          check && check.hasPlan
            ? h('button', {
              className: 'ct-btn small',
              onClick: () => onPreview && onPreview({
                kind: 'text',
                name: 'plan.md',
                rel: 'artifacts/captain/plan.md',
                url: fileUrl(team.id, 'artifacts/captain/plan.md'),
              }),
            }, t('panel.taskBook'))
            : null,
          unread > 0
            ? h('button', { className: 'ct-btn small', onClick: () => setInboxOpen(value => !value) },
              t('notify.inbox') + ' · ' + unread)
            : null,
          h('span', {
            className: 'ct-chip ct-budget ' + budget.state,
            title: t('budget.edit'),
            role: 'button',
            tabIndex: 0,
            onClick: () => setBudgetOpen(value => !value),
            onKeyDown: event => { if (event.key === 'Enter') setBudgetOpen(value => !value) },
          }, t('budget.label') + ' ' + formatTokens(budget.used) + ' / '
            + (budget.limit ? formatTokens(budget.limit) : t('budget.unlimited'))),
          h('span', { className: 'ct-captain-latest', title: latestText }, latestText),
          captain && captain.sessionId
            ? h('button', { className: 'ct-btn small', onClick: () => actions.openSession(captain.sessionId) }, t('captain.open'))
            : null,
          permission === 'default'
            ? h('button', { className: 'ct-btn small', onClick: askPermission }, t('notify.enable'))
            : null,
          h('button', {
            className: 'ct-btn small',
            disabled: !captain || !captain.sessionId,
            onClick: () => setOpen(value => !value),
          }, t('captain.send')),
        ),
        open && captain && captain.sessionId
          ? h('div', { className: 'ct-captain-form' },
            h('textarea', {
              className: 'ct-input',
              placeholder: t('captain.placeholder'),
              value: text,
              onChange: event => setText(event.target.value),
            }),
            h('button', {
              className: 'ct-btn primary small',
              disabled: busy || text.trim().length === 0,
              onClick: send,
            }, busy ? '…' : t('captain.send')),
          )
          : null,
        inboxOpen
          ? h('div', { className: 'ct-inbox' },
            h('div', { className: 'ct-inbox-head' },
              h('span', null, t('notify.inbox')),
              unread > 0 ? h('button', { className: 'ct-btn small', onClick: markRead }, t('notify.markRead')) : null,
            ),
            notifications.length === 0
              ? h('div', { className: 'ct-progress' }, t('notify.empty'))
              : notifications.slice().reverse().map(item => h('div', {
                key: item.id,
                className: 'ct-inbox-row' + (item.readAt ? '' : ' unread'),
              },
                h('span', { className: 'ct-inbox-time' }, new Date(item.t).toLocaleTimeString()),
                h('span', null, kindText(item.kind) + ' · ' + item.text),
              )),
          )
          : null,
        check && check.warnings && check.warnings.length > 0
          ? h('div', { className: 'ct-assign-warn' }, fill(t('panel.taskBookWarn'), { n: check.warnings.length })
            + '：' + check.warnings.map(warningText).join('；'))
          : null,
        budgetOpen
          ? h('div', { className: 'ct-budget-form' },
            h('input', {
              className: 'ct-input',
              type: 'number',
              min: 0,
              step: 1000,
              placeholder: t('budget.placeholder'),
              value: budgetValue,
              onChange: event => setBudgetValue(event.target.value),
              onKeyDown: event => { if (event.key === 'Enter') saveBudget() },
            }),
            h('button', { className: 'ct-btn small primary', onClick: saveBudget }, t('budget.save')),
            h('button', { className: 'ct-btn small', onClick: () => setBudgetOpen(false) }, t('budget.cancel')),
            budgetError ? h('span', { className: 'ct-progress', style: { color: 'var(--dsw-alias-state-error-primary)' } }, budgetError) : null,
          )
          : null,
        budget.state === 'exhausted'
          ? h('div', { className: 'ct-budget-note' }, t('budget.exhausted'))
          : null,
        proposals.length > 0
          ? h('div', { className: 'ct-proposals' },
            proposals.map(proposal => h('div', { key: proposal.id, className: 'ct-proposal' },
              h('div', { className: 'ct-proposal-head' },
                h('span', { className: 'ct-kind' }, proposalType(proposal.type)),
                h('span', null, proposal.from + (proposal.target ? ' → ' + proposal.target : '')),
                h('span', { className: 'ct-progress', style: { marginLeft: 'auto' } }, new Date(proposal.createdAt).toLocaleTimeString()),
              ),
              proposal.edited ? h('span', { className: 'ct-chip' }, t('proposal.edited')) : null,
              editing === proposal.id
                ? h('div', { className: 'ct-proposal-editor' },
                  h('textarea', {
                    className: 'ct-input',
                    placeholder: t('proposal.task'),
                    value: draft.task,
                    onChange: event => setDraft({ ...draft, task: event.target.value }),
                  }),
                  h('textarea', {
                    className: 'ct-input',
                    placeholder: t('proposal.note'),
                    value: draft.note,
                    onChange: event => setDraft({ ...draft, note: event.target.value }),
                  }),
                  h('div', { className: 'ct-proposal-actions' },
                    h('button', { className: 'ct-btn small primary', onClick: () => saveEdit(proposal) }, t('proposal.editSave')),
                    h('button', { className: 'ct-btn small', onClick: () => setEditing(null) }, t('proposal.editCancel')),
                  ),
                )
                : proposal.type === 'assignments'
                  ? h('div', null,
                    (proposal.assignments || []).map(item => h('div', { key: item.role, className: 'ct-proposal-body' },
                      (item.name || item.role) + '：' + item.task
                      + (item.oldTask && item.oldTask !== item.task ? '（原：' + item.oldTask + '）' : ''),
                    )),
                    h('div', { className: 'ct-proposal-body' }, proposal.note || t('proposal.assignmentsNote')),
                  )
                  : h('div', null,
                    proposal.task ? h('div', { className: 'ct-proposal-body' }, t('proposal.task') + '：' + proposal.task) : null,
                    proposal.note ? h('div', { className: 'ct-proposal-body' }, t('proposal.note') + '：' + proposal.note) : null,
                    proposal.reason ? h('div', { className: 'ct-proposal-body' }, t('proposal.reason') + '：' + proposal.reason) : null,
                  ),
              editing === proposal.id
                ? null
                : h('div', { className: 'ct-proposal-actions' },
                  h('button', {
                    className: 'ct-btn small primary',
                    disabled: deciding === proposal.id,
                    onClick: () => decide(proposal, 'approve'),
                  }, t('proposal.approve')),
                  h('button', {
                    className: 'ct-btn small',
                    disabled: deciding === proposal.id,
                    onClick: () => decide(proposal, 'reject'),
                  }, t('proposal.reject')),
                  proposal.type === 'assignments'
                    ? null
                    : h('button', {
                      className: 'ct-btn small',
                      disabled: deciding === proposal.id,
                      onClick: () => startEdit(proposal),
                    }, t('proposal.edit')),
                ),
            )),
          )
          : null,
        history.length > 0
          ? h('details', { className: 'ct-proposal-history' },
            h('summary', null, t('proposal.history') + ' · ' + history.length),
            h('div', { className: 'ct-history-list' }, history.map((item, index) => h('div', { key: item.id || index, className: 'ct-history-row' },
              h('span', { className: 'ct-history-time' }, new Date(item.decidedAt || item.createdAt).toLocaleTimeString()),
              h('span', { className: 'ct-history-status ' + (item.expired && item.status === 'pending' ? 'expired' : item.status) }, proposalStatus(item)),
              h('span', { className: 'ct-history-text' }, item.type === 'assignments'
                ? proposalType(item.type) + ' · ' + ((item.assignments || []).length) + ' 人'
                : proposalType(item.type) + ' → ' + (item.target || '全局')
                  + (item.task ? '：' + item.task : item.note ? '：' + item.note : '')),
            ))),
          )
          : null,
        notice ? h('div', { className: 'ct-captain' }, h('span', { className: 'ct-captain-latest' }, notice)) : null,
        audit.length > 0
          ? h('div', { className: 'ct-captain-audit' },
            audit.slice(-3).reverse().map((item, index) => h('div', { key: index, className: 'ct-recent-line' },
              h('span', { className: 'ct-recent-time' }, new Date(item.t).toLocaleTimeString()),
              h('span', null, ' ' + item.actor + ' · ' + actionText(item.action)
                + (item.target ? ' → ' + item.target : '')
                + (item.summary ? '：' + item.summary : '')),
            )))
          : null,
      )
    }

    const SELECTION_KEY = 'dsh.competition-team.selection'

    function readSelection() {
      try {
        const saved = JSON.parse(localStorage.getItem(SELECTION_KEY) || '{}')
        return { teamId: saved.teamId || null, role: saved.role || null }
      } catch {
        return { teamId: null, role: null }
      }
    }

    function TeamPage({ t, storeApi, actions }) {
      const snapshot = useSyncExternalStore(storeApi.subscribe, storeApi.get)
      const teams = snapshot.teams || []
      const initial = readSelection()
      const [teamId, setTeamId] = useState(initial.teamId)
      const [role, setRole] = useState(initial.role)
      const [creating, setCreating] = useState(false)
      const [confirmDelete, setConfirmDelete] = useState(false)
      const [busy, setBusy] = useState('')
      const [preview, setPreview] = useState(null)

      const team = useMemo(() => {
        const byId = teams.find(item => item.id === teamId)
        return byId || teams.find(item => item.status === 'running') || teams[0] || null
      }, [teams, teamId])

      useEffect(() => {
        try { localStorage.setItem(SELECTION_KEY, JSON.stringify({ teamId: team ? team.id : null, role })) } catch { /* storage is optional */ }
      }, [team && team.id, role])

      useEffect(() => {
        if (!team) { setRole(null); return }
        const exists = team.members.some(member => member.role === role)
        if (!exists) {
          const running = team.members.find(member => member.status === 'running')
          setRole((running || team.members[0] || {}).role || null)
        }
      }, [team && team.id])

      useEffect(() => {
        if (team && team.id !== teamId) setTeamId(team.id)
      }, [team && team.id])

      // Browser notifications for anything that needs the user: a new pending
      // proposal, a blocked member, a stalled member. Permission is requested
      // explicitly from the captain channel.
      const statusRef = useRef(new Map())
      useEffect(() => {
        if (!snapshot.loaded) return
        const key = 'dsh.competition-team.seenProposals'
        let seen = new Set()
        try {
          const raw = JSON.parse(localStorage.getItem(key) || '[]')
          if (Array.isArray(raw)) seen = new Set(raw.map(String))
        } catch { /* storage is optional */ }
        const fresh = []
        for (const item of teams) {
          for (const proposal of item.proposals || []) {
            if (proposal.status !== 'pending') continue
            if (!seen.has(proposal.id)) {
              fresh.push({ team: item, proposal })
              seen.add(proposal.id)
            }
          }
          for (const person of item.members) {
            const memberKey = item.id + ':' + person.role
            const previous = statusRef.current.get(memberKey)
            if (previous && previous !== person.status
              && (person.status === 'blocked' || person.status === 'stalled')) {
              fresh.push({ team: item, member: person })
            }
            statusRef.current.set(memberKey, person.status)
          }
        }
        try {
          localStorage.setItem(key, JSON.stringify([...seen].slice(-300)))
        } catch { /* storage is optional */ }
        if (fresh.length === 0) return
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
        for (const item of fresh.slice(0, 3)) {
          try {
            let body
            let tag
            if (item.proposal) {
              const typeKey = 'proposal.type.' + item.proposal.type
              const typeLabel = t(typeKey) === typeKey ? item.proposal.type : t(typeKey)
              body = typeLabel + ' → ' + (item.proposal.target || '全局')
                + (item.proposal.task || item.proposal.note ? '：' + (item.proposal.task || item.proposal.note) : '')
              tag = 'competition-proposal-' + item.proposal.id
            } else {
              body = item.member.name + ' · '
                + (item.member.status === 'stalled' ? t('notify.stalled') : t('notify.blocked'))
              tag = 'competition-member-' + item.team.id + '-' + item.member.role
            }
            const notification = new Notification('竞赛智队 · ' + item.team.title, { body, tag })
            notification.onclick = () => {
              try { window.focus() } catch { /* optional */ }
              if (actions.selectPanel) actions.selectPanel()
            }
          } catch { /* notifications are optional */ }
        }
      }, [snapshot])

      const member = team ? (team.members.find(item => item.role === role) || team.members[0] || null) : null
      const draft = Boolean(team && team.confirmed === false)
      const statusLabel = draft ? t('editor.draft') : !team ? t('panel.subtitle')
        : team.status === 'running' ? t('panel.running')
          : team.status === 'done' ? t('panel.done')
            : team.status === 'needsRevision' ? t('panel.verdictRevise')
              : team.status === 'blocked' ? t('panel.blocked')
                : team.status === 'stalled' ? t('panel.stalled')
                  : team.status === 'failed' ? t('panel.failed')
                  : t('panel.idle')

      if (!snapshot.loaded && !snapshot.error) {
        return h('div', { className: 'ct-root' }, h('style', null, CSS),
          h('div', { className: 'ct-empty' }, h('p', null, '加载中…')))
      }

      const progress = team ? fill(t('panel.progressOf'), { done: team.progress.done, total: team.progress.total }) : ''

      const setAuto = async value => {
        setBusy('auto')
        try { await actions.act({ action: 'setAuto', teamId: team.id, auto: value }) } finally { setBusy('') }
      }

      const onDelete = async () => {
        if (!confirmDelete) { setConfirmDelete(true); return }
        setBusy('delete')
        try {
          await actions.act({ action: 'delete', teamId: team.id })
          setConfirmDelete(false)
          setTeamId(null)
        } finally { setBusy('') }
      }

      return h('div', { className: 'ct-root', 'data-dsh-competition-team': '' },
        h('style', null, CSS),
        h('div', { className: 'ct-head' },
          h(PanelGlyph, { size: 20 }),
          h('div', { className: 'ct-head-main' },
            h('div', { className: 'ct-title' },
              team ? team.title : t('panel.title'),
              draft ? h('span', { className: 'ct-verdict revise' }, t('editor.draft')) : null,
              team && !draft && team.verdict === 'revise' ? h('span', { className: 'ct-verdict revise' }, t('panel.verdictRevise')) : null,
              team && team.verdict === 'pass' ? h('span', { className: 'ct-verdict pass' }, t('panel.verdictPass')) : null,
            ),
            h('div', { className: 'ct-sub' },
              team ? `${progress} · ${statusLabel}` : t('panel.subtitle'),
            ),
          ),
          h('div', { className: 'ct-head-actions' },
            teams.length > 1 ? h('select', {
              className: 'ct-select',
              value: team ? team.id : '',
              onChange: event => setTeamId(event.target.value),
            }, teams.map(item => h('option', { key: item.id, value: item.id }, `${item.title}（${item.progress.done}/${item.progress.total}）`))) : null,
            team && !draft ? h('label', { className: 'ct-toggle', onClick: () => { if (!busy) setAuto(!team.auto) } },
              h('span', { className: `ct-switch${team.auto ? ' on' : ''}` }, h('i')),
              team.auto ? t('panel.auto') : t('panel.manual'),
            ) : null,
            team && !draft && team.status === 'idle' && team.progress.done === 0
              ? h('button', {
                className: 'ct-btn primary',
                onClick: () => actions.act({ action: 'confirm', teamId: team.id }),
              }, t('panel.resume'))
              : null,
            team && !draft && team.verdict === 'revise' ? h('button', {
              className: 'ct-btn',
              onClick: () => actions.act({ action: 'revise', teamId: team.id }),
            }, t('panel.retry')) : null,
            h('button', { className: 'ct-btn', onClick: () => actions.refresh() }, t('panel.refresh')),
            h('button', { className: 'ct-btn primary', onClick: () => setCreating(value => !value) }, t('panel.create')),
            team ? h('button', { className: 'ct-btn danger small', onClick: onDelete },
              confirmDelete ? t('panel.deleteConfirm') : t('panel.delete')) : null,
          ),
        ),
        creating ? h(CreateForm, {
          t, actions, defaultCwd: snapshot.defaultCwd, onClose: () => setCreating(false),
        }) : null,
        team && !draft ? h(CaptainChannel, { key: 'captain:' + team.id, team, t, actions, onPreview: setPreview }) : null,
        snapshot.error ? h('div', { className: 'ct-form' }, h('span', { className: 'ct-note' }, snapshot.error)) : null,
        team && draft
          ? h(WorkflowEditor, { key: team.id, team, t, actions })
          : team
            ? h('div', { className: 'ct-body' },
            h('div', { className: 'ct-tree' },
              team.members.map(memberItem => h(MemberRow, {
                key: memberItem.role,
                member: memberItem,
                team,
                selected: role === memberItem.role,
                onSelect: setRole,
                t,
              })),
            ),
            h('div', { className: 'ct-detail' },
              h(DetailPane, { key: `${team.id}:${role}`, team, member, t, actions, onPreview: setPreview }),
            ),
          )
          : h('div', { className: 'ct-empty' },
            h('p', null, t('panel.empty')),
            h('button', { className: 'ct-btn primary', onClick: () => setCreating(true) }, t('panel.create')),
          ),
        team && team.log && team.log.length > 0 ? h('div', { className: 'ct-log' },
          team.log.map((line, index) => h('div', {
            key: index,
            className: `ct-log-line${/失败|出错|中断|异常/.test(line.text) ? ' error' : ''}`,
          }, `${new Date(line.t).toLocaleTimeString()} · ${line.text}`)),
        ) : null,
        h(PreviewOverlay, { preview, onClose: () => setPreview(null), t }),
      )
    }

    function TeamFooter({ wide, t, storeApi, actions }) {
      const snapshot = useSyncExternalStore(storeApi.subscribe, storeApi.get)
      const teams = snapshot.teams || []
      const team = teams.find(item => item.status === 'running') || teams[0] || null
      const running = team ? team.members.find(member => member.status === 'running') : null
      const done = team ? team.progress.done : 0
      const total = team ? team.progress.total : 5
      const pending = team ? (team.proposals || []).filter(item => item.status === 'pending').length : 0
      const budget = team ? team.budget : null
      const unread = team ? Number(team.unread) || 0 : 0
      const draft = Boolean(team && team.confirmed === false)
      const tone = !team ? 'idle'
        : draft ? 'warn'
          : team.status === 'running' ? 'running'
            : team.status === 'done' ? 'done'
              : team.status === 'failed' || team.status === 'needsRevision' || team.status === 'blocked' || team.status === 'stalled' ? 'warn'
                : 'idle'
      const meta = !team ? t('footer.none')
        : draft ? t('footer.draft')
          : running ? fill(t('footer.running'), { name: running.name })
            : team.status === 'done' ? t('footer.done')
              : team.status === 'needsRevision' ? t('footer.revise')
                : team.status === 'blocked' ? t('footer.blocked')
                  : team.status === 'stalled' ? t('footer.stalled')
                    : team.status === 'failed' ? t('footer.failed') : t('footer.idle')
      const barTone = tone === 'done' ? 'done' : tone === 'warn' ? 'warn' : ''

      if (!wide) {
        return h('div', {
          className: 'ct-foot-rail',
          title: `${t('footer.label')} · ${meta}${pending > 0 ? ' · ' + fill(t('proposal.pending'), { n: pending }) : ''}`,
          role: 'button',
          tabIndex: 0,
          onClick: () => actions.selectPanel(),
          onKeyDown: event => { if (event.key === 'Enter') actions.selectPanel() },
        },
          h(PanelGlyph, { size: 18 }),
          h('i', { className: `ct-foot-badge ${tone}` }),
          h('style', null, CSS),
        )
      }
      return h('div', {
        className: 'ct-foot-row',
        title: t('footer.label'),
        role: 'button',
        tabIndex: 0,
        onClick: () => actions.selectPanel(),
        onKeyDown: event => { if (event.key === 'Enter') actions.selectPanel() },
        'data-dsh-competition-footer': '',
      },
        h('style', null, CSS),
        h('i', { className: `ct-dot ${tone === 'running' ? 'running' : tone === 'done' ? 'done' : ''}`, style: { flex: 'none' } }),
        h('span', { className: 'ct-foot-label' }, t('footer.label')),
        pending > 0 ? h('span', { className: 'ct-foot-pending' }, fill(t('proposal.pending'), { n: pending })) : null,
        unread > 0 ? h('span', { className: 'ct-foot-pending' }, t('notify.inbox') + ' ' + unread) : null,
        budget && budget.state !== 'ok'
          ? h('span', { className: 'ct-foot-pending' }, budget.state === 'exhausted'
            ? t('budget.exhausted')
            : fill(t('budget.percent'), { n: budget.percent }))
          : null,
        h('span', { className: 'ct-foot-meta' }, meta),
        h('span', { className: 'ct-mini' }, h('i', { className: barTone, style: { width: `${total ? Math.round((done / total) * 100) : 0}%` } })),
      )
    }

    // ---------------------------------------------------------------- apply --
    function apply(ctx) {
      const locale = ctx.locale
      const t = locale.bind(NS)
      const disposers = []
      const actions = {
        refresh,
        act,
        selectPanel() {
          try { ctx.layout.selectPanel(PANEL) } catch (error) { console.warn('competition-team: selectPanel failed', error) }
        },
        openSession(sessionId) {
          try { ctx.uiWorkspace.openSession(sessionId) } catch (error) { console.warn('competition-team: openSession failed', error) }
        },
      }

      ctx.effect(() => locale.register(NS, { zh: ZH, en: EN }), 'competition-team:locale')
      ctx.effect(() => {
        const tick = () => { refresh() }
        const timer = setInterval(tick, POLL_MS)
        const onVisible = () => { if (!document.hidden) refresh() }
        document.addEventListener('visibilitychange', onVisible)
        refresh()
        return () => {
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, 'competition-team:poll')

      ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL,
        order: 30,
        label: () => t('entry.label'),
      }, function PanelEntry(props) {
        return h(PanelGlyph, { size: props.size || 18 })
      }))

      ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL,
        locale: NS,
        inject: () => ({ storeApi: store, actions }),
      }, TeamPage))

      ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
        name: 'sidebar.footer.action',
        id: `${PANEL}-progress`,
        order: 40,
        locale: NS,
        inject: () => ({ storeApi: store, actions }),
      }, TeamFooter))

      return () => {
        for (const dispose of disposers.splice(0)) {
          try { dispose() } catch { /* already released */ }
        }
      }
    }

    return { inject: ['slots', 'layout', 'uiWorkspace', 'locale'], apply }
  },
})