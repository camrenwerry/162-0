import {
  DRAFT_TICKET_GAME_MODE,
  DRAFT_TICKET_REQUEST_SCHEMA_VERSION,
  encodeDraftTicketEnvelope,
  issueDraftTicket,
  verifyDraftTicket,
  type DraftTicketEnvelope,
} from '../functions/lib/draft-ticket'
import { constantTimeDigestEqual } from '../functions/lib/draft-submission'

const TEST_NOW = 1_800_000_000_000
const TEST_SIGNING_KEY = 'test-only-workerd-signing-key'
const TEST_TICKET_ID = '11111111-1111-4111-8111-111111111111'
const DIGEST_A = '00'.repeat(32)
const DIGEST_B = `${'00'.repeat(31)}01`

function decodeDraftTicketEnvelope(token: string): DraftTicketEnvelope {
  const padded = `${token.replaceAll('-', '+').replaceAll('_', '/')}${'='.repeat((4 - (token.length % 4)) % 4)}`
  return JSON.parse(atob(padded)) as DraftTicketEnvelope
}

async function runRegression() {
  const timingSafeEqual = crypto.subtle.timingSafeEqual
  if (typeof timingSafeEqual !== 'function') throw new Error('workerd timingSafeEqual was not available.')

  let detachedTimingSafeEqualThrows = false
  try {
    timingSafeEqual(new Uint8Array([1]), new Uint8Array([1]))
  } catch (error) {
    detachedTimingSafeEqualThrows = error instanceof TypeError && error.message.includes('Illegal invocation')
  }
  if (!detachedTimingSafeEqualThrows) throw new Error('workerd did not enforce the timingSafeEqual receiver.')

  const issued = await issueDraftTicket(TEST_SIGNING_KEY, {
    ticketRequestSchemaVersion: DRAFT_TICKET_REQUEST_SCHEMA_VERSION,
    gameMode: DRAFT_TICKET_GAME_MODE,
  }, {
    now: () => TEST_NOW,
    ticketId: () => TEST_TICKET_ID,
    randomValues: (values) => {
      values.set(Uint8Array.from({ length: 16 }, (_, index) => index + 1))
      return values
    },
  })

  const verification = await verifyDraftTicket(issued.token, TEST_SIGNING_KEY, TEST_NOW)
  if (!verification.ok) throw new Error(`workerd rejected an issued ticket: ${verification.reason}`)

  const envelope = decodeDraftTicketEnvelope(issued.token)
  const modifiedTicket = encodeDraftTicketEnvelope({
    ...envelope,
    payload: {
      ...envelope.payload,
      draftSeed: 'seeded-v1:11111111111111111111111111111111',
    },
  })
  const modifiedVerification = await verifyDraftTicket(modifiedTicket, TEST_SIGNING_KEY, TEST_NOW)
  if (modifiedVerification.ok || modifiedVerification.reason !== 'invalid_ticket_signature') {
    throw new Error('workerd did not reject a modified ticket with invalid_ticket_signature.')
  }

  const digestComparison = [
    constantTimeDigestEqual(DIGEST_A, DIGEST_A),
    constantTimeDigestEqual(DIGEST_A, DIGEST_B),
    constantTimeDigestEqual(DIGEST_A, 'A'.repeat(64)),
  ]
  if (digestComparison[0] !== true || digestComparison[1] !== false || digestComparison[2] !== null) {
    throw new Error('workerd digest comparison did not preserve the true/false/null contract.')
  }

  return {
    timingSafeEqualAvailable: true,
    detachedTimingSafeEqualThrows,
    issuedTicketVerified: true,
    modifiedTicketReason: modifiedVerification.reason,
    digestComparison,
  }
}

export default {
  async fetch() {
    return Response.json(await runRegression())
  },
}
