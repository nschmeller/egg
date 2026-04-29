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

        <!-- Vertical timeline -->
        <div
          ref="containerRef"
          class="overflow-hidden select-none"
          :class="{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }"
          @mousedown="onDragStart"
          @mousemove="(e: MouseEvent) => onDragMove(e, containerRef)"
          @mouseup="onDragEnd"
          @mouseleave="onDragEnd"
        >
          <div class="space-y-4 overflow-y-auto" style="height: 400px">
            <div
              v-for="bucket in reversedBuckets"
              :key="bucket.key"
            >
              <div class="text-xs font-medium text-gray-500 mb-1.5">{{ bucket.tooltip }}</div>
              <div
                v-if="bucket.totalSlots === 0"
                class="text-xs text-gray-300 pl-1"
              >
                No targeted missions
              </div>
              <div v-else class="space-y-1">
                <div
                  v-for="entry in bucket.targets.filter(t => t.slots > 0)"
                  :key="entry.id"
                  class="flex items-center gap-1.5"
                >
                  <div class="flex-1 h-7 bg-gray-50 rounded overflow-hidden">
                    <div
                      v-tippy="{ content: `${entry.name}: ${formatSlots(entry.slots)} slots` }"
                      class="h-full rounded flex items-center px-1 gap-1"
                      :style="{
                        width: (bucket.maxSlots > 0 ? entry.slots / bucket.maxSlots * 100 : 0) + '%',
                        backgroundColor: '#e2e8f0',
                      }"
                    >
                      <img
                        :src="entry.icon"
                        :alt="entry.name"
                        class="w-5 h-5 flex-shrink-0"
                      />
                      <span class="text-xs text-gray-600 tabular-nums truncate">
                        {{ formatSlots(entry.slots) }}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
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
import type { BucketWithTargets } from '@/composables/useSensorTargetData';

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

    // Measure how many buckets fit in the fixed-height container
    // Timeline has ~60px per bucket (header + a few target rows)
    const CONTAINER_HEIGHT = 400;
    const MIN_BUCKET_HEIGHT = 60;
    const maxColumns = ref(Math.floor(CONTAINER_HEIGHT / MIN_BUCKET_HEIGHT));
    let resizeObserver: ResizeObserver | null = null;

    const updateMaxColumns = () => {
      maxColumns.value = Math.max(3, Math.floor(CONTAINER_HEIGHT / MIN_BUCKET_HEIGHT));
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
      sortByFrequency,
      bucketsWithTargets,
      rangeLabel,
      resetZoom,
      isDragging,
      onWheel,
      onDragStart,
      onDragMove,
      onDragEnd,
    } = useSensorTargetData(toRef(props, 'artifactsDB'), { maxColumns, dragAxis: 'vertical' });

    // Reversed for most-recent-first
    const reversedBuckets = computed(() => [...bucketsWithTargets.value].reverse());

    return {
      cardRef,
      containerRef,
      allDays,
      sortByFrequency,
      reversedBuckets,
      rangeLabel,
      resetZoom,
      isDragging,
      onWheel,
      onDragStart,
      onDragMove,
      onDragEnd,
      formatSlots,
    };
  },
});
</script>
