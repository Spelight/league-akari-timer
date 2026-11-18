import type { TimerLiveData } from '@shared/cd-timer'
import type { GameClientHttpApiAxiosHelper } from '@shared/http-api-axios-helper/game-client'

export class TimerLiveDataLoader {
  private _timer: ReturnType<typeof setTimeout> | null = null
  private _controller: AbortController | null = null

  constructor(
    private readonly _api: GameClientHttpApiAxiosHelper,
    private readonly _publish: (data: TimerLiveData | null) => void
  ) {}

  start() {
    this.stop()
    const controller = new AbortController()
    this._controller = controller
    const poll = async () => {
      try {
        const { data } = await this._api.getAllGameData({
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(2000)])
        })
        if (!controller.signal.aborted) {
          if (!Number.isFinite(data.gameData?.gameTime) || !Array.isArray(data.allPlayers)) {
            this._publish(null)
          } else {
            this._publish({
              gameTime: data.gameData.gameTime,
              sampledAt: Date.now(),
              gameMode: data.gameData.gameMode,
              activePlayerName: data.activePlayer?.riotId || data.activePlayer?.summonerName || '',
              players: data.allPlayers
            })
          }
        }
      } catch {
        if (!controller.signal.aborted) this._publish(null)
      } finally {
        if (!controller.signal.aborted) this._timer = setTimeout(poll, 500)
      }
    }
    void poll()
  }

  stop() {
    this._controller?.abort()
    this._controller = null
    if (this._timer) clearTimeout(this._timer)
    this._timer = null
    this._publish(null)
  }
}
