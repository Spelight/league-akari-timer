import type { PlayerList } from '../types/game-client'
import type { ChampSpell, ChampionSimple, SummonerSpell } from '../types/league-client/game-data'

export interface TimerRow {
  id: string
  championId: number | null
  level?: number
  label: string
  position: string
  spell1Id: number
  spell2Id: number
}

export interface TimerLiveData {
  gameTime: number
  sampledAt: number
  gameMode: string
  activePlayerName: string
  players: PlayerList[]
}

export type TimerSlot = 'd' | 'f' | 'r'
export type TimerReportKind = 'flash' | 'summoner' | 'ultimate'

export function shouldReportTimer(
  row: Pick<TimerRow, 'spell1Id' | 'spell2Id'>,
  slot: TimerSlot,
  kinds: readonly TimerReportKind[]
) {
  if (slot === 'r') return kinds.includes('ultimate')
  return kinds.includes('summoner') || (kinds.includes('flash') && isFlashTimerSlot(row, slot))
}

export function isFlashTimerSlot(row: Pick<TimerRow, 'spell1Id' | 'spell2Id'>, slot: TimerSlot) {
  return (slot === 'd' && row.spell1Id === 4) || (slot === 'f' && row.spell2Id === 4)
}

// Client assets may report maxLevel=0 and pad coefficients to six entries.
// These champions do not follow the ordinary three-rank ultimate progression.
const SPECIAL_ULTIMATE_RANKS: Record<number, number> = { 43: 4, 60: 4, 76: 4, 77: 6, 126: 4 }

function ultimateMaxRank(spell: ChampSpell, championId?: number | null) {
  if (spell.maxLevel > 0) return spell.maxLevel
  return SPECIAL_ULTIMATE_RANKS[championId ?? 0] ?? 3
}

export function ultimateRankCooldowns(
  spell: ChampSpell | null | undefined,
  championId?: number | null
) {
  if (!spell) return []
  return spell.cooldownCoefficients
    .slice(0, ultimateMaxRank(spell, championId))
    .map((seconds, i) => ({
      rank: i + 1,
      seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null
    }))
}

/** Ordinary three-rank ultimates only; this estimates skill allocation, not actual enemy ranks. */
export function estimateUltimateCooldown(
  spell: ChampSpell | null | undefined,
  level?: number,
  championId?: number | null
) {
  if (
    !spell ||
    SPECIAL_ULTIMATE_RANKS[championId ?? 0] ||
    ultimateMaxRank(spell, championId) !== 3 ||
    !Number.isFinite(level) ||
    level! < 6
  )
    return null
  const rank = level! >= 16 ? 3 : level! >= 11 ? 2 : 1
  const seconds = ultimateRankCooldowns(spell, championId)[rank - 1]?.seconds
  return seconds ? { rank, seconds } : null
}

export function adjustUltimateCooldown(current: number | null, delta: number) {
  return Math.min(600, Math.max(1, (current ?? 120) + delta))
}

export const POSITIONS = ['top', 'jug', 'mid', 'ad', 'sup'] as const

export function positionLabel(position?: string): string {
  const aliases: Record<string, string> = {
    TOP: 'top',
    JUNGLE: 'jug',
    JUG: 'jug',
    MIDDLE: 'mid',
    MID: 'mid',
    BOTTOM: 'ad',
    BOT: 'ad',
    ADC: 'ad',
    AD: 'ad',
    UTILITY: 'sup',
    SUPPORT: 'sup',
    SUP: 'sup'
  }
  return aliases[(position || '').toUpperCase()] || ''
}

export function positionOrder(position?: string) {
  const index = POSITIONS.indexOf(positionLabel(position) as (typeof POSITIONS)[number])
  return index < 0 ? 99 : index
}

// Standard spell fallback, verified against Riot Data Dragon on 2026-11-18.
// Prefer the connected client's version-specific data whenever it is usable.
const SPELLS: Record<string, [number, number]> = {
  SummonerBoost: [1, 240],
  SummonerExhaust: [3, 240],
  SummonerFlash: [4, 300],
  SummonerHaste: [6, 240],
  SummonerHeal: [7, 240],
  SummonerSmite: [11, 15],
  SummonerTeleport: [12, 300],
  SummonerMana: [13, 240],
  SummonerDot: [14, 180],
  SummonerBarrier: [21, 180],
  SummonerSnowball: [32, 80],
  SummonerSnowURFSnowball_Mark: [39, 80]
}

export function liveSpellId(rawName: string) {
  const name = rawName.replace(/^.*SummonerSpell_/, '').replace(/_(?:DisplayName|Name)$/, '')
  return SPELLS[name]?.[0] ?? 0
}

export function liveEnemyRows(
  data: TimerLiveData,
  champions: Record<number, ChampionSimple>,
  spells: Record<number, SummonerSpell>,
  fallback: TimerRow[]
): TimerRow[] {
  const self = data.players.find(
    (p) => p.riotId === data.activePlayerName || p.summonerName === data.activePlayerName
  )
  if (!data.activePlayerName || !self) return fallback
  const enemies = data.players.filter((p) => p.team !== self.team)
  return enemies
    .map((p) => {
      const champion = Object.values(champions).find(
        (c) =>
          c.alias.toLowerCase() ===
            p.rawChampionName.replace(/^game_character_displayname_/, '').toLowerCase() ||
          c.name === p.championName
      )
      const matches = fallback.filter((row) => row.championId === champion?.id)
      const previous = matches.length === 1 ? matches[0] : undefined
      const position = positionLabel(p.position) || previous?.position || ''
      const spellId = (spell: PlayerList['summonerSpells']['summonerSpellOne']) =>
        liveSpellId(spell.rawDisplayName) ||
        Object.values(spells).find((s) => s.name === spell.displayName)?.id ||
        0
      return {
        id:
          enemies.filter((e) => e.rawChampionName === p.rawChampionName).length === 1
            ? `champion-${p.rawChampionName.replace(/^game_character_displayname_/, '').toLowerCase()}`
            : `live-${p.riotId || p.summonerName}`,
        championId: champion?.id ?? null,
        level: p.level,
        position,
        label: position || p.championName,
        spell1Id: spellId(p.summonerSpells.summonerSpellOne) || previous?.spell1Id || 0,
        spell2Id: spellId(p.summonerSpells.summonerSpellTwo) || previous?.spell2Id || 0
      }
    })
    .sort((a, b) => positionOrder(a.position) - positionOrder(b.position))
}

export function cooldownSeconds(id: number, clientCooldown?: number, haste = 0) {
  const fallback = Object.values(SPELLS).find(([spellId]) => spellId === id)?.[1]
  const base = Number.isFinite(clientCooldown) && clientCooldown! > 0 ? clientCooldown : fallback
  return base === undefined ? null : (base * 100) / (100 + Math.max(0, haste))
}

export function gameTimeNow(data: TimerLiveData | null, now: number) {
  if (!data || now - data.sampledAt > 2500 || now < data.sampledAt) return null
  // Use the sampled game clock, so a paused game does not advance with the PC clock.
  return data.gameTime
}

export interface SpellTimer {
  type: 'countdown' | 'countup'
  baseTimestamp: number
  gameTimestamp: number | null
  cooldown: number | null
}

export function createSpellTimer(
  type: SpellTimer['type'],
  cooldown: number | null,
  now: number,
  gameTime: number | null
): SpellTimer | null {
  if (type === 'countdown' && cooldown === null) return null
  const duration = type === 'countdown' ? cooldown! * 1000 : 0
  return {
    type,
    cooldown,
    baseTimestamp: now + duration,
    gameTimestamp: gameTime === null ? null : gameTime + duration / 1000
  }
}

export function timerBaseTimestamp(timer: SpellTimer, gameTime: number | null, now: number) {
  return gameTime !== null && timer.gameTimestamp !== null
    ? now + (timer.gameTimestamp - gameTime) * 1000
    : timer.baseTimestamp
}

export function formatTimerMessage(
  label: string,
  slot: TimerSlot,
  timer: SpellTimer,
  now: number,
  gameTime: number | null
) {
  if (timer.cooldown === null) return null
  const base = timerBaseTimestamp(timer, gameTime, now)
  const readyIn = (base - now) / 1000 + (timer.type === 'countup' ? timer.cooldown : 0)
  if (readyIn <= 0) return `${label} ${slot} OK`
  const seconds = gameTime === null ? Math.ceil(readyIn) : Math.ceil(gameTime + readyIn - 0.000001)
  const minute = Math.floor(seconds / 60)
  const second = String(seconds % 60).padStart(2, '0')
  return `${label} ${slot} ${minute}${gameTime === null ? ':' : ''}${second}`
}

/** Keep the supplied row/slot order; omit cancelled and completed cooldowns. */
export function formatActiveTimerMessages(
  entries: { label: string; slot: TimerSlot; timer: SpellTimer | undefined }[],
  now: number,
  gameTime: number | null
) {
  return entries
    .flatMap(({ label, slot, timer }) => {
      if (!timer || timer.cooldown === null) return []
      const remaining =
        (timerBaseTimestamp(timer, gameTime, now) - now) / 1000 +
        (timer.type === 'countup' ? timer.cooldown : 0)
      if (remaining <= 0) return []
      const text = formatTimerMessage(label, slot, timer, now, gameTime)
      return text ? [text] : []
    })
    .join(' / ')
}
