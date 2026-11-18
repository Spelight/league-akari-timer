<template>
  <div class="spells-cd-timer">
    <TimerItem
      v-for="item in items"
      :key="item.id"
      :data-timer-row="item.id"
      :label="item.position || '?'"
      :spell1-id="item.spell1Id"
      :spell2-id="item.spell2Id"
      :timer-type="ctws.settings.timerType"
      :spell1-base-timestamp="displayTimestamp(item, 'd')"
      :spell2-base-timestamp="displayTimestamp(item, 'f')"
      @spell1-click="toggleTimer(item, 'd')"
      @spell2-click="toggleTimer(item, 'f')"
      @spell1-wheel="(_, delta) => adjustTimer(item, 'd', delta)"
      @spell2-wheel="(_, delta) => adjustTimer(item, 'f', delta)"
      @position-change="(position) => setPosition(item, position)"
      class="item-margin"
    />
    <div v-if="!items.some((item) => item.spell1Id || item.spell2Id)" class="status-text">
      {{ t('cdTimer.window.waitingForSpells') }}
    </div>
    <div v-if="lastMessage" class="status-text" role="status">{{ lastMessage }}</div>
  </div>
</template>

<script setup lang="ts">
import { useRightClick } from '@cd-timer-window/composables/useRightClick'
import { useAdditionalInfoStore } from '@cd-timer-window/shards/additional-info/store'
import { useInstance } from '@renderer-shared/shards'
import { useAppCommonStore } from '@renderer-shared/shards/app-common/store'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'
import { useCdTimerWindowStore } from '@renderer-shared/shards/window-manager/store'
import { EMPTY_PUUID } from '@shared/constants/common'
import {
  POSITIONS,
  positionLabel,
  positionOrder,
  cooldownSeconds,
  createSpellTimer,
  formatTimerMessage,
  formatActiveTimerMessages,
  gameTimeNow,
  liveEnemyRows,
  timerBaseTimestamp,
  type SpellTimer,
  type TimerRow,
  type TimerLiveData
} from '@shared/cd-timer'
import { useIntervalFn } from '@vueuse/core'
import { useTranslation } from 'i18next-vue'
import { useMessage } from 'naive-ui'
import { computed, ref, shallowRef, shallowReactive, watch } from 'vue'
import TimerItem from './TimerItem.vue'

const { t } = useTranslation()
const lcs = useLeagueClientStore()
const ctws = useCdTimerWindowStore()
const as = useAppCommonStore()
const ais = useAdditionalInfoStore()
const wm = useInstance(WindowManagerRenderer)
const message = useMessage()
const now = ref(Date.now())
useIntervalFn(() => {
  now.value = Date.now()
}, 100)
const currentGameTime = computed(() => gameTimeNow(ctws.liveData, now.value))
const timers = shallowReactive<Record<string, SpellTimer>>({})
const lastMessage = ref('')
const rosterSnapshot = shallowRef<TimerLiveData | null>(ctws.liveData)
const manualPositions = shallowReactive<Record<string, string>>({})
const lcuItems = computed<TimerRow[]>(() => {
  if (!lcs.gameflow.session || lcs.gameflow.session.phase !== 'InProgress' || !lcs.summoner.me)
    return []
  const selfPuuid = lcs.summoner.me.puuid
  const game = lcs.gameflow.session.gameData

  const teamOnePuuids = Array.from(
    new Set<string>([
      ...game.teamOne.map((p) => p.puuid),
      ...(ais.additional.teams['TEAM-100'] || [])
    ])
  )
  const teamTwoPuuids = Array.from(
    new Set<string>([
      ...game.teamTwo.map((p) => p.puuid),
      ...(ais.additional.teams['TEAM-200'] || [])
    ])
  )

  const selections = game.playerChampionSelections
  const selectionMap: Record<string, { championId: number; spell1Id: number; spell2Id: number }> =
    {}
  const positionMap: Record<string, string> = {}

  for (const player of [...game.teamOne, ...game.teamTwo]) {
    if (player.puuid && player.puuid !== EMPTY_PUUID) {
      positionMap[player.puuid] = player.selectedPosition || ''
    }
  }

  for (const selection of selections) {
    if (selection.puuid && selection.puuid !== EMPTY_PUUID) {
      selectionMap[selection.puuid] = {
        championId: selection.championId,
        spell1Id: selection.spell1Id,
        spell2Id: selection.spell2Id
      }
    }
  }

  for (const [puuid, assignment] of Object.entries(ais.additional.positions || {})) {
    if (assignment?.position) {
      positionMap[puuid] = assignment.position
    }
  }

  for (const [puuid, championId] of Object.entries(ais.additional.selections)) {
    const spells = ais.additional.spells[puuid]
    if (spells) {
      selectionMap[puuid] = {
        championId,
        spell1Id: spells.spell1Id,
        spell2Id: spells.spell2Id
      }
    }
  }

  if (!teamOnePuuids.includes(selfPuuid) && !teamTwoPuuids.includes(selfPuuid)) return []
  const theirTeamPuuids = teamOnePuuids.includes(selfPuuid) ? teamTwoPuuids : teamOnePuuids

  if (!theirTeamPuuids.length) {
    return []
  }

  const theirTeamSelections = theirTeamPuuids
    .map((puuid, index) => ({
      puuid,
      index,
      position: positionMap[puuid] || '',
      selection: selectionMap[puuid]
    }))
    .filter((p) => p.selection !== undefined)
    .sort((a, b) => {
      const positionDelta = positionOrder(a.position) - positionOrder(b.position)
      if (positionDelta !== 0) {
        return positionDelta
      }

      return a.index - b.index
    })

  return theirTeamSelections.map((entry) => {
    const p = entry.selection!
    return {
      id:
        theirTeamSelections.filter((e) => e.selection?.championId === p.championId).length === 1
          ? `champion-${lcs.gameData.champions[p.championId]?.alias.toLowerCase() || p.championId}`
          : entry.puuid,
      position: positionLabel(entry.position),
      label:
        positionLabel(entry.position) ||
        lcs.gameData.champions[p.championId]?.name ||
        String(p.championId),
      ...p
    }
  })
})

const items = computed<TimerRow[]>(() => {
  const rows = rosterSnapshot.value
    ? liveEnemyRows(
        rosterSnapshot.value,
        lcs.gameData.champions,
        lcs.gameData.summonerSpells,
        lcuItems.value
      )
    : lcuItems.value
  return rows.length
    ? rows
        .map((row) => {
          const position = manualPositions[row.id] ?? row.position
          return {
            ...row,
            position,
            label:
              position ||
              lcs.gameData.champions[row.championId ?? 0]?.name ||
              (row.position ? '?' : row.label)
          }
        })
        .sort((a, b) => positionOrder(a.position) - positionOrder(b.position))
    : POSITIONS.map((position) => ({
        id: position,
        position,
        label: position,
        championId: null,
        spell1Id: 0,
        spell2Id: 0
      }))
})

const setPosition = (row: TimerRow, position: string) => {
  if (!row.spell1Id && !row.spell2Id) return
  for (const other of items.value) {
    if (other.id !== row.id && other.position === position) manualPositions[other.id] = row.position
  }
  manualPositions[row.id] = position
}

const timerId = (row: TimerRow, slot: 'd' | 'f') =>
  [row.id, slot, slot === 'd' ? row.spell1Id : row.spell2Id].join('-')

const displayTimestamp = (row: TimerRow, slot: 'd' | 'f') => {
  const timer = timers[timerId(row, slot)]
  return timer ? timerBaseTimestamp(timer, currentGameTime.value, now.value) : null
}

const toggleTimer = (row: TimerRow, slot: 'd' | 'f') => {
  const id = timerId(row, slot)
  const existing = timers[id]
  if (
    existing &&
    (existing.type === 'countup' ||
      timerBaseTimestamp(existing, currentGameTime.value, now.value) > now.value)
  ) {
    delete timers[id]
    return
  }
  const spellId = slot === 'd' ? row.spell1Id : row.spell2Id
  if (!spellId) {
    message.warning(t('cdTimer.window.waitingForSpells'))
    return
  }
  const mode = ctws.liveData?.gameMode || lcs.gameflow.session?.gameData.queue.gameMode
  const haste = ctws.supportedGameModes.find((item) => item.gameMode === mode)?.abilityHaste ?? 0
  const cooldown = cooldownSeconds(spellId, lcs.gameData.summonerSpells[spellId]?.cooldown, haste)
  const timer = createSpellTimer(
    ctws.settings.timerType,
    cooldown,
    Date.now(),
    gameTimeNow(ctws.liveData, Date.now())
  )
  if (!timer) {
    message.warning(t('cdTimer.window.cooldownUnavailable'))
    return
  }
  timers[id] = timer
}

// Keep the wall-clock fallback aligned with the game clock (including pauses).
watch(
  () => ctws.liveData,
  (data) => {
    if (!data) return
    rosterSnapshot.value = data
    for (const [id, timer] of Object.entries(timers)) {
      if (timer.gameTimestamp === null) {
        timers[id] = {
          ...timer,
          gameTimestamp: data.gameTime + (timer.baseTimestamp - Date.now()) / 1000
        }
      } else {
        timers[id] = {
          ...timer,
          baseTimestamp: Date.now() + (timer.gameTimestamp - data.gameTime) * 1000
        }
      }
    }
  }
)

const adjustTimer = (row: TimerRow, slot: 'd' | 'f', delta: number) => {
  const id = timerId(row, slot)
  const timer = timers[id]
  if (!timer) return
  const base = timerBaseTimestamp(timer, currentGameTime.value, now.value)
  const deltaMs = delta * (ctws.settings.reverseAdjustmentDirection ? -50 : 50)
  const target =
    timer.type === 'countdown'
      ? Math.max(now.value, base + deltaMs)
      : Math.min(now.value, base + deltaMs)
  timers[id] = {
    ...timer,
    baseTimestamp: timer.baseTimestamp + target - base,
    gameTimestamp:
      timer.gameTimestamp === null ? null : timer.gameTimestamp + (target - base) / 1000
  }
}

const clearTimers = () => {
  for (const id of Object.keys(timers)) delete timers[id]
  lastMessage.value = ''
  resetRightClick()
}
watch(() => ctws.settings.timerType, clearTimers)
watch(
  [() => lcs.gameflow.session?.gameData.gameId, () => lcs.gameflow.session?.phase === 'InProgress'],
  () => {
    clearTimers()
    rosterSnapshot.value = null
    for (const id of Object.keys(manualPositions)) delete manualPositions[id]
  }
)

const sendInGameText = async (row: TimerRow, slot: 'd' | 'f') => {
  const timer = timers[timerId(row, slot)]
  if (!timer) return
  const text = formatTimerMessage(
    row.label,
    slot,
    timer,
    Date.now(),
    gameTimeNow(ctws.liveData, Date.now())
  )
  if (!text) {
    message.warning(t('cdTimer.window.cooldownUnavailable'))
    return
  }
  await sendText(text)
}

const sendAllInGameText = async () => {
  const timestamp = Date.now()
  const text = formatActiveTimerMessages(
    items.value.flatMap((row) =>
      (['d', 'f'] as const).map((slot) => ({
        label: row.label,
        slot,
        timer: timers[timerId(row, slot)]
      }))
    ),
    timestamp,
    gameTimeNow(ctws.liveData, timestamp)
  )
  if (!text) {
    message.info(t('cdTimer.window.noActiveTimers'))
    return
  }
  await sendText(text)
}

const resetRightClick = useRightClick(
  (target) => {
    const rowId = target.closest<HTMLElement>('[data-timer-row]')?.dataset.timerRow
    const row = items.value.find((item) => item.id === rowId)
    const slot = target.dataset.timerSlot
    if (row && (slot === 'd' || slot === 'f')) void sendInGameText(row, slot)
  },
  () => {
    void sendAllInGameText()
  }
)

const sendText = async (text: string) => {
  lastMessage.value = text
  if (!as.nativeSupport.nativeInput.available) {
    message.warning(t('cdTimer.window.nativeInjectionUnsupported'))
    return
  }
  try {
    await wm.cdTimerWindow.sendInGame(text)
  } catch (error: any) {
    const code = error?.code
    if (code === 'AlreadySending') message.warning(t('cdTimer.window.alreadySending'))
    else if (code === 'GameClientNotForeground')
      message.warning(t('cdTimer.window.gameNotForeground'))
    else if (code === 'NativeInputNotSupported' || error?.message?.includes('No function'))
      message.warning(t('cdTimer.window.nativeInjectionUnsupported'))
    else
      message.warning(t('cdTimer.window.sendFailed', { reason: error?.message || String(error) }))
  }
}
</script>
<style scoped>
.spells-cd-timer {
  padding: 8px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.item-margin:not(:last-child) {
  margin-bottom: 4px;
}
.status-text {
  max-width: 200px;
  margin-top: 6px;
  color: #fff;
  font-size: 12px;
  overflow-wrap: anywhere;
  font-variant-numeric: tabular-nums;
}
</style>
