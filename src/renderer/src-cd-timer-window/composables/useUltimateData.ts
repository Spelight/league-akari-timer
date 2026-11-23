import { useInstance } from '@renderer-shared/shards'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import type { TimerRow } from '@shared/cd-timer'
import type { ChampSpell } from '@shared/types/league-client/game-data'
import { useIntervalFn } from '@vueuse/core'
import { type Ref, ref, shallowReactive, watch } from 'vue'

export function useUltimateData(rows: Ref<TimerRow[]>, enabled: () => boolean) {
  const leagueClient = useInstance(LeagueClientRenderer)
  const state = useLeagueClientStore()
  const spells = shallowReactive<Record<number, ChampSpell | null>>({})
  const retry = ref(0)
  useIntervalFn(() => {
    if (enabled()) retry.value++
  }, 15000)
  watch(
    [
      () => state.isConnected,
      enabled,
      () => rows.value.map((row) => row.championId).join(','),
      retry
    ],
    ([connected, active], _, onCleanup) => {
      if (!connected) {
        for (const id of Object.keys(spells)) delete spells[Number(id)]
        return
      }
      if (!active) return
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 5000)
      onCleanup(() => {
        clearTimeout(timeout)
        controller.abort()
      })
      const ids = [...new Set(rows.value.map((row) => row.championId))].filter(
        (id): id is number => id !== null && spells[id] === undefined
      )
      void Promise.allSettled(
        ids.map(async (id) => {
          const { data } = await leagueClient.api.gameData.getChampDetails(id, {
            signal: controller.signal
          })
          if (!controller.signal.aborted)
            spells[id] = data.spells.find((spell) => spell.spellKey.toLowerCase() === 'r') ?? null
        })
      ).finally(() => clearTimeout(timeout))
    },
    { immediate: true }
  )
  return spells
}
