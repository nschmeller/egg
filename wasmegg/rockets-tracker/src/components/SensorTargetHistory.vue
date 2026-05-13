<template>
  <div ref="cardRef" class="mx-4 xl:mx-0" @wheel="handleWheel">
    <div v-if="allDays.length === 0" class="text-center text-xs text-gray-500">
      No sensor target data available.
    </div>
    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div class="text-xs text-gray-400">
          {{ rangeLabel }}
          <span class="text-gray-300 ml-1">&mdash; pinch or click to zoom, drag to pan</span>
        </div>
        <span
          v-if="rangeLabel !== 'Showing all time'"
          class="text-xs text-gray-300 hover:text-gray-400 cursor-pointer select-none"
          @click="resetZoom(cardRef)"
        >
          reset
        </span>
      </div>

      <div
        ref="containerRef"
        class="overflow-hidden select-none flex flex-col gap-0.5"
        :class="{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }"
        style="height: 400px"
        @mousedown="handleDragStart"
        @mousemove="handleDragMove"
        @mouseup="onDragEnd"
        @mouseleave="onDragEnd"
      >
        <div
          v-for="bucket in bucketsWithTargets"
          :key="bucket.key"
          class="flex items-center gap-2 min-h-0 flex-1 cursor-pointer hover:bg-gray-50 rounded transition-colors"
          @click="handleBucketClick(bucket)"
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
</template>

<script lang="ts">
import { computed, defineComponent, PropType, ref, toRefs } from 'vue';

import { ei } from 'lib';
import { useSensorTargetData } from '@/composables/useSensorTargetData';
import { formatSlots } from '@/utils';
import type { BucketWithTargets, BucketTargetData } from '@/composables/useSensorTargetData';

import Name = ei.ArtifactSpec.Name;

// Distinct pastels so artifact icons stand out against the background
const SEGMENT_COLORS = [
  '#bfdbfe', '#fecaca', '#bbf7d0', '#fde68a',
  '#ddd6fe', '#fbcfe8', '#a5f3fc', '#fed7aa',
  '#c7d2fe', '#d9f99d', '#fecdd3', '#99f6e4',
  '#e9d5ff', '#fef08a', '#e2e8f0', '#d6d3d1',
];

export default defineComponent({
  props: {
    artifactsDB: {
      type: Object as PropType<ei.IArtifactsDB>,
      required: true,
    },
  },
  setup(props) {
    const { artifactsDB } = toRefs(props);
    const cardRef = ref<HTMLElement | null>(null);
    const containerRef = ref<HTMLElement | null>(null);
    const maxColumns = ref(Math.max(3, Math.floor(400 / 18)));

    const {
      allDays,
      sortedTargets,
      bucketsWithTargets,
      rangeLabel,
      resetZoom,
      zoomToBucket,
      isDragging,
      onWheel,
      onDragStart,
      onDragMove,
      onDragEnd,
    } = useSensorTargetData(artifactsDB, { maxColumns, dragAxis: 'vertical' });

    const handleWheel = (e: WheelEvent) => onWheel(e, cardRef.value);

    // Distinguish click from drag: track whether mouse moved during interaction
    let dragMoved = false;

    const handleDragStart = (e: MouseEvent) => {
      dragMoved = false;
      onDragStart(e);
    };

    const handleDragMove = (e: MouseEvent) => {
      if (isDragging.value) dragMoved = true;
      onDragMove(e, containerRef.value);
    };

    const handleBucketClick = (bucket: BucketWithTargets) => {
      if (!dragMoved) zoomToBucket(bucket);
    };

    // Stable color index per artifact so colors are consistent across all bars
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
      isDragging,
      handleWheel,
      handleDragStart,
      handleDragMove,
      onDragEnd,
      handleBucketClick,
      orderedSegments,
      formatSlots,
      SEGMENT_COLORS,
    };
  },
});
</script>
