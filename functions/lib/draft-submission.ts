import type { DraftTranscript, DraftTranscriptEvent } from '../../src/game/DraftTranscript'

export const DRAFT_SUBMISSION_SCHEMA_VERSION = 'pennant-draft-submission-v1'
export const DRAFT_SUBMISSION_RETENTION_MS = 86_400_000
export const TRANSCRIPT_DIGEST_DOMAIN = 'pennant-pursuit:submission-transcript:v1\n'
export const TICKET_TOKEN_DIGEST_DOMAIN = 'pennant-pursuit:submission-ticket-token:v1\n'

const DIGEST_PATTERN = /^[0-9a-f]{64}$/

function canonicalEvent(event: DraftTranscriptEvent) {
  if (event.type === 'initial-roll') {
    return {
      type: event.type,
      round: event.round,
      combinationId: event.combinationId,
    }
  }
  if (event.type === 'reroll') {
    return {
      type: event.type,
      reroll: event.reroll,
      round: event.round,
      discardedCombinationId: event.discardedCombinationId,
      resultingCombinationId: event.resultingCombinationId,
    }
  }
  return {
    type: event.type,
    round: event.round,
    pickOrder: event.pickOrder,
    combinationId: event.combinationId,
    canonicalCardId: event.canonicalCardId,
    sourcePlayerId: event.sourcePlayerId,
    assignedPosition: event.assignedPosition,
    featuredSeason: event.featuredSeason,
  }
}

/** Fixed-field canonicalization for draft-transcript-v1 only. */
export function canonicalizeSubmissionTranscript(transcript: DraftTranscript) {
  return JSON.stringify({
    header: {
      transcriptSchemaVersion: transcript.header.transcriptSchemaVersion,
      appVersion: transcript.header.appVersion,
      gameRulesVersion: transcript.header.gameRulesVersion,
      rngVersion: transcript.header.rngVersion,
      scoringVersion: transcript.header.scoringVersion,
      dataVersion: transcript.header.dataVersion,
      canonicalDataDigest: transcript.header.canonicalDataDigest,
      draftId: transcript.header.draftId,
      gameplaySeed: transcript.header.gameplaySeed,
      createdAt: transcript.header.createdAt,
    },
    events: transcript.events.map(canonicalEvent),
  })
}

function hexadecimal(bytes: ArrayBuffer) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function domainSeparatedSha256(domain: string, value: string) {
  const input = new TextEncoder().encode(domain + value)
  return hexadecimal(await crypto.subtle.digest('SHA-256', input))
}

export function digestSubmissionTranscript(transcript: DraftTranscript) {
  return domainSeparatedSha256(TRANSCRIPT_DIGEST_DOMAIN, canonicalizeSubmissionTranscript(transcript))
}

/** Hashes the original opaque token string without decoding or reserialization. */
export function digestSubmissionTicketToken(ticket: string) {
  return domainSeparatedSha256(TICKET_TOKEN_DIGEST_DOMAIN, ticket)
}

function decodeDigest(value: string) {
  if (!DIGEST_PATTERN.test(value)) return null
  const bytes = new Uint8Array(32)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

/**
 * Compares decoded, fixed-length digest bytes. A null result means persistent
 * data is malformed and must be handled as submission_unavailable.
 */
export function constantTimeDigestEqual(left: string, right: string): boolean | null {
  const leftBytes = decodeDigest(left)
  const rightBytes = decodeDigest(right)
  if (!leftBytes || !rightBytes) return null

  const timingSafeEqual = crypto.subtle.timingSafeEqual
  if (typeof timingSafeEqual === 'function') return timingSafeEqual(leftBytes, rightBytes)

  // Standards-only local/test runtimes lack the Workers extension. Both inputs
  // are fixed at 32 bytes, and this fallback visits every byte.
  let difference = 0
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index]
  }
  return difference === 0
}
