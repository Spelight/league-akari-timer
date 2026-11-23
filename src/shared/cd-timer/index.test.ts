import { describe, expect, it } from 'vitest'

import type { PlayerList } from '../types/game-client'
import {
  type TimerLiveData,
  adjustUltimateCooldown,
  cooldownSeconds,
  createSpellTimer,
  estimateUltimateCooldown,
  formatActiveTimerMessages,
  formatTimerMessage,
  gameTimeNow,
  isFlashTimerSlot,
  liveEnemyRows,
  liveSpellId,
  positionLabel,
  shouldReportTimer,
  timerBaseTimestamp,
  ultimateRankCooldowns
} from './index'

describe('enemy summoner cooldowns', () => {
  it('reports a flash used at 15:00 as ad f 2000, even when reported later', () => {
    const timer = createSpellTimer('countdown', cooldownSeconds(4), 1000000, 900)!
    expect(formatTimerMessage('ad', 'f', timer, 1000000, 900)).toBe('ad f 2000')
    expect(formatTimerMessage('ad', 'f', timer, 1077000, 977)).toBe('ad f 2000')
    expect(formatTimerMessage('sup', 'd', timer, 1077000, 977)).toBe('sup d 2000')
    const fractional = createSpellTimer('countdown', 300, 1000000, 899.8)!
    expect(formatTimerMessage('ad', 'f', fractional, 1000000, 899.8)).toBe('ad f 2000')
  })

  it('uses remaining time when the game clock is unavailable, including timers started offline', () => {
    const timer = createSpellTimer('countdown', 300, 0, null)!
    expect(formatTimerMessage('sup', 'f', timer, 77000, null)).toBe('sup f 3:43')
    expect(formatTimerMessage('sup', 'f', timer, 300000, null)).toBe('sup f OK')
    expect(gameTimeNow({ gameTime: 900, sampledAt: 0 } as TimerLiveData, 3000)).toBeNull()
  })

  it('keeps the countdown stopped when the game clock is paused', () => {
    const timer = createSpellTimer('countdown', 300, 1000000, 900)!
    expect(timerBaseTimestamp(timer, 900, 1100000) - 1100000).toBe(300000)
    expect(formatTimerMessage('ad', 'f', timer, 1100000, 900)).toBe('ad f 2000')
  })

  it('also reports ready time in countup mode, rather than the cast time', () => {
    const timer = createSpellTimer('countup', 300, 1000000, 900)!
    expect(formatTimerMessage('ad', 'f', timer, 1077000, 977)).toBe('ad f 2000')
    expect(formatTimerMessage('ad', 'f', timer, 1077000, null)).toBe('ad f 3:43')
  })

  it('prefers valid client cooldowns, falls back for missing/invalid data and rejects unknown spells', () => {
    expect(cooldownSeconds(4, 240)).toBe(240)
    expect(cooldownSeconds(4, 0)).toBe(300)
    expect(cooldownSeconds(4, NaN, 100)).toBe(150)
    expect(createSpellTimer('countdown', cooldownSeconds(9999), 0, null)).toBeNull()
    expect(liveSpellId('GeneratedTip_SummonerSpell_SummonerFlash_DisplayName')).toBe(4)
    expect(liveSpellId('GeneratedTip_SummonerSpell_SummonerDot_DisplayName')).toBe(14)
    expect(liveSpellId('UnknownSpell')).toBe(0)
  })

  it('selects the opposing team and orders top/jug/mid/ad/sup without changing D/F slots', () => {
    const player = (name: string, team: string, position: string): PlayerList =>
      ({
        riotId: name,
        summonerName: name,
        team,
        position,
        rawChampionName: `game_character_displayname_${name}`,
        championName: name,
        summonerSpells: {
          summonerSpellOne: {
            displayName: 'Ignite',
            rawDisplayName: 'SummonerDot',
            rawDescription: ''
          },
          summonerSpellTwo: {
            displayName: 'Flash',
            rawDisplayName: 'SummonerFlash',
            rawDescription: ''
          }
        }
      }) as PlayerList
    const data: TimerLiveData = {
      gameTime: 900,
      sampledAt: 0,
      gameMode: 'CLASSIC',
      activePlayerName: 'self',
      players: [
        player('self', 'CHAOS', 'MIDDLE'),
        ...['UTILITY', 'BOTTOM', 'TOP', 'MIDDLE', 'JUNGLE'].map((p) => player(p, 'ORDER', p))
      ]
    }
    const rows = liveEnemyRows(data, {}, {}, [])
    expect(rows.map((r) => r.label)).toEqual(['top', 'jug', 'mid', 'ad', 'sup'])
    expect(rows.every((r) => r.spell1Id === 14 && r.spell2Id === 4)).toBe(true)
    expect(liveEnemyRows({ ...data, activePlayerName: 'missing' }, {}, {}, [])).toEqual([])
    expect(positionLabel('UNKNOWN')).toBe('')
  })
})

describe('batch cooldown messages', () => {
  it('sends active timers only in supplied position and D/F order', () => {
    expect(
      formatActiveTimerMessages(
        [
          { label: 'top', slot: 'd', timer: createSpellTimer('countdown', 300, 0, 900)! },
          { label: 'jug', slot: 'f', timer: undefined },
          { label: 'mid', slot: 'd', timer: createSpellTimer('countdown', 60, -60000, 840)! },
          { label: 'ad', slot: 'f', timer: createSpellTimer('countdown', 300, 0, 900)! },
          { label: 'sup', slot: 'd', timer: createSpellTimer('countup', 180, 0, 900)! }
        ],
        0,
        900
      )
    ).toBe('top d 2000 / ad f 2000 / sup d 1800')
  })
  it('falls back to remaining time for the whole batch', () => {
    expect(
      formatActiveTimerMessages(
        [
          { label: 'ad', slot: 'f', timer: createSpellTimer('countdown', 300, 0, null)! },
          { label: 'sup', slot: 'd', timer: createSpellTimer('countdown', 180, 0, null)! }
        ],
        77000,
        null
      )
    ).toBe('ad f 3:43 / sup d 1:43')
  })
  it('returns no message for stopped, finished or unknown cooldowns', () => {
    expect(
      formatActiveTimerMessages(
        [
          { label: 'top', slot: 'd', timer: undefined },
          { label: 'ad', slot: 'f', timer: createSpellTimer('countdown', 300, 0, null)! },
          { label: 'sup', slot: 'd', timer: createSpellTimer('countup', null, 0, null)! }
        ],
        300000,
        null
      )
    ).toBe('')
  })
})

describe('ultimate timer and configurable reports', () => {
  it('filters each category and combinations without duplicate slots', () => {
    const row = { spell1Id: 14, spell2Id: 4 }
    const slots = ['d', 'f', 'r'] as const
    expect(slots.filter((slot) => shouldReportTimer(row, slot, ['flash']))).toEqual(['f'])
    expect(slots.filter((slot) => shouldReportTimer(row, slot, ['summoner']))).toEqual(['d', 'f'])
    expect(slots.filter((slot) => shouldReportTimer(row, slot, ['ultimate']))).toEqual(['r'])
    expect(slots.filter((slot) => shouldReportTimer(row, slot, ['flash', 'ultimate']))).toEqual([
      'f',
      'r'
    ])
    expect(
      slots.filter((slot) => shouldReportTimer(row, slot, ['flash', 'summoner', 'ultimate']))
    ).toEqual(['d', 'f', 'r'])
    expect(slots.filter((slot) => shouldReportTimer(row, slot, []))).toEqual([])
  })
  it('recognizes Flash in either slot and excludes ultimates and other summoner spells', () => {
    const row = { spell1Id: 4, spell2Id: 14 }
    expect(isFlashTimerSlot(row, 'd')).toBe(true)
    expect(isFlashTimerSlot(row, 'f')).toBe(false)
    expect(isFlashTimerSlot(row, 'r')).toBe(false)
    expect(isFlashTimerSlot({ spell1Id: 12, spell2Id: 4 }, 'f')).toBe(true)
    expect(isFlashTimerSlot({ spell1Id: 0, spell2Id: 0 }, 'd')).toBe(false)
  })
  it('bounds manual ultimate cooldown adjustments', () => {
    expect(adjustUltimateCooldown(null, 5)).toBe(125)
    expect(adjustUltimateCooldown(90, -5)).toBe(85)
    expect(adjustUltimateCooldown(1, -5)).toBe(1)
    expect(adjustUltimateCooldown(600, 5)).toBe(600)
  })
  it('keeps an ultimate timer independent of Flash', () => {
    const ultimate = createSpellTimer('countdown', 90, 0, 900)!
    const flash = createSpellTimer('countdown', 300, 0, 900)!
    expect(timerBaseTimestamp(ultimate, 930, 30000)).toBe(90000)
    expect(timerBaseTimestamp(flash, 930, 30000)).toBe(300000)
  })
})

describe('champion ultimate base cooldowns', () => {
  const spell = {
    maxLevel: 3,
    cooldownCoefficients: [120, 90, 60, 0, 0, 0]
  } as import('../types/league-client/game-data').ChampSpell
  it('estimates ordinary ranks from level while using the connected client coefficients', () => {
    expect(ultimateRankCooldowns(spell)).toEqual([
      { rank: 1, seconds: 120 },
      { rank: 2, seconds: 90 },
      { rank: 3, seconds: 60 }
    ])
    expect(estimateUltimateCooldown(spell, 6)).toEqual({ rank: 1, seconds: 120 })
    expect(estimateUltimateCooldown(spell, 10)).toEqual({ rank: 1, seconds: 120 })
    expect(estimateUltimateCooldown(spell, 11)).toEqual({ rank: 2, seconds: 90 })
    expect(estimateUltimateCooldown(spell, 16)).toEqual({ rank: 3, seconds: 60 })
  })
  it('does not guess for unknown levels, missing data, or special rank progressions', () => {
    expect(estimateUltimateCooldown(spell)).toBeNull()
    expect(estimateUltimateCooldown(spell, 5)).toBeNull()
    expect(estimateUltimateCooldown(null, 18)).toBeNull()
    expect(estimateUltimateCooldown({ ...spell, maxLevel: 4 }, 18)).toBeNull()
    expect(
      estimateUltimateCooldown({ ...spell, cooldownCoefficients: [0, NaN, 60] }, 11)
    ).toBeNull()
  })
})
