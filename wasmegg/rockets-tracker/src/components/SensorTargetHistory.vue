<template>
  <div class="mx-4 xl:mx-0" @wheel="handleWheel">
    <div v-if="allDays.length === 0" class="text-center text-xs text-gray-500">No sensor target data available.</div>
    <template v-else>
      <div class="text-center text-sm font-medium text-gray-900 mb-1 tabular-nums">
        {{ rangeLabel }}
      </div>
      <div
        class="w-max max-w-full px-3 py-1.5 text-center text-xs text-green-800 bg-green-50 rounded-md shadow-sm mx-auto mb-3"
      >
        Pinch or Ctrl-scroll to zoom &middot; click a period to drill in &middot; drag to pan
        <template v-if="isZoomed">
          &middot;
          <span class="underline cursor-pointer hover:text-green-900 select-none" @click="resetZoom()">reset</span>
        </template>
      </div>

      <div
        ref="containerRef"
        class="relative overflow-hidden select-none"
        :class="[{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }, { 'sth-animate': !isDragging }]"
        :style="{ height: chartHeight + 'px' }"
        @mousedown="handleDragStart"
        @mousemove="handleDragMove"
        @mouseup="onDragEnd"
        @mouseleave="onDragEnd"
      >
        <div
          v-for="(bucket, i) in bucketsWithTargets"
          :key="bucket.key"
          class="sth-row absolute inset-x-0 flex items-center gap-2 cursor-pointer"
          :style="rowStyle(i, bucketsWithTargets.length)"
          @click="handleBucketClick(bucket)"
        >
          <span class="text-xs text-gray-500 font-medium w-14 flex-shrink-0 text-right tabular-nums">
            {{ bucket.label }}
          </span>
          <div class="flex-1 flex h-full rounded overflow-hidden bg-gray-50 hover:bg-gray-100 transition-colors">
            <div
              v-for="seg in orderedSegments(bucket)"
              :key="seg.id"
              v-tippy="{ content: `${seg.name}: ${formatSlots(seg.slots)} slots` }"
              class="sth-seg h-full flex items-center justify-start pl-0.5 overflow-hidden"
              :style="{
                width: (bucket.totalSlots > 0 ? (seg.slots / bucket.totalSlots) * 100 : 0) + '%',
                backgroundColor: SEGMENT_COLORS[seg.colorIdx % SEGMENT_COLORS.length],
              }"
            >
              <img
                v-if="seg.slots / bucket.totalSlots > 0.05"
                :src="seg.icon"
                :alt="seg.name"
                class="h-full max-h-6 w-auto flex-shrink-0"
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

// Chart geometry. CHART_HEIGHT_PX drives both the rendered track height and the
// row-count estimate, so the two can never drift apart.
const CHART_HEIGHT_PX = 400;
const APPROX_ROW_HEIGHT_PX = 18;
const ROW_GAP_PX = 3;

// Distinct pastels so artifact icons stand out against the background.
const SEGMENT_COLORS = [
  '#bfdbfe',
  '#fecaca',
  '#bbf7d0',
  '#fde68a',
  '#ddd6fe',
  '#fbcfe8',
  '#a5f3fc',
  '#fed7aa',
  '#c7d2fe',
  '#d9f99d',
  '#fecdd3',
  '#99f6e4',
  '#e9d5ff',
  '#fef08a',
  '#e2e8f0',
  '#d6d3d1',
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
    const containerRef = ref<HTMLElement | null>(null);
    const maxColumns = ref(Math.max(3, Math.floor(CHART_HEIGHT_PX / APPROX_ROW_HEIGHT_PX)));

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
    } = useSensorTargetData(artifactsDB, { maxColumns });

    const isZoomed = computed(() => rangeLabel.value !== 'Showing all time');

    // Anchor zoom against the track (containerRef), not the outer card, so the
    // row under the cursor stays put — the card includes the title/hint header.
    const handleWheel = (e: WheelEvent) => onWheel(e, containerRef.value);

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

    // Absolutely position each row by its fractional slot in the track so that
    // adding/removing rows (granularity changes) and re-proportioning animate
    // via CSS transitions instead of snapping.
    const rowStyle = (i: number, n: number) => ({
      top: (i / n) * 100 + '%',
      height: (1 / n) * 100 + '%',
      paddingBottom: ROW_GAP_PX + 'px',
    });

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
      containerRef,
      chartHeight: CHART_HEIGHT_PX,
      allDays,
      bucketsWithTargets,
      rangeLabel,
      isZoomed,
      resetZoom,
      isDragging,
      handleWheel,
      handleDragStart,
      handleDragMove,
      onDragEnd,
      handleBucketClick,
      orderedSegments,
      rowStyle,
      formatSlots,
      SEGMENT_COLORS,
    };
  },
});
</script>

<style scoped>
/*
 * Transitions are enabled only when not actively dragging: discrete changes
 * (zoom, click-to-zoom, reset, granularity switches) ease smoothly, while
 * drag-to-pan tracks the pointer 1:1 with no lag.
 */
.sth-animate .sth-row {
  transition:
    top 160ms cubic-bezier(0.4, 0, 0.2, 1),
    height 160ms cubic-bezier(0.4, 0, 0.2, 1);
}
.sth-animate .sth-seg {
  transition: width 160ms cubic-bezier(0.4, 0, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  .sth-animate .sth-row,
  .sth-animate .sth-seg {
    transition: none;
  }
}
</style>
