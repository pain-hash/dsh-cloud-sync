/**
 * Filesystem mirror engine for the dsh-sync plugin.
 *
 * The engine is deliberately dependency-free (Node builtins only) so the
 * bundle installs without a package manager step. It treats a local project
 * directory and its mirror inside a cloud-synced folder as two replicas and
 * resolves every changed path with a three-way rule based on the last synced
 * content hash.
 */
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream, promises as fsp } from 'node:fs'
import path from 'node:path'

/** Directory and file names that are never mirrored. */
export const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.output',
  '.cache',
  '__pycache__',
  '.venv',
  'venv',
  '.dsh-sync',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]

const BARE_IGNORE = new Set(DEFAULT_IGNORE.map((name) => name.toLowerCase()))

/**
 * Normalize a relative path to forward slashes for matching and state keys.
 * @param {string} value - path relative to a project root.
 * @returns {string} normalized relative path.
 */
export function normalizeRel(value) {
  return value.split(path.sep).join('/').replace(/^\/+/, '')
}

/**
 * Convert a small glob (`*`, `**`, `?`) into an anchored regular expression.
 * @param {string} pattern - user supplied glob.
 * @returns {RegExp} matcher for a forward-slash relative path.
 */
export function globToRegExp(pattern) {
  let source = pattern.replace(/\\/g, '/').replace(/^\.\//, '')
  let out = '^'
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '*') {
      if (source[index + 1] === '*') {
        index += 1
        if (source[index + 1] === '/') index += 1
        out += '(?:.*/)?'
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (char === '?') {
      out += '[^/]'
      continue
    }
    out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  out += '$'
  return new RegExp(out, process.platform === 'win32' ? 'i' : '')
}

/**
 * Decide whether one relative path is excluded from mirroring.
 * @param {string} rel - normalized relative path.
 * @param {readonly string[]} extra - user globs, matched against the path and each segment.
 * @returns {boolean} true when the path must be skipped.
 */
export function isIgnored(rel, extra = []) {
  const segments = rel.split('/')
  for (const segment of segments) {
    if (BARE_IGNORE.has(segment.toLowerCase())) return true
    if (segment.startsWith('.dsh-sync-') && segment.endsWith('.tmp')) return true
  }
  for (const pattern of extra) {
    if (typeof pattern !== 'string' || pattern.trim() === '') continue
    const glob = pattern.trim()
    if (globToRegExp(glob).test(rel)) return true
    if (!glob.includes('/')) {
      for (const segment of segments) {
        if (globToRegExp(glob).test(segment)) return true
      }
    }
  }
  return false
}

/**
 * Hash one file with SHA-256.
 * @param {string} absolutePath - file to read.
 * @returns {Promise<string>} lowercase hex digest.
 */
export function hashFile(absolutePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(absolutePath)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

/**
 * Walk one tree collecting regular files only.
 * @param {string} root - absolute directory.
 * @param {{ignore?: readonly string[], maxBytes?: number}} options - ignore globs and size cap.
 * @returns {Promise<{files: Map<string, {abs: string, size: number, mtimeMs: number}>, skippedLarge: string[], errors: string[]}>}
 */
export async function walkTree(root, options = {}) {
  const ignore = options.ignore ?? []
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY
  const files = new Map()
  const skippedLarge = []
  const errors = []
  const stack = ['']

  while (stack.length > 0) {
    const relDir = stack.pop()
    const absoluteDir = relDir === '' ? root : path.join(root, relDir)
    let entries
    try {
      entries = await fsp.readdir(absoluteDir, { withFileTypes: true })
    } catch (error) {
      if (relDir === '' && error && error.code === 'ENOENT') return { files, skippedLarge, errors }
      errors.push(`${relDir || '.'}: ${errorMessage(error)}`)
      continue
    }
    for (const entry of entries) {
      const rel = relDir === '' ? entry.name : `${relDir}/${entry.name}`
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        if (isIgnored(rel, ignore)) continue
        stack.push(rel)
        continue
      }
      if (!entry.isFile()) continue
      if (isIgnored(rel, ignore)) continue
      const absolute = path.join(root, rel)
      let stat
      try {
        stat = await fsp.stat(absolute)
      } catch (error) {
        errors.push(`${rel}: ${errorMessage(error)}`)
        continue
      }
      if (!stat.isFile()) continue
      if (stat.size > maxBytes) {
        skippedLarge.push(rel)
        continue
      }
      files.set(rel, { abs: absolute, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  return { files, skippedLarge, errors }
}

/**
 * Reuse a cached digest when size and mtime are unchanged.
 * @param {Map<string, {abs: string, size: number, mtimeMs: number}>} files - side entries.
 * @param {Record<string, any>|undefined} cached - previous state for this path.
 * @param {'l'|'r'} side - which replica the entry belongs to.
 * @param {string} rel - normalized relative path.
 * @returns {Promise<string|undefined>} digest or undefined when the file is absent.
 */
async function digestOf(files, cached, side, rel) {
  const entry = files.get(rel)
  if (entry === undefined) return undefined
  if (
    cached !== undefined &&
    cached.hash !== undefined &&
    cached[`${side}Size`] === entry.size &&
    cached[`${side}Mtime`] === entry.mtimeMs
  ) {
    return cached.hash
  }
  return hashFile(entry.abs)
}

/**
 * Copy a file through a temporary sibling and rename it into place.
 * @param {string} source - file to read.
 * @param {string} destination - final path.
 * @returns {Promise<void>} resolves after the rename.
 */
async function copyAtomic(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true })
  const temporary = path.join(
    path.dirname(destination),
    `.dsh-sync-${process.pid}-${randomBytes(4).toString('hex')}.tmp`,
  )
  try {
    await fsp.copyFile(source, temporary)
    await fsp.rename(temporary, destination)
  } catch (error) {
    await fsp.rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  const stat = await fsp.stat(source)
  await fsp.utimes(destination, stat.atime, stat.mtime).catch(() => {})
}

/**
 * Build an unused conflict-copy name next to the local file.
 * @param {string} localRoot - project root.
 * @param {string} rel - conflicted relative path.
 * @param {string} deviceName - this device label.
 * @returns {Promise<string>} absolute path for the conflict copy.
 */
export async function conflictPath(localRoot, rel, deviceName) {
  const directory = path.dirname(path.join(localRoot, rel))
  const extension = path.extname(rel)
  const stem = path.basename(rel, extension)
  const stamp = timestampLabel(new Date())
  const device = String(deviceName || 'device')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'device'
  let attempt = 1
  for (;;) {
    const suffix = attempt === 1 ? '' : `-${attempt}`
    const candidate = path.join(directory, `${stem}.sync-conflict-${device}-${stamp}${suffix}${extension}`)
    if (!(await exists(candidate))) return candidate
    attempt += 1
  }
}

/**
 * Format a local timestamp as `YYYYMMDD-HHmmss`.
 * @param {Date} date - instant to format.
 * @returns {string} compact local label.
 */
function timestampLabel(date) {
  const pad = (value) => String(value).padStart(2, '0')
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('')
}

/** @returns {Promise<boolean>} whether the path exists. */
async function exists(target) {
  try {
    await fsp.lstat(target)
    return true
  } catch {
    return false
  }
}

/** @returns {string} a readable error message. */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Mirror one project directory into its cloud-folder replica.
 *
 * Both sides are compared against the state recorded by the previous run:
 * one changed side wins, both changed sides produce a conflict copy of the
 * remote version next to the local file, then the local version is uploaded.
 *
 * @param {{
 *   localRoot: string,
 *   remoteRoot: string,
 *   base?: Record<string, any>,
 *   deviceName: string,
 *   ignore?: readonly string[],
 *   maxBytes?: number,
 *   log?: (message: string) => void,
 *   signal?: AbortSignal,
 * }} options - replicas and policy.
 * @returns {Promise<{uploaded: number, downloaded: number, conflicts: number, deletedRemote: number, skippedLarge: string[], errors: string[], nextBase: Record<string, any>}>}
 */
export async function syncProjectFiles(options) {
  const {
    localRoot,
    remoteRoot,
    base = {},
    deviceName,
    ignore = [],
    maxBytes = Number.POSITIVE_INFINITY,
    log = () => {},
    signal,
  } = options

  const summary = {
    uploaded: 0,
    downloaded: 0,
    conflicts: 0,
    deletedRemote: 0,
    skippedLarge: [],
    errors: [],
    nextBase: {},
  }

  const local = await walkTree(localRoot, { ignore, maxBytes })
  const remote = await walkTree(remoteRoot, { ignore, maxBytes })
  summary.skippedLarge.push(...local.skippedLarge)
  summary.errors.push(...local.errors.map((message) => `local ${message}`))
  summary.errors.push(...remote.errors.map((message) => `remote ${message}`))

  const rels = new Set([
    ...local.files.keys(),
    ...remote.files.keys(),
    ...Object.keys(base),
  ])

  for (const rel of [...rels].sort()) {
    if (signal?.aborted === true) throw signal.reason ?? new Error('sync aborted')
    const cached = base[rel]
    try {
      const localEntry = local.files.get(rel)
      const remoteEntry = remote.files.get(rel)
      const localHash = await digestOf(local.files, cached, 'l', rel)
      const remoteHash = await digestOf(remote.files, cached, 'r', rel)

      if (localEntry === undefined && remoteEntry === undefined) {
        continue
      }

      if (localEntry !== undefined && remoteEntry === undefined) {
        await copyAtomic(localEntry.abs, path.join(remoteRoot, rel))
        summary.uploaded += 1
        summary.nextBase[rel] = await pairState(localEntry, localHash, remoteRoot, rel)
        log(`uploaded ${rel} (remote copy was missing)`)
        continue
      }

      if (localEntry === undefined && remoteEntry !== undefined) {
        if (cached === undefined || remoteHash !== cached.hash) {
          await copyAtomic(remoteEntry.abs, path.join(localRoot, rel))
          summary.downloaded += 1
          summary.nextBase[rel] = await pairState(remoteEntry, remoteHash, localRoot, rel)
          log(`downloaded ${rel} (local copy was missing)`)
          continue
        }
        // The local file was deleted after the last sync and the remote copy is
        // unchanged: propagate the deletion.
        await fsp.rm(remoteEntry.abs, { force: true })
        summary.deletedRemote += 1
        log(`deleted remote ${rel}`)
        continue
      }

      if (localHash === remoteHash) {
        summary.nextBase[rel] = await pairState(localEntry, localHash, remoteRoot, rel)
        continue
      }

      if (cached === undefined) {
        await preserveConflict({ localRoot, rel, remoteEntry, deviceName })
        await copyAtomic(localEntry.abs, remoteEntry.abs)
        summary.conflicts += 1
        summary.uploaded += 1
        summary.nextBase[rel] = await pairState(localEntry, localHash, remoteRoot, rel)
        log(`conflict ${rel} (both sides added different content)`)
        continue
      }

      const localChanged = localHash !== cached.hash
      const remoteChanged = remoteHash !== cached.hash

      if (localChanged && !remoteChanged) {
        await copyAtomic(localEntry.abs, remoteEntry.abs)
        summary.uploaded += 1
        summary.nextBase[rel] = await pairState(localEntry, localHash, remoteRoot, rel)
        log(`uploaded ${rel}`)
        continue
      }

      if (!localChanged && remoteChanged) {
        await copyAtomic(remoteEntry.abs, localEntry.abs)
        summary.downloaded += 1
        summary.nextBase[rel] = await pairState(remoteEntry, remoteHash, localRoot, rel)
        log(`downloaded ${rel}`)
        continue
      }

      await preserveConflict({ localRoot, rel, remoteEntry, deviceName })
      await copyAtomic(localEntry.abs, remoteEntry.abs)
      summary.conflicts += 1
      summary.uploaded += 1
      summary.nextBase[rel] = await pairState(localEntry, localHash, remoteRoot, rel)
      log(`conflict ${rel} (both sides changed)`)
    } catch (error) {
      summary.errors.push(`${rel}: ${errorMessage(error)}`)
      if (cached !== undefined) summary.nextBase[rel] = cached
    }
  }

  return summary
}

/**
 * Copy the remote version to a conflict-named local sibling.
 * @param {{localRoot: string, rel: string, remoteEntry: {abs: string}, deviceName: string}} input - conflict source.
 * @returns {Promise<void>} resolves after the copy.
 */
async function preserveConflict(input) {
  const destination = await conflictPath(input.localRoot, input.rel, input.deviceName)
  await copyAtomic(input.remoteEntry.abs, destination)
}

/**
 * Stamp the cached pair state for a path that is now equal on both sides.
 * @param {{abs: string, size: number, mtimeMs: number}} entry - one side entry.
 * @param {string|undefined} hash - agreed digest.
 * @param {string} otherRoot - opposite root, used to stat the twin.
 * @param {string} rel - relative path.
 * @returns {Promise<Record<string, any>>} cache record.
 */
async function pairState(entry, hash, otherRoot, rel) {
  const twin = await fsp.stat(path.join(otherRoot, rel)).catch(() => undefined)
  return {
    hash,
    lSize: entry.size,
    lMtime: entry.mtimeMs,
    rSize: twin?.size ?? entry.size,
    rMtime: twin?.mtimeMs ?? entry.mtimeMs,
  }
}
