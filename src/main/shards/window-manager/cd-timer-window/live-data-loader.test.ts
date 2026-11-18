import type { GameClientHttpApiAxiosHelper } from '@shared/http-api-axios-helper/game-client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TimerLiveDataLoader } from './live-data-loader'

afterEach(() => vi.useRealTimers())

describe('timer live data polling', () => {
  it('clears failed samples, retries and never publishes a late response after stop', async () => {
    vi.useFakeTimers()
    let resolveLate: (value: unknown) => void = () => {}
    const response = {
      data: {
        gameData: { gameTime: 900, gameMode: 'CLASSIC' },
        activePlayer: { riotId: 'me#tag' },
        allPlayers: []
      }
    }
    const getAllGameData = vi
      .fn()
      .mockResolvedValueOnce(response)
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveLate = resolve
          })
      )
    const publish = vi.fn()
    const loader = new TimerLiveDataLoader(
      { getAllGameData } as unknown as GameClientHttpApiAxiosHelper,
      publish
    )
    loader.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(publish).toHaveBeenLastCalledWith(
      expect.objectContaining({ gameTime: 900, activePlayerName: 'me#tag' })
    )
    await vi.advanceTimersByTimeAsync(500)
    expect(publish).toHaveBeenLastCalledWith(null)
    await vi.advanceTimersByTimeAsync(500)
    loader.stop()
    const count = publish.mock.calls.length
    resolveLate(response)
    await vi.advanceTimersByTimeAsync(5000)
    expect(publish).toHaveBeenCalledTimes(count)
    expect(getAllGameData).toHaveBeenCalledTimes(3)
  })
})
