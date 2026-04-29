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
          <span
            v-if="rangeLabel !== 'Showing all time'"
            class="text-xs text-gray-300 hover:text-gray-400 cursor-pointer select-none"
            @click="resetZoom(cardRef)"
          >
            reset
          </span>
        </div>

        <!-- Stacked stream bars -->
        <div
          ref="containerRef"
          class="overflow-hidden select-none flex flex-col gap-0.5"
          :class="{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }"
          style="height: 400px"
          @mousedown="wrappedDragStart"
          @mousemove="wrappedDragMove"
          @mouseup="onDragEnd"
          @mouseleave="onDragEnd"
        >
            <div
              v-for="bucket in bucketsWithTargets"
              :key="bucket.key"
              class="flex items-center gap-2 min-h-0 flex-1 cursor-pointer hover:bg-gray-50 rounded transition-colors"
              @click="!dragMoved && zoomToBucket(bucket)"
            >
              <span class="text-xs text-gray-500 font-medium w-14 flex-shrink-0 text-right tabular-nums">
                {{ bucket.label }}
              </span>
              <div class="flex-1 flex h-full rounded overflow-hidden bg-gray-50">
                <div
                  v-for="seg in orderedSegments(bucket)"
                  :key="seg.id"
                  v-tippy="{ content: `${seg.name}: ${formatSlots(seg.slots)} slots` }"
                  class="h-full flex items-center justify-start pl-0.5 overflow-hidden"
                  :style="{
                    width: (bucket.totalSlots > 0 ? seg.slots / bucket.totalSlots * 100 : 0) + '%',
                    backgroundColor: SEGMENT_COLORS[seg.colorIdx % SEGMENT_COLORS.length],
                  }"
                >
                  <img
                    v-if="seg.slots / bucket.totalSlots > 0.05"
                    :src="seg.icon"
                    :alt="seg.name"
                    class="w-6 h-6 flex-shrink-0"
                  />
                </div>
              </div>
              <span class="text-xs text-gray-400 tabular-nums w-10 text-right flex-shrink-0">
                {{ formatSlots(bucket.totalSlots) }}
              </span>
            </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script lang="ts">
import { computed, defineComponent, onMounted, onUnmounted, PropType, ref, toRef } from 'vue';
import { ei } from 'lib';
import { useSensorTargetData, formatSlots } from '@/composables/useSensorTargetData';
import type { BucketWithTargets, BucketTargetData } from '@/composables/useSensorTargetData';

import Name = ei.ArtifactSpec.Name;

// Distinct pastels — each visually different so segments are distinguishable
const SEGMENT_COLORS = [
  '#bfdbfe', // blue-200
  '#fecaca', // red-200
  '#bbf7d0', // green-200
  '#fde68a', // amber-200
  '#ddd6fe', // violet-200
  '#fbcfe8', // pink-200
  '#a5f3fc', // cyan-200
  '#fed7aa', // orange-200
  '#c7d2fe', // indigo-200
  '#d9f99d', // lime-200
  '#fecdd3', // rose-200
  '#99f6e4', // teal-200
  '#e9d5ff', // purple-200
  '#fef08a', // yellow-200
  '#e2e8f0', // slate-200
  '#d6d3d1', // stone-300
];

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

    // Measure how many rows fit in the fixed-height container
    const CONTAINER_HEIGHT = 400;
    const MIN_ROW_HEIGHT = 18; // min height per bar row including gap
    const maxColumns = ref(Math.floor(CONTAINER_HEIGHT / MIN_ROW_HEIGHT));
    let resizeObserver: ResizeObserver | null = null;

    const updateMaxColumns = () => {
      // For vertical layout, max buckets = rows that fit in the fixed height
      maxColumns.value = Math.max(3, Math.floor(CONTAINER_HEIGHT / MIN_ROW_HEIGHT));
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
      bucketsWithTargets,
      rangeLabel,
      resetZoom,
      zoomToBucket,
      isDragging,
      onWheel,
      onDragStart,
      onDragMove,
      onDragEnd,
    } = useSensorTargetData(toRef(props, 'artifactsDB'), { maxColumns, dragAxis: 'vertical' });

    // Track mouse movement to distinguish click from drag
    const dragMoved = ref(false);
    const wrappedDragStart = (e: MouseEvent) => {
      dragMoved.value = false;
      onDragStart(e);
    };
    const wrappedDragMove = (e: MouseEvent) => {
      if (isDragging.value) dragMoved.value = true;
      onDragMove(e, containerRef.value);
    };

    // Build a stable index per artifact so colors are consistent across bars
    const artifactColorIndex = computed(() => {
      const map = new Map<Name, number>();
      sortedTargets.value.forEach((t, i) => map.set(t.id, i));
      return map;
    });

    const orderedSegments = (bucket: BucketWithTargets): (BucketTargetData & { colorIdx: number })[] => {
      const idxMap = artifactColorIndex.value;
      const slotMap = new Map<Name, BucketTargetData>();
      for (const t of bucket.targets) {
        slotMap.set(t.id, t);
      }
      return sortedTargets.value
        .filter(t => slotMap.has(t.id))
        .map(t => ({ ...slotMap.get(t.id)!, colorIdx: idxMap.get(t.id) ?? 0 }));
    };

    return {
      cardRef,
      containerRef,
      allDays,
      bucketsWithTargets,
      rangeLabel,
      resetZoom,
      zoomToBucket,
      isDragging,
      dragMoved,
      onWheel,
      wrappedDragStart,
      wrappedDragMove,
      onDragEnd,
      orderedSegments,
      formatSlots,
      SEGMENT_COLORS,
    };
  },
});
</script>
