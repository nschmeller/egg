<template>
  <div class="mx-4 xl:mx-0">
    <div ref="cardRef" class="bg-white rounded-lg shadow p-4" @wheel="(e: WheelEvent) => onWheel(e, cardRef)">
      <div v-if="allDays.length === 0" class="text-center text-xs text-gray-500">
        No sensor target data available.
      </div>
      <template v-else>
        <!-- Header bar -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div class="text-xs text-gray-400">
            {{ rangeLabel }}
            <span class="text-gray-300 ml-1">&mdash; pinch to zoom, drag to pan</span>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="text-xs cursor-pointer select-none"
              :class="sortByFrequency ? 'text-gray-600 underline' : 'text-gray-300 hover:text-gray-400'"
              @click="sortByFrequency = !sortByFrequency"
            >
              {{ sortByFrequency ? 'sorted by frequency' : 'sort by frequency' }}
            </span>
            <span
              v-if="rangeLabel !== 'Showing all time'"
              class="text-xs text-gray-300 hover:text-gray-400 cursor-pointer select-none"
              @click="resetZoom(cardRef)"
            >
              reset
            </span>
          </div>
        </div>

        <!-- Calendar heatmap -->
        <div
          ref="containerRef"
          class="overflow-hidden select-none"
          :class="{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }"
          @mousedown="onDragStart"
          @mousemove="(e: MouseEvent) => onDragMove(e, containerRef)"
          @mouseup="onDragEnd"
          @mouseleave="onDragEnd"
        >
          <div class="overflow-x-auto">
            <!-- Month labels -->
            <div class="flex ml-8" style="margin-bottom: 2px">
              <div
                v-for="ml in monthLabels"
                :key="ml.key"
                class="text-xs text-gray-400"
                :style="{ width: ml.width + 'px', minWidth: ml.width + 'px' }"
              >
                {{ ml.label }}
              </div>
            </div>
            <!-- Grid -->
            <div class="flex">
              <!-- Day-of-week labels -->
              <div class="flex flex-col flex-shrink-0" style="width: 28px">
                <div v-for="(label, i) in dayLabels" :key="i" class="text-xs text-gray-400 text-right pr-1" style="height: 14px; line-height: 14px">
                  {{ label }}
                </div>
              </div>
              <!-- Weeks -->
              <div class="flex gap-px">
                <div v-for="(week, wi) in weeks" :key="wi" class="flex flex-col gap-px">
                  <div
                    v-for="(cell, di) in week"
                    :key="di"
                    class="rounded-sm"
                    style="width: 12px; height: 12px"
                    :style="{ backgroundColor: cell ? cellColor(cell.slots) : 'transparent' }"
                    :title="cell ? cell.day + ': ' + formatSlots(cell.slots) + ' slots' : ''"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Color legend -->
        <div class="flex items-center gap-1 mt-2 text-xs text-gray-400">
          <span>Less</span>
          <div class="w-3 h-3 rounded-sm" style="background-color: #f3f4f6" />
          <div class="w-3 h-3 rounded-sm" style="background-color: hsl(142, 40%, 85%)" />
          <div class="w-3 h-3 rounded-sm" style="background-color: hsl(142, 50%, 68%)" />
          <div class="w-3 h-3 rounded-sm" style="background-color: hsl(142, 60%, 52%)" />
          <div class="w-3 h-3 rounded-sm" style="background-color: hsl(142, 70%, 35%)" />
          <span>More</span>
        </div>

        <!-- Most targeted summary -->
        <div v-if="topTarget" class="mt-3 pt-3 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
          <span>Most targeted:</span>
          <img :src="topTarget.icon" :alt="topTarget.name" class="w-6 h-6" />
          <span class="font-medium">{{ topTarget.name }}</span>
          <span class="text-gray-400">({{ formatSlots(topTarget.total) }} slots)</span>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, PropType, ref, toRef } from 'vue';
import dayjs from 'dayjs';
import { ei } from 'lib';
import { useSensorTargetData, formatSlots, ARTIFACT_COLORS, FALLBACK_COLOR } from '@/composables/useSensorTargetData';
import type { Bucket } from '@/composables/useSensorTargetData';

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface DayCell {
  day: string;
  slots: number;
}

interface MonthLabel {
  key: string;
  label: string;
  width: number;
}

export default defineComponent({
  props: {
    artifactsDB: {
      type: Object as PropType<ei.IArtifactsDB>,
      required: true,
    },
  },
  setup(props) {
    const cardRef = ref<HTMLElement | null>(null);
    const containerRef = ref<HTMLElement | null>(null);

    // Measure available width and compute max columns
    const MIN_CELL_WIDTH = 16;
    const maxColumns = ref(20);
    let resizeObserver: ResizeObserver | null = null;

    const updateMaxColumns = () => {
      const el = cardRef.value;
      if (!el) return;
      const available = el.clientWidth - 32 - 30; // subtract card padding + day-of-week labels
      maxColumns.value = Math.max(3, Math.floor(available / MIN_CELL_WIDTH));
    };

    onMounted(() => {
      updateMaxColumns();
      if (cardRef.value) {
        resizeObserver = new ResizeObserver(updateMaxColumns);
        resizeObserver.observe(cardRef.value);
      }
    });

    onUnmounted(() => {
      resizeObserver?.disconnect();
    });

    const {
      allDays,
      fullData,
      sortedTargets,
      sortByFrequency,
      visibleDays,
      rangeLabel,
      resetZoom,
      isDragging,
      onWheel,
      onDragStart,
      onDragMove,
      onDragEnd,
      targetInfo,
    } = useSensorTargetData(toRef(props, 'artifactsDB'), { maxColumns });

    // Build daily slot totals from visible days
    const calendarData = computed(() => {
      const { dayMap } = fullData.value;
      const days = visibleDays.value;

      // Sum all target slots per day
      const daySlots = new Map<string, number>();
      for (const day of days) {
        const targets = dayMap.get(day);
        if (targets) {
          let total = 0;
          for (const slots of targets.values()) {
            total += slots;
          }
          daySlots.set(day, total);
        }
      }

      if (days.length === 0) {
        return { weeks: [] as (DayCell | null)[][], maxSlots: 0, monthLabels: [] as MonthLabel[] };
      }

      const firstDay = dayjs(days[0]);
      const lastDay = dayjs(days[days.length - 1]);
      const startSunday = firstDay.day(0);

      const weeks: (DayCell | null)[][] = [];
      let cursor = startSunday;
      let currentWeek: (DayCell | null)[] = [];

      while (!cursor.isAfter(lastDay)) {
        const dayStr = cursor.format('YYYY-MM-DD');
        const slots = daySlots.get(dayStr) || 0;
        currentWeek.push({ day: dayStr, slots });

        if (currentWeek.length === 7) {
          weeks.push(currentWeek);
          currentWeek = [];
        }
        cursor = cursor.add(1, 'day');
      }
      if (currentWeek.length > 0) {
        while (currentWeek.length < 7) {
          currentWeek.push(null);
        }
        weeks.push(currentWeek);
      }

      let maxSlots = 0;
      for (const slots of daySlots.values()) {
        if (slots > maxSlots) maxSlots = slots;
      }

      // Month labels
      const monthLabels: MonthLabel[] = [];
      let currentMonth = '';
      let monthStartWeek = 0;
      for (let wi = 0; wi < weeks.length; wi++) {
        const firstCell = weeks[wi][0];
        if (!firstCell) continue;
        const m = firstCell.day.slice(0, 7);
        if (m !== currentMonth) {
          if (currentMonth !== '') {
            monthLabels.push({
              key: currentMonth,
              label: MONTH_NAMES_SHORT[parseInt(currentMonth.slice(5, 7)) - 1],
              width: (wi - monthStartWeek) * 13,
            });
          }
          currentMonth = m;
          monthStartWeek = wi;
        }
      }
      if (currentMonth !== '') {
        monthLabels.push({
          key: currentMonth,
          label: MONTH_NAMES_SHORT[parseInt(currentMonth.slice(5, 7)) - 1],
          width: (weeks.length - monthStartWeek) * 13,
        });
      }

      return { weeks, maxSlots, monthLabels };
    });

    const weeks = computed(() => calendarData.value.weeks);
    const monthLabels = computed(() => calendarData.value.monthLabels);

    const dayLabels = ['', 'Mon', '', 'Wed', '', 'Fri', ''];

    const cellColor = (slots: number): string => {
      if (slots === 0) return '#f3f4f6';
      const max = calendarData.value.maxSlots;
      if (max <= 0) return '#f3f4f6';
      const intensity = Math.min(slots / max, 1);
      const saturation = 40 + intensity * 30;
      const lightness = 90 - intensity * 55;
      return `hsl(142, ${saturation}%, ${lightness}%)`;
    };

    // Top target from sorted targets
    const topTarget = computed(() => {
      const targets = sortedTargets.value;
      if (targets.length === 0) return null;
      // The target with the most total slots
      const top = [...targets].sort((a, b) => b.slots - a.slots)[0];
      const info = targetInfo(top.id);
      return { name: info.name, icon: info.icon, total: top.slots };
    });

    return {
      cardRef,
      containerRef,
      allDays,
      sortByFrequency,
      rangeLabel,
      resetZoom,
      isDragging,
      onWheel,
      onDragStart,
      onDragMove,
      onDragEnd,
      weeks,
      monthLabels,
      dayLabels,
      cellColor,
      topTarget,
      formatSlots,
    };
  },
});
</script>
