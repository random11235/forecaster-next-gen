import { describe, expect, test } from 'vitest'
import type { Recording } from './recording.js'
import { replayTransport } from './replayTransport.js'

// Seam C's transport: a connector's injected fetch, answering from recorded raw responses.

const RECORDINGS: Recording[] = [
  {
    request: { method: 'GET', url: 'https://api.example.test/things?page=1' },
    response: { status: 200, body: { things: ['a'] } },
  },
  {
    request: { method: 'POST', url: 'https://api.example.test/search', body: '{"q":"a"}' },
    response: { status: 422, body: { message: 'Bad query' } },
  },
]

describe('replay transport', () => {
  test("answers a recorded request with its recorded status and body", async () => {
    const fetch = replayTransport(RECORDINGS)

    const response = await fetch('https://api.example.test/things?page=1', { headers: { authorization: 'Bearer x' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ things: ['a'] })
  })

  test('matches a request by its method and body as well as its URL', async () => {
    const fetch = replayTransport(RECORDINGS)

    const response = await fetch('https://api.example.test/search', { method: 'POST', body: '{"q":"a"}' })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ message: 'Bad query' })
  })

  test.each([
    ['an unrecorded URL', 'https://api.example.test/things?page=2', {}, 'GET https://api.example.test/things?page=2'],
    ['another method', 'https://api.example.test/things?page=1', { method: 'DELETE' }, 'DELETE https://api.example.test/things?page=1'],
    [
      'another body',
      'https://api.example.test/search',
      { method: 'POST', body: '{"q":"b"}' },
      'POST https://api.example.test/search {"q":"b"}',
    ],
  ])('throws on %s, naming the request', async (_, url, init, named) => {
    const fetch = replayTransport(RECORDINGS)

    await expect(fetch(url, init)).rejects.toThrow(`No recording for ${named}`)
  })
})
