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

        <!-- Carousel -->
        <div
          ref="containerRef"
          class="overflow-hidden select-none"
          :class="{ 'cursor-grab': !isDragging, 'cursor-grabbing': isDragging }"
          @mousedown="onDragStart"
          @mousemove="(e: MouseEvent) => onDragMove(e, containerRef)"
          @mouseup="onDragEnd"
          @mouseleave="onDragEnd"
        >
          <div class="relative">
            <!-- Left arrow -->
            <button
              v-if="canScrollLeft"
              class="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 bg-white shadow rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600"
              @click="scrollLeftFn"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <!-- Right arrow -->
            <button
              v-if="canScrollRight"
              class="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-7 h-7 bg-white shadow rounded-full flex items-center justify-center text-gray-400 hover:text-gray-600"
              @click="scrollRightFn"
            >
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            <!-- Scrollable container -->
            <div
              ref="scrollContainer"
              class="flex gap-3 overflow-x-auto pb-2 px-1"
              style="scroll-snap-type: x mandatory; -webkit-overflow-scrolling: touch"
              @scroll="onScroll"
            >
              <div
                v-for="card in cards"
                :key="card.id"
                class="flex-shrink-0 bg-gray-50 rounded-lg p-3 border border-gray-100"
                style="width: 200px; scroll-snap-align: start"
              >
                <!-- Icon + name -->
                <div class="flex items-center gap-2 mb-2">
                  <img :src="card.icon" :alt="card.name" class="w-12 h-12" />
                  <div>
                    <div class="text-sm font-medium text-gray-700 leading-tight">{{ card.name }}</div>
                    <div class="text-xs text-gray-400">{{ formatSlots(card.total) }} slots</div>
                  </div>
                </div>
                <!-- Sparkline bar chart -->
                <div class="flex items-end gap-px" style="height: 60px">
                  <div
                    v-for="bar in card.bars"
                    :key="bar.key"
                    class="flex-1 rounded-t-sm"
                    :style="{
                      height: bar.height + 'px',
                      backgroundColor: card.color,
                      minWidth: '4px',
                    }"
                    :title="bar.label + ': ' + formatSlots(bar.slots) + ' slots'"
                  />
                </div>
                <!-- Bucket labels -->
                <div class="flex gap-px mt-0.5">
                  <div
                    v-for="bar in card.bars"
                    :key="bar.key"
                    class="flex-1 text-center text-gray-400 overflow-hidden whitespace-nowrap"
                    style="font-size: 8px; min-width: 4px"
                  >
                    {{ card.bars.length <= 8 ? bar.shortLabel : '' }}
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
import { computed, defineComponent, onMounted, onUnmounted, PropType, ref, toRef, nextTick } from 'vue';
import { ei } from 'lib';
import { useSensorTargetData, formatSlots, ARTIFACT_COLORS, FALLBACK_COLOR } from '@/composables/useSensorTargetData';
import type { Bucket } from '@/composables/useSensorTargetData';

import Name = ei.ArtifactSpec.Name;

const MAX_BAR_HEIGHT = 60;

interface Bar {
  key: string;
  label: string;
  shortLabel: string;
  slots: number;
  height: number;
}

interface Card {
  id: Name;
  name: string;
  icon: string;
  color: string;
  total: number;
  bars: Bar[];
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
    const scrollContainer = ref<HTMLElement | null>(null);
    const canScrollLeft = ref(false);
    const canScrollRight = ref(false);

    // Measure available width and compute max columns
    const MIN_CELL_WIDTH = 48;
    const maxColumns = ref(20);
    let resizeObserver: ResizeObserver | null = null;

    const updateMaxColumns = () => {
      const el = cardRef.value;
      if (!el) return;
      const available = el.clientWidth - 32; // subtract card padding (p-4 = 16px × 2)
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

    // Build cards sorted by total descending
    const cards = computed<Card[]>(() => {
      const bkts = buckets.value;
      const targets = [...sortedTargets.value].sort((a, b) => b.slots - a.slots);

      return targets.map(({ id, slots: total }) => {
        const info = targetInfo(id);

        // Per-bucket slots for sparkline
        const bucketSlots = bkts.map(bucket => slotsForTarget(bucket, id));
        let maxQ = 0;
        for (const s of bucketSlots) {
          if (s > maxQ) maxQ = s;
        }

        const bars: Bar[] = bkts.map((bucket, i) => {
          const slots = bucketSlots[i];
          return {
            key: bucket.key,
            label: bucket.tooltip,
            shortLabel: bucket.label,
            slots,
            height: maxQ > 0 ? Math.max(slots > 0 ? 2 : 0, (slots / maxQ) * MAX_BAR_HEIGHT) : 0,
          };
        });

        return {
          id,
          name: info.name,
          icon: info.icon,
          color: info.color,
          total,
          bars,
        };
      });
    });

    const onScroll = () => {
      const el = scrollContainer.value;
      if (!el) return;
      canScrollLeft.value = el.scrollLeft > 0;
      canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    };

    const scrollLeftFn = () => {
      const el = scrollContainer.value;
      if (!el) return;
      el.scrollBy({ left: -216, behavior: 'smooth' });
    };

    const scrollRightFn = () => {
      const el = scrollContainer.value;
      if (!el) return;
      el.scrollBy({ left: 216, behavior: 'smooth' });
    };

    onMounted(() => {
      nextTick(() => onScroll());
    });

    return {
      cardRef,
      containerRef,
      scrollContainer,
      allDays,
      sortByFrequency,
      rangeLabel,
      resetZoom,
      isDragging,
      onWheel,
      onDragStart,
      onDragMove,
      onDragEnd,
      cards,
      canScrollLeft,
      canScrollRight,
      onScroll,
      scrollLeftFn,
      scrollRightFn,
      formatSlots,
    };
  },
});
</script>
