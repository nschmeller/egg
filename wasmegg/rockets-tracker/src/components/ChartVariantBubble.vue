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

        <!-- Bubble/Dot strip -->
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
            <table class="border-collapse text-xs">
              <!-- Bucket labels header -->
              <thead>
                <tr>
                  <th class="px-1 py-1 w-10" />
                  <th
                    v-for="bucket in buckets"
                    :key="bucket.key"
                    class="px-1 py-1 text-center text-gray-400 font-normal whitespace-nowrap"
                    style="min-width: 36px"
                  >
                    {{ bucket.label }}
                  </th>
                  <th class="px-2 py-1 text-right text-gray-500 font-medium whitespace-nowrap border-l border-gray-100 w-14">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="target in sortedTargets" :key="target.id">
                  <td class="px-1 py-0.5">
                    <img
                      :src="targetInfo(target.id).icon"
                      :alt="targetInfo(target.id).name"
                      :title="targetInfo(target.id).name"
                      class="w-7 h-7"
                    />
                  </td>
                  <td
                    v-for="bucket in buckets"
                    :key="bucket.key"
                    class="px-1 py-0.5 text-center"
                  >
                    <div class="flex items-center justify-center" style="height: 32px">
                      <div
                        v-if="slotsForTarget(bucket, target.id) > 0"
                        class="rounded-full"
                        :style="{
                          width: dotSize(slotsForTarget(bucket, target.id)) + 'px',
                          height: dotSize(slotsForTarget(bucket, target.id)) + 'px',
                          backgroundColor: targetInfo(target.id).color,
                        }"
                        :title="targetInfo(target.id).name + ': ' + formatSlots(slotsForTarget(bucket, target.id)) + ' slots &mdash; ' + bucket.tooltip"
                      />
                    </div>
                  </td>
                  <td class="px-2 py-0.5 text-right text-gray-500 tabular-nums border-l border-gray-100">
                    {{ formatSlots(target.slots) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, PropType, ref, toRef } from 'vue';
import { ei } from 'lib';
import { useSensorTargetData, formatSlots, ARTIFACT_COLORS, FALLBACK_COLOR } from '@/composables/useSensorTargetData';
import type { Bucket } from '@/composables/useSensorTargetData';

const MIN_RADIUS = 2;
const MAX_RADIUS = 14;

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
    const MIN_CELL_WIDTH = 32;
    const maxColumns = ref(20);
    let resizeObserver: ResizeObserver | null = null;

    const updateMaxColumns = () => {
      const el = cardRef.value;
      if (!el) return;
      const available = el.clientWidth - 32 - 40 - 100; // subtract card padding + label col + total col
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

    // Find global max slots across all cells for dot scaling
    const maxSlots = computed(() => {
      let max = 0;
      for (const target of sortedTargets.value) {
        for (const bucket of buckets.value) {
          const slots = slotsForTarget(bucket, target.id);
          if (slots > max) max = slots;
        }
      }
      return max;
    });

    const dotSize = (slots: number): number => {
      const max = maxSlots.value;
      if (max <= 0 || slots <= 0) return 0;
      const ratio = slots / max;
      return MIN_RADIUS * 2 + ratio * (MAX_RADIUS * 2 - MIN_RADIUS * 2);
    };

    return {
      cardRef,
      containerRef,
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
      dotSize,
      formatSlots,
    };
  },
});
</script>
