<template>
  <div class="player">
    <NDropdown
      trigger="click"
      :options="positionOptions"
      @select="(key) => emits('positionChange', String(key))"
    >
      <NButton
        text
        size="tiny"
        class="position-label"
        :title="t('cdTimer.window.positionHelp')"
        :aria-label="label"
      >
        {{ label.slice(0, 1).toUpperCase() }}
      </NButton>
    </NDropdown>
    <NIcon class="arrow-icon">
      <ChevronRight16FilledIcon />
    </NIcon>
    <div
      class="summoner-spell"
      role="button"
      tabindex="0"
      :aria-label="`${label} d`"
      @keydown.enter.prevent="$emit('spell1Click', spell1Id, timerType)"
      @keydown.space.prevent="$emit('spell1Click', spell1Id, timerType)"
      @pointerdown.left.prevent="captureSpellPointer"
      @pointerup.left.prevent="$emit('spell1Click', spell1Id, timerType)"
      @wheel.prevent="($event) => $emit('spell1Wheel', spell1Id, $event.deltaY)"
      ref="spell1"
      data-timer-slot="d"
    >
      <span class="slot-label">d</span>
      <NIcon class="timer-icon timer" v-if="!spell1Id">
        <Timer16FilledIcon />
      </NIcon>
      <SummonerSpellDisplay v-else :size="32" :spell-id="spell1Id" disable-popover />
      <div
        class="mask"
        :class="{ timeout: spell1FormattedTimeText === 'OK' }"
        v-if="spell1BaseTimestamp !== null"
      >
        {{ spell1FormattedTimeText }}
      </div>
      <div class="click-indicator" :class="{ highlight: spell1Pressed }"></div>
    </div>
    <div class="spacer"></div>
    <div
      class="summoner-spell"
      role="button"
      tabindex="0"
      :aria-label="`${label} f`"
      @keydown.enter.prevent="$emit('spell2Click', spell2Id, timerType)"
      @keydown.space.prevent="$emit('spell2Click', spell2Id, timerType)"
      @pointerdown.left.prevent="captureSpellPointer"
      @pointerup.left.prevent="$emit('spell2Click', spell2Id, timerType)"
      @wheel.prevent="($event) => $emit('spell2Wheel', spell2Id, $event.deltaY)"
      ref="spell2"
      data-timer-slot="f"
    >
      <span class="slot-label">f</span>
      <NIcon class="timer-icon timer" v-if="!spell2Id">
        <Timer16FilledIcon />
      </NIcon>
      <SummonerSpellDisplay v-else :size="32" :spell-id="spell2Id" disable-popover />
      <div
        class="mask"
        :class="{ timeout: spell2FormattedTimeText === 'OK' }"
        v-if="spell2BaseTimestamp !== null"
      >
        {{ spell2FormattedTimeText }}
      </div>
      <div class="click-indicator" :class="{ highlight: spell2Pressed }"></div>
    </div>
    <template v-if="ultimateEnabled">
      <div class="spacer"></div>
      <div
        class="summoner-spell ultimate-spell"
        role="button"
        tabindex="0"
        :aria-label="`${label} r`"
        :title="t('cdTimer.window.ultimateHelp')"
        @keydown.enter.prevent="activateUltimate"
        @keydown.space.prevent="activateUltimate"
        @pointerdown.left.prevent="captureSpellPointer"
        @pointerup.left.prevent="activateUltimate"
        @wheel.prevent="emits('ultimateWheel', $event.deltaY)"
        ref="ultimate"
        data-timer-slot="r"
      >
        <span class="slot-label">r</span>
        <div class="ultimate-face">R</div>
        <div
          v-if="ultimateBaseTimestamp !== null"
          class="mask"
          :class="{ timeout: ultimateFormattedTimeText === 'OK' }"
        >
          {{ ultimateFormattedTimeText }}
        </div>
        <div class="click-indicator" :class="{ highlight: ultimatePressed }"></div>
      </div>
      <NDropdown
        trigger="click"
        :show="showUltimateSettings"
        :animated="false"
        :options="ultimateOptions"
        :scrollable="true"
        :style="{ maxHeight: '240px' }"
        @update:show="showUltimateSettings = $event"
        @select="selectUltimateCooldown"
      >
        <NButton
          text
          size="tiny"
          class="ultimate-setting"
          :aria-label="`${label} ${t('cdTimer.window.ultimateCooldown')}`"
          :title="
            ultimateEstimateRank
              ? t('cdTimer.window.ultimateEstimate', { rank: ultimateEstimateRank })
              : t('cdTimer.window.ultimateSettingHelp')
          "
          >{{
            ultimateCooldown === null
              ? t('cdTimer.window.ultimateSet')
              : `${ultimateEstimateRank ? '≈' : ''}${Number(ultimateCooldown.toFixed(1))}s`
          }}</NButton
        >
      </NDropdown>
    </template>
  </div>
</template>

<script setup lang="ts">
import { POSITIONS } from '@shared/cd-timer'
import { useTranslation } from 'i18next-vue'
import SummonerSpellDisplay from '@renderer-shared/components/widgets/SummonerSpellDisplay.vue'
import { ChevronRight16Filled as ChevronRight16FilledIcon } from '@vicons/fluent'
import { Timer16Filled as Timer16FilledIcon } from '@vicons/fluent'
import { useIntervalFn, useMousePressed } from '@vueuse/core'
import { NIcon, NButton, NDropdown } from 'naive-ui'
import { computed, ref, useTemplateRef, watch } from 'vue'

const emits = defineEmits<{
  ultimateAuto: []
  ultimateClick: []
  ultimateWheel: [deltaY: number]
  ultimateCooldownChange: [seconds: number]
  positionChange: [position: string]
  spell1Click: [spellId: number, type: 'countdown' | 'countup']
  spell2Click: [spellId: number, type: 'countdown' | 'countup']
  spell1Wheel: [spellId: number, deltaY: number]
  spell2Wheel: [spellId: number, deltaY: number]
}>()

// The overlay does not take focus from the game. Handle pointer release directly:
// native mouse input can arrive without Chromium producing a synthetic click.
// Capture keeps release on the pressed spell even if the cursor moves slightly.
const captureSpellPointer = (event: PointerEvent) => {
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const { t } = useTranslation()
const showUltimateSettings = ref(false)
const ultimateOptions = computed(() => [
  { label: t('cdTimer.window.ultimateAuto'), key: 'auto' },
  ...ultimateRanks
    .filter((value) => value.seconds !== null)
    .map((value) => ({
      label: `R${value.rank} · ${value.seconds}s`,
      key: `rank:${value.rank}`
    })),
  ...[30, 45, 60, 75, 90, 100, 110, 120, 130, 140, 150, 160, 180, 200, 240, 300]
    .filter((seconds) => !ultimateRanks.some((rank) => rank.seconds === seconds))
    .map((seconds) => ({ label: `${seconds}s`, key: seconds }))
])
const selectUltimateCooldown = (key: string | number) => {
  if (key === 'auto') emits('ultimateAuto')
  else {
    const seconds =
      typeof key === 'string' && key.startsWith('rank:')
        ? ultimateRanks.find((value) => value.rank === Number(key.slice(5)))?.seconds
        : Number(key)
    if (seconds && Number.isFinite(seconds)) emits('ultimateCooldownChange', seconds)
  }
  showUltimateSettings.value = false
}
const activateUltimate = () => {
  if (ultimateCooldown === null) showUltimateSettings.value = true
  else emits('ultimateClick')
}

const positionOptions = POSITIONS.map((position) => ({ label: position, key: position }))

const {
  ultimateEnabled = true,
  ultimateEstimateRank = undefined,
  ultimateRanks = [],
  ultimateCooldown = null,
  ultimateBaseTimestamp = null,
  label = '',
  spell1Id = 1,
  spell2Id = 2,
  timerType = 'countup',
  spell1BaseTimestamp = null,
  spell2BaseTimestamp = null
} = defineProps<{
  ultimateEnabled?: boolean
  ultimateEstimateRank?: number
  ultimateRanks?: { rank: number; seconds: number | null }[]
  ultimateCooldown?: number | null
  ultimateBaseTimestamp?: number | null
  label?: string

  spell1Id?: number
  spell2Id?: number

  // 当为倒计时模式时, 此值为目标时间戳
  // 当为秒表模式时, 此值为基准时间戳
  spell1BaseTimestamp?: number | null
  spell2BaseTimestamp?: number | null

  // 秒表模式 or 倒计时模式
  timerType?: 'countdown' | 'countup'
}>()

const ultimateFormattedTimeText = ref('')
const spell1FormattedTimeText = ref('')
const spell2FormattedTimeText = ref('')

const formatTimeToSeconds = (type: 'countdown' | 'countup', timestamp: number): string => {
  const now = Date.now()
  const duration = (type === 'countdown' ? timestamp - now : now - timestamp) / 1000

  if (type === 'countdown' && duration <= 0) return 'OK'
  const seconds = Math.max(0, type === 'countdown' ? Math.ceil(duration) : Math.floor(duration))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

const update = () => {
  if (ultimateBaseTimestamp !== null) {
    ultimateFormattedTimeText.value = formatTimeToSeconds(timerType, ultimateBaseTimestamp)
  }
  if (spell1BaseTimestamp !== null) {
    spell1FormattedTimeText.value = formatTimeToSeconds(timerType, spell1BaseTimestamp)
  }

  if (spell2BaseTimestamp !== null) {
    spell2FormattedTimeText.value = formatTimeToSeconds(timerType, spell2BaseTimestamp)
  }
}

const { pause, resume } = useIntervalFn(update, 100, {
  immediate: true,
  immediateCallback: true
})

watch(
  [() => spell1BaseTimestamp, () => spell2BaseTimestamp, () => ultimateBaseTimestamp],
  ([t1, t2, t3]) => {
    update()
    if (t1 !== null || t2 !== null || t3 !== null) {
      resume()
    } else {
      pause()
    }
  },
  {
    immediate: true
  }
)

const ultimateEl = useTemplateRef('ultimate')
const { pressed: ultimatePressed } = useMousePressed({ target: ultimateEl })
const spell1El = useTemplateRef('spell1')
const spell2El = useTemplateRef('spell2')

const { pressed: spell1Pressed } = useMousePressed({
  target: spell1El
})

const { pressed: spell2Pressed } = useMousePressed({
  target: spell2El
})
</script>

<style scoped>
.player {
  display: flex;
  align-items: center;
  justify-content: center;

  .position-label {
    width: 32px;
    height: 32px;
    border: 2px solid #70d0d9;
    border-radius: 50%;
    background: #242438;
    color: #fff;
    font-size: 16px;
    font-weight: 700;
    position: relative;
  }
  .slot-label {
    display: block;
    text-align: center;
    color: #fff;
    font-size: 11px;
    line-height: 14px;
  }

  .arrow-icon {
    margin: 0 4px;
    color: #fff8;
  }

  .timer-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 32px;
    width: 32px;
    font-size: 24px;
  }

  .timer-icon.timer {
    color: #fff;
  }

  .ultimate-face {
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #35354d;
    color: #e7d3ff;
    font-size: 22px;
    font-weight: 700;
  }
  .ultimate-setting {
    width: 42px;
    margin-left: 4px;
    color: #ddd;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .spacer {
    width: 4px;
  }

  &:not(:last-child) {
    margin-bottom: 4px;
  }

  .summoner-spell {
    -webkit-app-region: no-drag;
    position: relative;
    cursor: pointer;
    transition: all 0.3s;
    border: 1px solid #fff4;
    box-sizing: border-box;
    border-radius: 4px;

    &:focus-visible {
      outline: 2px solid #fc82ea;
      outline-offset: 2px;
    }

    &:hover {
      filter: brightness(0.8);
    }

    .click-indicator {
      pointer-events: none;
      transition:
        background-color 0.3s,
        transform 0.1s;
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      border-radius: 4px;
    }

    .click-indicator.highlight {
      transform: scale(1.15);
      background-color: #fffb;
    }

    .mask {
      pointer-events: none;
      position: absolute;
      top: 14px;
      left: 0;
      width: 100%;
      height: 32px;
      background-color: #000000a0;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-family: sans-serif;
      line-height: 12px;
      font-weight: bold;
      color: #fff;
    }

    .mask.timeout {
      background-color: #560053a0;
    }
  }
}
</style>
