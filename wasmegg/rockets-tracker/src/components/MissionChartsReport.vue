<template>
  <div class="mx-4 xl:mx-0">
    <div
      ref="cardRef"
      class="bg-white rounded-lg shadow p-4"
      @wheel="(e: WheelEvent) => onWheel(e, cardRef)"
    >
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

        <!-- Heatmap table -->
        <div
          ref="containerRef"
          class="overflow-hidden select-none"
          :class="{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }"
          @mousedown="onDragStart"
          @mousemove="(e: MouseEvent) => onDragMove(e, containerRef)"
          @mouseup="onDragEnd"
          @mouseleave="onDragEnd"
        >
          <table class="border-collapse text-xs w-full" style="table-layout: fixed">
            <colgroup>
              <col class="label-col" />
              <col v-for="bucket in buckets" :key="bucket.key" />
              <col class="total-col" />
            </colgroup>
            <thead>
              <tr>
                <th class="bg-white px-1 py-1 text-left text-gray-500 font-medium" />
                <th
                  v-for="bucket in buckets"
                  :key="bucket.key"
                  class="px-1 py-1 text-center text-gray-400 font-normal whitespace-nowrap overflow-hidden text-ellipsis"
                >
                  {{ bucket.label }}
                </th>
                <th class="bg-white px-2 py-1 text-left text-gray-500 font-medium whitespace-nowrap border-l border-gray-100">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="target in visibleTargets" :key="target.id">
                <td class="bg-white px-1 py-0.5">
                  <img
                    v-tippy="{ content: target.name }"
                    :src="target.icon"
                    :alt="target.name"
                    class="w-7 h-7"
                  />
                </td>
                <td
                  v-for="(value, i) in target.values"
                  :key="buckets[i].key"
                  v-tippy="{ content: `${target.name}: ${formatSlots(value)} slots &mdash; ${buckets[i].tooltip}` }"
                  class="px-1 py-0.5 text-center cursor-default"
                >
                  <div
                    class="rounded-sm w-full h-7 flex items-center justify-center text-xs"
                    :style="cellStyle(value)"
                  >
                    {{ value > 0 ? formatSlots(value) : '' }}
                  </div>
                </td>
                <td class="bg-white px-2 py-0.5 border-l border-gray-100">
                  <div class="flex items-center gap-1.5">
                    <div class="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                      <div
                        v-tippy="{ content: `${target.name}: ${formatSlots(target.total)} slots total` }"
                        class="h-full rounded"
                        :style="{
                          width: barWidth(target.total) + '%',
                          backgroundColor: target.color,
                        }"
                      />
                    </div>
                    <span class="text-xs text-gray-500 tabular-nums w-10 text-right flex-shrink-0">
                      {{ formatSlots(target.total) }}
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- Legend -->
        <div class="flex flex-wrap items-center justify-between gap-2 mt-3">
          <div class="text-xs text-gray-400">
            Slots = artifact drops targeted
          </div>
          <div class="flex items-center gap-1 text-xs text-gray-400">
            <span>Less</span>
            <div class="w-4 h-4 rounded-sm" style="background-color: hsl(142, 40%, 90%)" />
            <div class="w-4 h-4 rounded-sm" style="background-color: hsl(142, 48%, 76%)" />
            <div class="w-4 h-4 rounded-sm" style="background-color: hsl(142, 55%, 63%)" />
            <div class="w-4 h-4 rounded-sm" style="background-color: hsl(142, 63%, 49%)" />
            <div class="w-4 h-4 rounded-sm" style="background-color: hsl(142, 70%, 35%)" />
            <span>More</span>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.label-col {
  width: 40px;
}
.total-col {
  width: 150px;
}
</style>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, PropType, ref, toRef } from 'vue';
import { ei } from 'lib';
import { useSensorTargetData, formatSlots, ARTIFACT_COLORS, FALLBACK_COLOR } from '@/composables/useSensorTargetData';
import type { Bucket } from '@/composables/useSensorTargetData';

import Name = ei.ArtifactSpec.Name;

interface HeatmapTarget {
  id: Name;
  name: string;
  icon: string;
  color: string;
  values: number[];
  total: number;
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
    const LABEL_COL_WIDTH = 40;
    const TOTAL_COL_WIDTH = 150;
    const MIN_CELL_WIDTH = 48;
    const CARD_PADDING = 32; // p-4 = 16px × 2
    const maxColumns = ref(20);
    let resizeObserver: ResizeObserver | null = null;

    const updateMaxColumns = () => {
      const el = cardRef.value;
      if (!el) return;
      const available = el.clientWidth - CARD_PADDING - LABEL_COL_WIDTH - TOTAL_COL_WIDTH;
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
      sortedTargets,
      sortByFrequency,
      buckets,
      rangeLabel,
      resetZoom,
      isDragging,
      onWheel,
      onDragStart,
      onDragMove,
      onDragEnd,
      targetInfo,
      slotsForTarget,
    } = useSensorTargetData(toRef(props, 'artifactsDB'), { maxColumns });

    // Build visible heatmap rows
    const visibleTargets = computed<HeatmapTarget[]>(() => {
      const bkts = buckets.value;
      return sortedTargets.value.map(({ id }) => {
        const info = targetInfo(id);
        const values = bkts.map(bucket => slotsForTarget(bucket, id));
        const total = values.reduce((s, v) => s + v, 0);
        return {
          id,
          name: info.name,
          icon: info.icon,
          color: info.color,
          values,
          total,
        };
      });
    });

    const maxVisibleTotal = computed(() => {
      let max = 0;
      for (const t of visibleTargets.value) {
        if (t.total > max) max = t.total;
      }
      return max || 1;
    });

    const barWidth = (value: number) => {
      return Math.max(1, (value / maxVisibleTotal.value) * 100);
    };

    const maxCellValue = computed(() => {
      let max = 0;
      for (const t of visibleTargets.value) {
        for (const v of t.values) {
          if (v > max) max = v;
        }
      }
      return max;
    });

    const cellStyle = (value: number) => {
      if (value === 0) {
        return { backgroundColor: '#f3f4f6' };
      }
      const max = maxCellValue.value;
      const intensity = max > 0 ? value / max : 0;
      const lightness = 90 - intensity * 55;
      const saturation = 40 + intensity * 30;
      return {
        backgroundColor: `hsl(142, ${saturation}%, ${lightness}%)`,
        color: intensity > 0.6 ? '#fff' : '#1f2937',
      };
    };

    return {
      cardRef,
      containerRef,
      allDays,
      sortByFrequency,
      resetZoom,
      buckets,
      visibleTargets,
      rangeLabel,
      barWidth,
      cellStyle,
      formatSlots,
      onWheel,
      isDragging,
      onDragStart,
      onDragMove,
      onDragEnd,
    };
  },
});
</script>
