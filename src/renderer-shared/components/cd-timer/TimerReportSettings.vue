<template>
  <NCheckboxGroup
    :value="ctws.settings.reportKinds"
    :title="t('cdTimer.window.reportHelp')"
    @update:value="(values) => wm.cdTimerWindow.setReportKinds(values as TimerReportKind[])"
  >
    <div class="flex flex-wrap gap-x-2 gap-y-1">
      <NCheckbox
        v-for="kind in kinds"
        :key="kind"
        :value="kind"
        :disabled="kind === 'ultimate' && !ctws.settings.ultimateEnabled"
        :aria-disabled="kind === 'ultimate' && !ctws.settings.ultimateEnabled"
        size="small"
      >
        {{ t(`cdTimer.window.reportOptions.${kind}`) }}
      </NCheckbox>
    </div>
  </NCheckboxGroup>
  <div class="mt-1 flex items-center gap-2 text-xs" :title="t('cdTimer.window.ultimateToggleHelp')">
    <NSwitch
      size="small"
      :value="ctws.settings.ultimateEnabled"
      :aria-label="t('cdTimer.window.ultimateEnabled')"
      @update:value="(value) => wm.cdTimerWindow.setUltimateEnabled(value)"
    />
    <span>{{ t('cdTimer.window.ultimateEnabled') }}</span>
  </div>
</template>
<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { WindowManagerRenderer } from '@renderer-shared/shards/window-manager'
import { useCdTimerWindowStore } from '@renderer-shared/shards/window-manager/store'
import type { TimerReportKind } from '@shared/cd-timer'
import { useTranslation } from 'i18next-vue'
import { NCheckbox, NCheckboxGroup, NSwitch } from 'naive-ui'

const kinds: TimerReportKind[] = ['flash', 'summoner', 'ultimate']
const { t } = useTranslation()
const ctws = useCdTimerWindowStore()
const wm = useInstance(WindowManagerRenderer)
</script>
