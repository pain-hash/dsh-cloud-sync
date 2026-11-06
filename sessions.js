/**
 * Conversation snapshot encoding and comparison helpers.
 *
 * A snapshot is the complete logical session log plus enough metadata to map
 * it onto another device. JSON is written with metadata first so a human can
 * inspect it.
 */
import { createHash } from 'node:crypto'

export const CONVERSATION_FORMAT = 'dsh-sync.conversation'
export const CONVERSATION_VERSION = 1

/**
 * Stable digest of an event list.
 * @param {readonly unknown[]} events - session events.
 * @returns {string} SHA-256 hex digest.
 */
export function eventHash(events) {
  return createHash('sha256').update(JSON.stringify(events)).digest('hex')
}

/**
 * Hash only the final event, for cheap change detection.
 * @param {readonly unknown[]} events - session events.
 * @returns {string} digest of the empty string for an empty log.
 */
export function tailHash(events) {
  if (!Array.isArray(events) || events.length === 0) return eventHash([])
  return createHash('sha256').update(JSON.stringify(events[events.length - 1])).digest('hex')
}

/**
 * Encode one conversation snapshot.
 * @param {{
 *   header: object,
 *   inheritedEventCount?: number,
 *   events: readonly unknown[],
 *   projectId?: string|null,
 *   device?: string,
 * }} input - session data.
 * @returns {string} pretty-printed JSON.
 */
export function serializeConversation(input) {
  const events = input.events ?? []
  return `${JSON.stringify(
    {
      format: CONVERSATION_FORMAT,
      version: CONVERSATION_VERSION,
      sessionId: input.header.id,
      projectId: input.projectId ?? null,
      device: input.device ?? null,
      exportedAt: new Date().toISOString(),
      inheritedEventCount: input.inheritedEventCount ?? 0,
      eventCount: events.length,
      eventHash: eventHash(events),
      header: input.header,
      events,
    },
    null,
    2,
  )}\n`
}

/**
 * Parse and validate one conversation snapshot.
 * @param {string} text - snapshot JSON.
 * @returns {{header: object, inheritedEventCount: number, events: unknown[], projectId: string|null, device: string|null, eventCount: number, eventHash: string}}
 */
export function parseConversation(text) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(`conversation snapshot is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (value === null || typeof value !== 'object') throw new Error('conversation snapshot is not an object')
  if (value.format !== CONVERSATION_FORMAT) throw new Error(`unsupported conversation format '${String(value.format)}'`)
  if (value.version !== CONVERSATION_VERSION) throw new Error(`unsupported conversation version '${String(value.version)}'`)
  if (value.header === null || typeof value.header !== 'object') throw new Error('conversation snapshot has no header')
  if (typeof value.header.id !== 'string' || value.header.id === '') throw new Error('conversation snapshot has no session id')
  if (!Array.isArray(value.events)) throw new Error('conversation snapshot has no event list')
  return {
    header: value.header,
    inheritedEventCount: Number.isSafeInteger(value.inheritedEventCount) ? value.inheritedEventCount : 0,
    events: value.events,
    projectId: typeof value.projectId === 'string' ? value.projectId : null,
    device: typeof value.device === 'string' ? value.device : null,
    eventCount: value.events.length,
    eventHash: typeof value.eventHash === 'string' ? value.eventHash : eventHash(value.events),
  }
}

/**
 * Compare two append-only event logs by exact prefix.
 * @param {readonly unknown[]} local - local log.
 * @param {readonly unknown[]} remote - remote log.
 * @returns {{relation: 'equal'|'local-ahead'|'remote-ahead'|'diverged', common: number}}
 */
export function compareEventLogs(local, remote) {
  const limit = Math.min(local.length, remote.length)
  for (let index = 0; index < limit; index += 1) {
    if (JSON.stringify(local[index]) !== JSON.stringify(remote[index])) {
      return { relation: 'diverged', common: index }
    }
  }
  if (local.length === remote.length) return { relation: 'equal', common: limit }
  return local.length > remote.length
    ? { relation: 'local-ahead', common: limit }
    : { relation: 'remote-ahead', common: limit }
}
