/**
 * dsh-cloud-sync — Host half.
 *
 * Mirrors conversations and selected workspace directories into one local
 * folder that a cloud drive (OneDrive, Nutstore, Nextcloud, ...) already keeps
 * in sync across computers. The plugin never talks to the network itself:
 * the cloud client is the transport, which keeps credentials out of the
 * plugin entirely.
 */
import { randomUUID } from 'node:crypto'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DEFAULT_IGNORE, syncProjectFiles } from './engine.js'
import {
  compareEventLogs,
  eventHash,
  parseConversation,
  serializeConversation,
} from './sessions.js'

export const name = 'dsh-cloud-sync'
export const inject = ['sessionPersistence', 'sessionQuery', 'webServer']

const API_PREFIX = '/dsh-cloud-sync/api'
const MAX_BODY_BYTES = 2 * 1024 * 1024
const MAX_ERRORS = 50
const VERSION = '1.0.0'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 */
export function apply(ctx) {
  const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const dataDir = path.join(home, 'dsh-cloud-sync')
  const settingsPath = path.join(dataDir, 'settings.json')
  const statePath = path.join(dataDir, 'state.json')

  /** @type {any} */
  let settings
  /** @type {any} */
  let state
  /** @type {Promise<void>|null} */
  let loading = null
  /** @type {NodeJS.Timeout|null} */
  let timer = null
  /** @type {NodeJS.Timeout|null} */
  let startupTimer = null
  const runState = { running: false, promise: null, lastRun: null }

  ctx.effect(() => () => {
    if (timer !== null) clearInterval(timer)
    if (startupTimer !== null) clearTimeout(startupTimer)
    timer = null
    startupTimer = null
  }, 'dsh-cloud-sync.timer')

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: (request, response) => {
        void handleRequest(request, response).catch((error) => {
          ctx.logger.warn(`[dsh-cloud-sync] request failed: ${messageOf(error)}`)
          sendJson(response, 500, { ok: false, error: messageOf(error) })
        })
      },
    })
    return () => dispose()
  }, 'dsh-cloud-sync.http')

  void ensureLoaded().catch((error) => {
    ctx.logger.error(`[dsh-cloud-sync] initialization failed: ${messageOf(error)}`)
  })

  // ---------------------------------------------------------------------
  // settings and state
  // ---------------------------------------------------------------------

  async function ensureLoaded() {
    if (loading === null) {
      loading = loadAll().catch((error) => {
        loading = null
        throw error
      })
    }
    return loading
  }

  async function loadAll() {
    await fsp.mkdir(dataDir, { recursive: true })
    const storedSettings = await readJson(settingsPath)
    if (storedSettings === undefined) {
      settings = defaultSettings()
      await writeJson(settingsPath, settings)
    } else {
      settings = normalizeStoredSettings(storedSettings)
    }
    const storedState = await readJson(statePath)
    state = normalizeState(storedState, settings.syncRoot)
    runState.lastRun = state.lastRun ?? null
    armTimer()
    armStartupSync()
  }

  function armStartupSync() {
    if (startupTimer !== null) clearTimeout(startupTimer)
    startupTimer = null
    if (!settings.syncRoot) return
    startupTimer = setTimeout(() => {
      startupTimer = null
      void runSync('startup').catch((error) => {
        ctx.logger.warn(`[dsh-cloud-sync] startup sync failed: ${messageOf(error)}`)
      })
    }, 15_000)
    startupTimer.unref?.()
  }

  function defaultSettings() {
    return {
      version: 1,
      deviceId: randomUUID(),
      deviceName: os.hostname() || 'device',
      syncRoot: '',
      autoSync: true,
      intervalMinutes: 10,
      maxFileMB: 50,
      ignore: [],
      projects: projectsFromRegistry(),
    }
  }

  function projectsFromRegistry() {
    const projects = []
    const used = new Set()
    let workspaces = []
    try {
      workspaces = listWorkspaces()
    } catch {
      workspaces = []
    }
    for (const workspace of workspaces) {
      const base = slug(workspace.title || path.basename(workspace.path))
      let id = base
      let suffix = 2
      while (used.has(id)) {
        id = `${base}-${suffix}`
        suffix += 1
      }
      used.add(id)
      projects.push({ id, path: workspace.path, title: workspace.title })
    }
    return projects
  }

  function normalizeStoredSettings(value) {
    const fallback = defaultSettings()
    if (value === null || typeof value !== 'object') return fallback
    return {
      version: 1,
      deviceId: typeof value.deviceId === 'string' && value.deviceId !== '' ? value.deviceId : fallback.deviceId,
      deviceName: typeof value.deviceName === 'string' ? value.deviceName : fallback.deviceName,
      syncRoot: typeof value.syncRoot === 'string' ? value.syncRoot : '',
      autoSync: value.autoSync !== false,
      intervalMinutes: Number.isFinite(value.intervalMinutes) ? value.intervalMinutes : fallback.intervalMinutes,
      maxFileMB: Number.isFinite(value.maxFileMB) ? value.maxFileMB : fallback.maxFileMB,
      ignore: Array.isArray(value.ignore) ? value.ignore.filter((entry) => typeof entry === 'string') : [],
      projects: Array.isArray(value.projects)
        ? value.projects
            .filter((entry) => entry !== null && typeof entry === 'object')
            .map((entry) => ({
              id: typeof entry.id === 'string' ? entry.id : '',
              path: typeof entry.path === 'string' ? entry.path : '',
              title: typeof entry.title === 'string' ? entry.title : '',
            }))
        : fallback.projects,
    }
  }

  function normalizeState(value, syncRoot) {
    if (
      value === null ||
      typeof value !== 'object' ||
      value.version !== 1 ||
      value.syncRoot !== syncRoot ||
      value.sessions === null ||
      typeof value.sessions !== 'object' ||
      value.files === null ||
      typeof value.files !== 'object'
    ) {
      return { version: 1, syncRoot, sessions: {}, files: {}, lastRun: value?.lastRun ?? null }
    }
    return {
      version: 1,
      syncRoot,
      sessions: value.sessions,
      files: value.files,
      lastRun: value.lastRun ?? null,
    }
  }

  async function validateAndSaveSettings(input) {
    if (input === null || typeof input !== 'object') throw new Error('设置格式不正确')
    const previous = settings

    const syncRootRaw = String(input.syncRoot ?? '').trim()
    if (syncRootRaw === '') throw new Error('请先选择云盘同步文件夹')
    if (!path.isAbsolute(syncRootRaw)) throw new Error('同步文件夹必须是绝对路径')
    let syncRoot
    try {
      syncRoot = await fsp.realpath(syncRootRaw)
    } catch {
      throw new Error(`同步文件夹不存在：${syncRootRaw}`)
    }
    if (!(await fsp.stat(syncRoot)).isDirectory()) throw new Error('同步文件夹不是目录')

    const deviceName = String(input.deviceName ?? '').trim().replace(/[\u0000-\u001f]+/g, '')
    if (deviceName === '') throw new Error('设备名称不能为空')
    if (deviceName.length > 64) throw new Error('设备名称不能超过 64 个字符')

    const intervalMinutes = Number(input.intervalMinutes)
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < 0 || intervalMinutes > 1440) {
      throw new Error('自动同步间隔必须在 0 到 1440 分钟之间')
    }

    const maxFileMB = Number(input.maxFileMB)
    if (!Number.isFinite(maxFileMB) || maxFileMB < 1 || maxFileMB > 2048) {
      throw new Error('单文件大小上限必须在 1 到 2048 MB 之间')
    }

    const ignore = Array.isArray(input.ignore)
      ? input.ignore
          .filter((entry) => typeof entry === 'string')
          .map((entry) => entry.trim())
          .filter((entry) => entry !== '')
          .slice(0, 64)
      : []

    const rawProjects = Array.isArray(input.projects) ? input.projects.slice(0, 64) : []
    const projects = []
    const ids = new Set()
    const paths = []
    for (const entry of rawProjects) {
      if (entry === null || typeof entry !== 'object') continue
      const id = String(entry.id ?? '').trim()
      if (!/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id)) throw new Error(`工作区 ID 不合法：${id || '(空)'}`)
      if (ids.has(id.toLowerCase())) throw new Error(`工作区 ID 重复：${id}`)
      ids.add(id.toLowerCase())
      const rawPath = String(entry.path ?? '').trim()
      if (rawPath === '') throw new Error(`工作区 ${id} 没有填写路径`)
      if (!path.isAbsolute(rawPath)) throw new Error(`工作区 ${id} 的路径必须是绝对路径`)
      let real
      try {
        real = await fsp.realpath(rawPath)
      } catch {
        throw new Error(`工作区 ${id} 的路径不存在：${rawPath}`)
      }
      if (!(await fsp.stat(real)).isDirectory()) throw new Error(`工作区 ${id} 的路径不是目录`)
      projects.push({ id, path: real, title: String(entry.title ?? '').trim() || path.basename(real) })
      paths.push(real)
    }

    for (let index = 0; index < paths.length; index += 1) {
      for (let other = index + 1; other < paths.length; other += 1) {
        if (isInside(paths[index], paths[other]) || isInside(paths[other], paths[index])) {
          throw new Error(`两个工作区目录不能互相包含：${paths[index]} / ${paths[other]}`)
        }
      }
      if (isInside(paths[index], syncRoot) || isInside(syncRoot, paths[index])) {
        throw new Error(`同步文件夹不能位于工作区目录内（或反过来）：${paths[index]}`)
      }
    }

    const next = {
      version: 1,
      deviceId: previous?.deviceId ?? randomUUID(),
      deviceName,
      syncRoot,
      autoSync: input.autoSync !== false,
      intervalMinutes: Math.round(intervalMinutes),
      maxFileMB: Math.round(maxFileMB * 10) / 10,
      ignore,
      projects,
    }
    const rootChanged = previous?.syncRoot !== next.syncRoot
    settings = next
    await writeJson(settingsPath, settings)
    if (rootChanged) {
      state = { version: 1, syncRoot: next.syncRoot, sessions: {}, files: {}, lastRun: null }
      await writeJson(statePath, state)
    }
    armTimer()
    return settings
  }

  function armTimer() {
    if (timer !== null) clearInterval(timer)
    timer = null
    if (!settings?.autoSync || !settings.syncRoot || settings.intervalMinutes <= 0) return
    timer = setInterval(() => {
      void runSync('auto').catch((error) => {
        ctx.logger.warn(`[dsh-cloud-sync] scheduled sync failed: ${messageOf(error)}`)
      })
    }, settings.intervalMinutes * 60_000)
    timer.unref?.()
  }

  // ---------------------------------------------------------------------
  // status and manual runs
  // ---------------------------------------------------------------------

  function publicSettings() {
    return {
      deviceId: settings.deviceId,
      deviceName: settings.deviceName,
      syncRoot: settings.syncRoot,
      autoSync: settings.autoSync,
      intervalMinutes: settings.intervalMinutes,
      maxFileMB: settings.maxFileMB,
      ignore: settings.ignore,
      projects: settings.projects,
    }
  }

  async function buildStatus() {
    if (settings.projects.length === 0 && settings.syncRoot === '') {
      const seeded = projectsFromRegistry()
      if (seeded.length > 0) {
        settings.projects = seeded
        await writeJson(settingsPath, settings).catch(() => {})
      }
    }
    const projects = []
    for (const project of settings.projects) {
      let exists = false
      try {
        exists = (await fsp.stat(project.path)).isDirectory()
      } catch {
        exists = false
      }
      const workspace = workspaceForProject(project)
      projects.push({
        ...project,
        exists,
        workspaceId: workspace?.id ?? null,
        workspaceTitle: workspace?.title ?? null,
      })
    }
    return {
      version: VERSION,
      configured: Boolean(settings.syncRoot),
      settings: publicSettings(),
      projects,
      running: runState.running,
      lastRun: runState.lastRun,
      dataDir,
      pickerAvailable: typeof ctx.get('directoryPickerController')?.pick === 'function',
    }
  }

  /**
   * Run one sync, sharing the in-flight promise with concurrent callers.
   * @param {'manual'|'auto'|'api'} trigger - what asked for this run.
   * @returns {Promise<any>} run summary.
   */
  async function runSync(trigger) {
    await ensureLoaded()
    if (runState.running) return runState.promise
    if (!settings.syncRoot) throw new Error('尚未配置云盘同步文件夹')
    runState.running = true
    runState.promise = executeSync(trigger).finally(() => {
      runState.running = false
      runState.promise = null
    })
    return runState.promise
  }

  async function executeSync(trigger) {
    const startedAt = new Date().toISOString()
    const summary = {
      trigger,
      startedAt,
      finishedAt: null,
      ok: false,
      exported: 0,
      imported: 0,
      appended: 0,
      conflicts: 0,
      uploaded: 0,
      downloaded: 0,
      deletedRemote: 0,
      skippedLarge: [],
      errors: [],
    }
    const started = Date.now()
    ctx.logger.info(`[dsh-cloud-sync] sync started (${trigger})`)
    try {
      if (!(await pathIsDirectory(settings.syncRoot))) {
        throw new Error(`同步文件夹不可用：${settings.syncRoot}`)
      }
      await syncConversations(summary)
      await syncProjects(summary)
      summary.ok = summary.errors.length === 0
    } catch (error) {
      summary.ok = false
      pushError(summary, messageOf(error))
      ctx.logger.warn(`[dsh-cloud-sync] sync failed: ${messageOf(error)}`)
    } finally {
      summary.finishedAt = new Date().toISOString()
      summary.durationMs = Date.now() - started
      runState.lastRun = summary
      state.lastRun = summary
      await writeJson(statePath, state).catch((error) => {
        ctx.logger.warn(`[dsh-cloud-sync] could not persist sync state: ${messageOf(error)}`)
      })
      ctx.logger.info(
        `[dsh-cloud-sync] sync finished in ${summary.durationMs} ms: exported=${summary.exported} imported=${summary.imported} ` +
          `uploaded=${summary.uploaded} downloaded=${summary.downloaded} conflicts=${summary.conflicts} errors=${summary.errors.length}`,
      )
    }
    return summary
  }

  // ---------------------------------------------------------------------
  // conversations
  // ---------------------------------------------------------------------

  async function syncConversations(summary) {
    const directory = path.join(settings.syncRoot, 'conversations')
    await fsp.mkdir(directory, { recursive: true })
    const remote = await listRemoteConversations(directory)
    const records = (await ctx.sessionQuery.listSessions()).filter(
      (record) => record.header.parentSession === undefined && record.header.origin !== 'subagent',
    )
    const localIds = new Set(records.map((record) => String(record.header.id)))

    for (const record of records) {
      const id = String(record.header.id)
      try {
        await syncOneConversation(record, remote.get(id), summary)
      } catch (error) {
        pushError(summary, `会话 ${id}: ${messageOf(error)}`)
      }
    }

    for (const [id, file] of remote) {
      if (localIds.has(id)) continue
      try {
        const parsed = parseConversation(await fsp.readFile(file.abs, 'utf8'))
        if (parsed.header.parentSession !== undefined || parsed.header.origin === 'subagent') continue
        const importedId = await importConversation(parsed, { projectId: parsed.projectId, copy: false })
        if (importedId !== null) {
          summary.imported += 1
          localIds.add(id)
          ctx.logger.info(`[dsh-cloud-sync] imported conversation ${id}`)
        }
      } catch (error) {
        pushError(summary, `导入会话 ${id}: ${messageOf(error)}`)
      }
    }
  }

  async function syncOneConversation(record, remoteFile, summary) {
    const id = String(record.header.id)
    const persistenceStat = await ctx.sessionPersistence.stat(id).catch(() => undefined)
    const revision = persistenceStat?.revision === undefined ? `count:${persistenceStat?.eventCount ?? 'unknown'}` : String(persistenceStat.revision)
    const previous = state.sessions[id]
    const remoteUnchanged =
      remoteFile !== undefined &&
      previous !== undefined &&
      previous.remoteSize === remoteFile.size &&
      previous.remoteMtimeMs === remoteFile.mtimeMs &&
      typeof previous.remoteHash === 'string'

    if (previous !== undefined && previous.localRevision === revision && remoteUnchanged) {
      return
    }

    const localSnapshot = await ctx.sessionQuery.readSession(id)
    const localEvents = localSnapshot.events
    const localHash = eventHash(localEvents)
    const projectId = projectIdFor(localSnapshot.session.cwd)

    if (previous !== undefined && previous.localHash === localHash && remoteUnchanged) {
      return
    }

    let parsed
    if (remoteFile !== undefined) {
      try {
        parsed = parseConversation(await fsp.readFile(remoteFile.abs, 'utf8'))
      } catch (error) {
        pushError(summary, `读取远端会话 ${id}: ${messageOf(error)}`)
        return
      }
    }

    if (parsed === undefined) {
      await exportConversation(localSnapshot, projectId, summary)
      return
    }

    const comparison = compareEventLogs(localEvents, parsed.events)
    if (comparison.relation === 'equal') {
      await rememberConversation(id, localEvents, remoteFile)
      return
    }
    if (comparison.relation === 'local-ahead') {
      await exportConversation(localSnapshot, projectId, summary)
      return
    }
    if (comparison.relation === 'remote-ahead') {
      if (ctx.get('sessions')?.get(id) !== undefined) {
        pushError(summary, `会话 ${id} 正在本机运行，远端的新消息将在下次同步处理`)
        return
      }
      const handle = await ctx.sessionPersistence.open(id, 'write')
      try {
        await handle.append(parsed.events.slice(localEvents.length))
        await handle.flush()
      } finally {
        await handle.close()
      }
      summary.appended += 1
      await rememberConversation(id, parsed.events, remoteFile)
      ctx.logger.info(`[dsh-cloud-sync] appended ${parsed.events.length - localEvents.length} remote events to ${id}`)
      return
    }

    // Both sides advanced independently: preserve the remote branch as a
    // separate local conversation before exporting this device's branch.
    const copyId = await importConversation(parsed, {
      projectId: parsed.projectId ?? projectId,
      copy: true,
    })
    if (copyId !== null) {
      summary.conflicts += 1
      summary.imported += 1
      ctx.logger.info(`[dsh-cloud-sync] divergent conversation ${id} preserved as ${copyId}`)
    }
    await exportConversation(localSnapshot, projectId, summary)
  }

  async function exportConversation(snapshot, projectId, summary) {
    const id = String(snapshot.session.id)
    const text = serializeConversation({
      header: snapshot.session,
      inheritedEventCount: snapshot.inheritedEventCount,
      events: snapshot.events,
      projectId,
      device: settings.deviceName,
    })
    const directory = path.join(settings.syncRoot, 'conversations')
    const absolute = path.join(directory, `${id}.json`)
    await writeTextAtomic(absolute, text)
    const stat = await fsp.stat(absolute)
    const persistenceStat = await ctx.sessionPersistence.stat(id).catch(() => undefined)
    const hash = eventHash(snapshot.events)
    state.sessions[id] = {
      localRevision: String(persistenceStat?.revision ?? `count:${snapshot.events.length}`),
      localEventCount: snapshot.events.length,
      localHash: hash,
      remoteSize: stat.size,
      remoteMtimeMs: stat.mtimeMs,
      remoteHash: hash,
      remoteEventCount: snapshot.events.length,
      exportedAt: new Date().toISOString(),
    }
    summary.exported += 1
    ctx.logger.info(`[dsh-cloud-sync] exported conversation ${id} (${snapshot.events.length} events)`)
  }

  async function rememberConversation(id, events, remoteFile) {
    const persistenceStat = await ctx.sessionPersistence.stat(id).catch(() => undefined)
    const hash = eventHash(events)
    state.sessions[id] = {
      localRevision: String(persistenceStat?.revision ?? `count:${events.length}`),
      localEventCount: events.length,
      localHash: hash,
      remoteSize: remoteFile?.size ?? null,
      remoteMtimeMs: remoteFile?.mtimeMs ?? null,
      remoteHash: hash,
      remoteEventCount: events.length,
      exportedAt: new Date().toISOString(),
    }
  }

  async function importConversation(parsed, options) {
    const projectId = options.projectId ?? null
    const header = localizedHeader(parsed.header, projectId)
    if (!/^[A-Za-z0-9._-]{1,200}$/.test(String(header.id))) {
      throw new Error(`会话 ID 不合法：${String(header.id)}`)
    }
    if (options.copy === true) {
      header.id = `session-${randomUUID()}`
      header.createdAt = Date.now()
    }
    if (ctx.get('sessions')?.get(header.id) !== undefined) return null
    const existing = await ctx.sessionPersistence.stat(header.id).catch(() => undefined)
    if (existing !== undefined) return null

    const handle = await ctx.sessionPersistence.create(header, {
      inheritedEventCount: parsed.inheritedEventCount,
    })
    try {
      if (parsed.events.length > 0) await handle.append(parsed.events)
      await handle.flush()
    } finally {
      await handle.close()
    }
    await attachToWorkspace(String(header.id), projectId)
    return String(header.id)
  }

  async function attachToWorkspace(sessionId, projectId) {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined || projectId === null) return
    const project = projectById(projectId)
    if (project === undefined) return
    let workspace = workspaceForProject(project)
    if (workspace === undefined) {
      workspace = await registry.resolveByPath(project.path).catch(() => undefined)
    }
    if (workspace === undefined) return
    if (typeof workspace.attachSession !== 'function') return
    try {
      await workspace.attachSession(sessionId)
    } catch (error) {
      ctx.logger.warn(`[dsh-cloud-sync] could not attach ${sessionId} to ${project.id}: ${messageOf(error)}`)
    }
  }

  function localizedHeader(header, projectId) {
    const project = projectById(projectId)
    if (project === undefined) return { ...header }
    const workspace = workspaceForProject(project)
    return { ...header, cwd: workspace?.path ?? project.path }
  }

  async function listRemoteConversations(directory) {
    const map = new Map()
    let names
    try {
      names = await fsp.readdir(directory)
    } catch (error) {
      if (error && error.code === 'ENOENT') return map
      throw error
    }
    for (const name of names) {
      if (!name.endsWith('.json') || name.startsWith('.')) continue
      const absolute = path.join(directory, name)
      const stat = await fsp.stat(absolute).catch(() => undefined)
      if (stat === undefined || !stat.isFile()) continue
      map.set(name.slice(0, -5), { abs: absolute, size: stat.size, mtimeMs: stat.mtimeMs })
    }
    return map
  }

  // ---------------------------------------------------------------------
  // workspace files
  // ---------------------------------------------------------------------

  async function syncProjects(summary) {
    const maxBytes = Math.round(settings.maxFileMB * 1024 * 1024)
    for (const project of settings.projects) {
      if (!(await pathIsDirectory(project.path))) {
        pushError(summary, `工作区 ${project.id} 的目录不存在：${project.path}`)
        continue
      }
      const remoteRoot = path.join(settings.syncRoot, 'files', project.id)
      await fsp.mkdir(remoteRoot, { recursive: true })
      const base = state.files[project.id] ?? {}
      const result = await syncProjectFiles({
        localRoot: project.path,
        remoteRoot,
        base,
        deviceName: settings.deviceName,
        ignore: [...DEFAULT_IGNORE, ...settings.ignore],
        maxBytes,
        log: (line) => ctx.logger.info(`[dsh-cloud-sync] ${project.id}: ${line}`),
      })
      state.files[project.id] = result.nextBase
      summary.uploaded += result.uploaded
      summary.downloaded += result.downloaded
      summary.conflicts += result.conflicts
      summary.deletedRemote += result.deletedRemote
      for (const skipped of result.skippedLarge.slice(0, 10)) {
        summary.skippedLarge.push(`${project.id}/${skipped}`)
      }
      for (const error of result.errors) pushError(summary, `${project.id}: ${error}`)
    }
  }

  // ---------------------------------------------------------------------
  // HTTP API
  // ---------------------------------------------------------------------

  async function handleRequest(request, response) {
    const url = new URL(request.url ?? '/', 'http://dsh-cloud-sync.local')
    if (!url.pathname.startsWith(`${API_PREFIX}/`)) {
      sendJson(response, 404, { ok: false, error: 'not found' })
      return
    }
    if (!originAllowed(request)) {
      sendJson(response, 403, { ok: false, error: 'forbidden' })
      return
    }

    if (request.method === 'GET' && url.pathname === `${API_PREFIX}/status`) {
      await ensureLoaded()
      sendJson(response, 200, { ok: true, status: await buildStatus() })
      return
    }

    if (request.method === 'POST' && url.pathname === `${API_PREFIX}/action`) {
      await ensureLoaded()
      let payload
      try {
        payload = await readJsonBody(request)
      } catch (error) {
        sendJson(response, 400, { ok: false, error: messageOf(error) })
        return
      }
      const action = typeof payload?.action === 'string' ? payload.action : ''
      try {
        if (action === 'save') {
          await validateAndSaveSettings(payload.settings)
          sendJson(response, 200, { ok: true, status: await buildStatus() })
          return
        }
        if (action === 'pick') {
          const controller = ctx.get('directoryPickerController')
          if (controller === undefined || typeof controller.pick !== 'function') {
            sendJson(response, 200, { ok: false, error: '当前环境没有系统文件夹选择器，请直接把完整路径粘贴到输入框' })
            return
          }
          const picked = await controller.pick(new AbortController().signal)
          sendJson(response, 200, { ok: true, path: typeof picked === 'string' ? picked : null })
          return
        }
        if (action === 'sync') {
          const summary = await runSync('manual')
          sendJson(response, 200, { ok: true, summary, status: await buildStatus() })
          return
        }
        sendJson(response, 400, { ok: false, error: `unknown action: ${action}` })
      } catch (error) {
        sendJson(response, 400, { ok: false, error: messageOf(error) })
      }
      return
    }

    sendJson(response, 404, { ok: false, error: 'not found' })
  }

  function originAllowed(request) {
    const origin = request.headers.origin
    if (typeof origin === 'string' && origin !== '') {
      try {
        return new URL(origin).host === request.headers.host
      } catch {
        return false
      }
    }
    const address = request.socket.remoteAddress ?? ''
    return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------

  function listWorkspaces() {
    const registry = ctx.get('workspaceRegistry')
    if (registry === undefined) return []
    try {
      return registry.list()
    } catch {
      return []
    }
  }

  function workspaceForProject(project) {
    const target = normalizePath(project.path)
    for (const workspace of listWorkspaces()) {
      if (normalizePath(workspace.path) === target) return workspace
    }
    return undefined
  }

  function projectById(id) {
    if (typeof id !== 'string' || id === '') return undefined
    return settings.projects.find((project) => project.id === id)
  }

  function projectIdFor(cwd) {
    if (typeof cwd !== 'string' || cwd === '') return null
    const target = normalizePath(cwd)
    let best = null
    for (const project of settings.projects) {
      const root = normalizePath(project.path)
      if (target === root || target.startsWith(`${root}${path.sep}`)) {
        if (best === null || project.path.length > best.path.length) best = project
      }
    }
    return best?.id ?? null
  }

  function pushError(summary, message) {
    if (summary.errors.length < MAX_ERRORS) summary.errors.push(message)
  }
}

// -----------------------------------------------------------------------
// module-local helpers
// -----------------------------------------------------------------------

function slug(value) {
  const slugged = String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return slugged === '' ? 'project' : slugged
}

function normalizePath(value) {
  const resolved = path.resolve(value)
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}

function isInside(candidate, parent) {
  const child = normalizePath(candidate)
  const root = normalizePath(parent)
  if (child === root) return true
  return child.startsWith(root.endsWith(path.sep) ? root : `${root}${path.sep}`)
}

async function pathIsDirectory(target) {
  try {
    return (await fsp.stat(target)).isDirectory()
  } catch {
    return false
  }
}

async function readJson(target) {
  try {
    const text = (await fsp.readFile(target, 'utf8')).replace(/^\uFEFF/, '')
    return JSON.parse(text)
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined
    throw error
  }
}

async function writeJson(target, value) {
  await writeTextAtomic(target, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeTextAtomic(target, text) {
  await fsp.mkdir(path.dirname(target), { recursive: true })
  const temporary = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  try {
    await fsp.writeFile(temporary, text, 'utf8')
    await fsp.rename(temporary, target)
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(new Error(`invalid JSON body: ${messageOf(error)}`))
      }
    })
    request.on('error', reject)
  })
}

function sendJson(response, status, body) {
  if (response.writableEnded) return
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  response.end(text)
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}
