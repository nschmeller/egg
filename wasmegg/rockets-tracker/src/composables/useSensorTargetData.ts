import { computed, ref, Ref } from 'vue';
import dayjs from 'dayjs';
import isoWeek from 'dayjs/plugin/isoWeek';

import { ei, Mission, getImageUrlFromId, getTargetName, allPossibleTiers } from 'lib';
import { getLaunchedMissions } from '@/lib';

dayjs.extend(isoWeek);

import Name = ei.ArtifactSpec.Name;
import Type = ei.ArtifactSpec.Type;

// --- Artifact metadata ---

// Sentinel targetArtifact value the game uses for "no specific target".
const UNTARGETED = 10000;

// Sort key and type lookups — maps any item afx_id (including fragments) to its family's data
const afxIdToSortKey = new Map<Name, number>(
  allPossibleTiers.map(t => [t.afx_id, t.family.sort_key])
);
const afxIdToType = new Map<Name, Type>(
  allPossibleTiers.map(t => [t.afx_id, t.family.afx_type])
);

// Group order: artifacts first, then stones, then ingredients
const TYPE_GROUP_ORDER: Record<number, number> = {
  [Type.ARTIFACT]: 0,
  [Type.STONE]: 1,
  [Type.STONE_INGREDIENT]: 1,
  [Type.INGREDIENT]: 2,
};

// --- Types ---

type Granularity = 'day' | '3day' | 'week' | '2week' | 'month' | '2month' | 'quarter' | 'year';

interface TargetEntry {
  id: Name;
  slots: number;
}

interface Bucket {
  key: string;
  label: string;
  tooltip: string;
  days: string[];
}

export interface BucketTargetData {
  id: Name;
  name: string;
  icon: string;
  slots: number;
}

export interface BucketWithTargets extends Bucket {
  targets: BucketTargetData[];
  totalSlots: number;
}


// --- Granularity / bucketing ---

const MIN_VISIBLE_DAYS = 7;
const DEFAULT_MAX_COLUMNS = 20;

const GRANULARITIES: { gran: Granularity; approxDays: number }[] = [
  { gran: 'day', approxDays: 1 },
  { gran: '3day', approxDays: 3 },
  { gran: 'week', approxDays: 7 },
  { gran: '2week', approxDays: 14 },
  { gran: 'month', approxDays: 30 },
  { gran: '2month', approxDays: 61 },
  { gran: 'quarter', approxDays: 91 },
  { gran: 'year', approxDays: 365 },
];

// Pick the granularity whose bucket count is closest to maxColumns (within +2 tolerance)
function granularityForSpan(dayCount: number, maxColumns: number): Granularity {
  let best: Granularity = 'year';
  let bestDist = Infinity;
  for (const { gran, approxDays } of GRANULARITIES) {
    const cols = Math.ceil(dayCount / approxDays);
    if (cols <= maxColumns + 2) {
      const dist = Math.abs(cols - maxColumns);
      if (dist < bestDist) {
        bestDist = dist;
        best = gran;
      }
    }
  }
  return best;
}

// Fixed epoch anchor for multi-day bucket alignment
const EPOCH = dayjs('2020-01-01');
const EPOCH_ISO_WEEK_START = EPOCH.startOf('isoWeek');

function bucketKeyForDay(day: string, gran: Granularity): string {
  if (gran === 'day') return day;
  const d = dayjs(day);
  if (gran === '3day') {
    const daysSinceEpoch = d.diff(EPOCH, 'day');
    return EPOCH.add(Math.floor(daysSinceEpoch / 3) * 3, 'day').format('YYYY-MM-DD');
  }
  if (gran === 'week') return d.startOf('isoWeek').format('YYYY-MM-DD');
  if (gran === '2week') {
    const weekStart = d.startOf('isoWeek');
    const weeksSinceEpoch = weekStart.diff(EPOCH_ISO_WEEK_START, 'week');
    return EPOCH_ISO_WEEK_START.add(Math.floor(weeksSinceEpoch / 2) * 2, 'week').format('YYYY-MM-DD');
  }
  if (gran === 'month') return d.format('YYYY-MM');
  if (gran === '2month') {
    const bimonth = Math.floor(d.month() / 2);
    return `${d.year()}-${String(bimonth * 2 + 1).padStart(2, '0')}`;
  }
  if (gran === 'quarter') {
    return `${d.year()}-Q${Math.floor(d.month() / 3) + 1}`;
  }
  return `${d.year()}`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function bucketLabel(key: string, gran: Granularity, showYear: boolean): string {
  if (gran === 'day' || gran === '3day' || gran === 'week' || gran === '2week') {
    const d = dayjs(key);
    return showYear ? d.format('M/D/YY') : d.format('M/D');
  }
  if (gran === 'month' || gran === '2month') {
    const [year, m] = key.split('-');
    const name = MONTH_SHORT[parseInt(m) - 1];
    return showYear ? `${name} '${year.slice(2)}` : name;
  }
  if (gran === 'quarter') {
    const year = key.slice(0, 4);
    const q = key.slice(5);
    return showYear ? `${q} '${year.slice(2)}` : q;
  }
  return key;
}

function bucketTooltip(key: string, gran: Granularity): string {
  if (gran === 'day') return dayjs(key).format('ddd, MMM D, YYYY');
  if (gran === '3day') {
    const start = dayjs(key);
    return `${start.format('MMM D')} \u2013 ${start.add(2, 'day').format('MMM D, YYYY')}`;
  }
  if (gran === 'week') {
    const start = dayjs(key);
    return `Week of ${start.format('MMM D')} \u2013 ${start.add(6, 'day').format('MMM D, YYYY')}`;
  }
  if (gran === '2week') {
    const start = dayjs(key);
    return `${start.format('MMM D')} \u2013 ${start.add(13, 'day').format('MMM D, YYYY')}`;
  }
  if (gran === 'month') {
    const [year, m] = key.split('-');
    return `${MONTH_FULL[parseInt(m) - 1]} ${year}`;
  }
  if (gran === '2month') {
    const [year, m] = key.split('-');
    const mi = parseInt(m) - 1;
    return `${MONTH_FULL[mi]} \u2013 ${MONTH_FULL[Math.min(mi + 1, 11)]} ${year}`;
  }
  if (gran === 'quarter') {
    const year = key.slice(0, 4);
    const qNum = parseInt(key.slice(6)) - 1;
    return `${MONTH_FULL[qNum * 3]} \u2013 ${MONTH_FULL[qNum * 3 + 2]} ${year}`;
  }
  return key;
}

function markYearLabels(keys: string[], gran: Granularity): boolean[] {
  if (gran === 'year') return keys.map(() => false);
  return keys.map((key, i) => {
    if (i === 0) return true;
    return keys[i - 1].slice(0, 4) !== key.slice(0, 4);
  });
}

function formatDayForRange(day: string): string {
  return dayjs(day).format('MMM D, YYYY');
}

// --- The composable ---

export function useSensorTargetData(
  artifactsDB: Ref<ei.IArtifactsDB>,
  options?: { maxColumns?: Ref<number>; dragAxis?: 'horizontal' | 'vertical' | 'auto' },
) {
  const maxColumns = options?.maxColumns ?? ref(DEFAULT_MAX_COLUMNS);
  const dragAxis = options?.dragAxis ?? 'auto';

  const missions = computed(() =>
    getLaunchedMissions(artifactsDB.value).map(m => new Mission(m))
  );

  // Aggregate mission data at daily granularity
  const fullData = computed(() => {
    const dayMap = new Map<string, Map<Name, number>>();
    const totals = new Map<Name, number>();
    for (const mission of missions.value) {
      const id = mission.missionInfo.targetArtifact;
      if (id == null || id === Name.UNKNOWN || Number(id) === UNTARGETED) continue;
      totals.set(id, (totals.get(id) || 0) + (mission.capacity ?? 0));
      if (!mission.launchTime) continue;
      const dayKey = mission.launchTime.format('YYYY-MM-DD');
      if (!dayMap.has(dayKey)) dayMap.set(dayKey, new Map());
      const targetMap = dayMap.get(dayKey)!;
      targetMap.set(id, (targetMap.get(id) || 0) + (mission.capacity ?? 0));
    }
    // Build contiguous day array from first to last mission
    const dayKeys = [...dayMap.keys()].sort();
    const allDays: string[] = [];
    if (dayKeys.length > 0) {
      let cursor = dayjs(dayKeys[0]);
      const end = dayjs(dayKeys[dayKeys.length - 1]);
      while (!cursor.isAfter(end)) {
        allDays.push(cursor.format('YYYY-MM-DD'));
        cursor = cursor.add(1, 'day');
      }
    }
    return { dayMap, allDays, targetEntries: [...totals.entries()].map(([id, slots]) => ({ id, slots })) };
  });

  const allDays = computed(() => fullData.value.allDays);

  // Sort: artifacts first, then stones, then ingredients — each group by quality descending
  const sortedTargets = computed<TargetEntry[]>(() =>
    [...fullData.value.targetEntries].sort((a, b) => {
      const aGroup = TYPE_GROUP_ORDER[afxIdToType.get(a.id) ?? 0] ?? 9;
      const bGroup = TYPE_GROUP_ORDER[afxIdToType.get(b.id) ?? 0] ?? 9;
      if (aGroup !== bGroup) return aGroup - bGroup;
      return (afxIdToSortKey.get(b.id) ?? 0) - (afxIdToSortKey.get(a.id) ?? 0);
    })
  );

  // --- Zoom/pan state (day indices) ---

  const startIdx = ref(0);
  const endIdx = ref(Infinity);

  const clampedEnd = computed(() => Math.min(endIdx.value, allDays.value.length));
  const clampedStart = computed(() => Math.max(0, Math.min(startIdx.value, clampedEnd.value - MIN_VISIBLE_DAYS)));

  const visibleDays = computed(() =>
    allDays.value.slice(clampedStart.value, clampedEnd.value)
  );

  // --- Adaptive bucketing ---

  const granularity = computed<Granularity>(() =>
    granularityForSpan(visibleDays.value.length, maxColumns.value)
  );

  const buckets = computed<Bucket[]>(() => {
    const gran = granularity.value;
    const days = visibleDays.value;
    const raw: { key: string; days: string[] }[] = [];
    const seen = new Set<string>();
    for (const day of days) {
      const key = bucketKeyForDay(day, gran);
      if (seen.has(key)) {
        raw[raw.length - 1].days.push(day);
      } else {
        seen.add(key);
        raw.push({ key, days: [day] });
      }
    }
    const yearFlags = markYearLabels(raw.map(b => b.key), gran);
    return raw.map((b, i) => ({
      key: b.key,
      label: bucketLabel(b.key, gran, yearFlags[i]),
      tooltip: bucketTooltip(b.key, gran),
      days: b.days,
    }));
  });

  const bucketsWithTargets = computed<BucketWithTargets[]>(() => {
    const { dayMap } = fullData.value;
    return buckets.value.map(bucket => {
      const targetSlots = new Map<Name, number>();
      for (const day of bucket.days) {
        const dayData = dayMap.get(day);
        if (!dayData) continue;
        for (const [id, slots] of dayData) {
          targetSlots.set(id, (targetSlots.get(id) || 0) + slots);
        }
      }
      const targets: BucketTargetData[] = [...targetSlots.entries()]
        .map(([id, slots]) => ({
          id,
          name: getTargetName(id),
          icon: getImageUrlFromId(id, 64),
          slots,
        }))
        .sort((a, b) => b.slots - a.slots);

      const totalSlots = targets.reduce((s, t) => s + t.slots, 0);
      return { ...bucket, targets, totalSlots };
    });
  });

  // --- Range label ---

  const rangeLabel = computed(() => {
    const days = visibleDays.value;
    if (days.length === 0) return '';
    if (days.length === allDays.value.length) return 'Showing all time';
    return `${formatDayForRange(days[0])} \u2013 ${formatDayForRange(days[days.length - 1])}`;
  });

  // --- Zoom controls ---
  //
  // For buttery interactions we keep a non-reactive "live" view window
  // (`liveStart`/`liveEnd`, in fractional day indices) that gesture handlers
  // mutate at the native event rate, and flush it into the reactive refs at
  // most once per animation frame. This decouples input frequency (wheel/mouse
  // events can fire many times per frame) from Vue's re-bucketing work, so the
  // chart never re-layouts more than once per painted frame.

  let liveStart = 0;
  let liveEnd = 0;
  let frameRequested = false;

  const flushFrame = () => {
    frameRequested = false;
    const total = allDays.value.length;
    const start = Math.max(0, Math.min(Math.round(liveStart), total - MIN_VISIBLE_DAYS));
    startIdx.value = Math.max(0, start);
    endIdx.value = Math.min(total, Math.round(liveEnd));
  };

  const scheduleFrame = () => {
    if (frameRequested || typeof requestAnimationFrame === 'undefined') {
      if (typeof requestAnimationFrame === 'undefined') flushFrame();
      return;
    }
    frameRequested = true;
    requestAnimationFrame(flushFrame);
  };

  // Pull the live window from the committed reactive state. Called at the start
  // of a gesture so we continue from wherever discrete actions (click/reset)
  // last left the view.
  const syncLiveFromState = () => {
    liveStart = clampedStart.value;
    liveEnd = clampedEnd.value;
  };

  const resetZoom = () => {
    startIdx.value = 0;
    endIdx.value = allDays.value.length;
  };

  const zoomToBucket = (bucket: Bucket) => {
    if (bucket.days.length === 0) return;
    const all = allDays.value;
    const first = all.indexOf(bucket.days[0]);
    const last = all.indexOf(bucket.days[bucket.days.length - 1]);
    if (first < 0 || last < 0) return;
    const margin = Math.max(1, Math.round((last - first) * 0.2));
    startIdx.value = Math.max(0, first - margin);
    endIdx.value = Math.min(all.length, last + margin + 1);
  };

  // --- Wheel zoom ---

  const getCursorFraction = (e: WheelEvent, el: HTMLElement | null): number => {
    if (!el) return 0.5;
    const rect = el.getBoundingClientRect();
    if (dragAxis === 'vertical') {
      return Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    }
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  const onWheel = (e: WheelEvent, cardEl: HTMLElement | null) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();

    const total = allDays.value.length;
    if (total <= MIN_VISIBLE_DAYS) return;

    // Start from committed state unless a frame is already mid-flight, so
    // consecutive wheel ticks within one frame compound smoothly.
    if (!frameRequested) syncLiveFromState();

    const span = liveEnd - liveStart;
    const cursorFraction = getCursorFraction(e, cardEl);

    // Multiplicative zoom keeps every wheel tick feeling proportional
    // regardless of current zoom level. Trackpad pinch arrives as ctrl+wheel
    // with larger deltas, which this naturally accommodates.
    const factor = Math.exp(e.deltaY * 0.0025);
    const newSpan = Math.max(MIN_VISIBLE_DAYS, Math.min(total, span * factor));

    // Anchor the day under the cursor so it stays put as we zoom.
    const anchor = liveStart + cursorFraction * span;
    let newStart = anchor - cursorFraction * newSpan;
    let newEnd = newStart + newSpan;

    if (newStart < 0) { newEnd -= newStart; newStart = 0; }
    if (newEnd > total) { newStart -= newEnd - total; newEnd = total; }
    liveStart = Math.max(0, newStart);
    liveEnd = Math.min(total, newEnd);
    scheduleFrame();
  };

  // --- Drag-to-pan ---

  const isDragging = ref(false);
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartDayIdx = 0;
  let dragSpan = 0;

  const onDragStart = (e: MouseEvent) => {
    const span = clampedEnd.value - clampedStart.value;
    if (span >= allDays.value.length) return;
    isDragging.value = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartDayIdx = clampedStart.value;
    dragSpan = span;
    syncLiveFromState();
  };

  const onDragMove = (e: MouseEvent, containerEl: HTMLElement | null) => {
    if (!isDragging.value || !containerEl) return;
    const total = allDays.value.length;

    const w = containerEl.clientWidth;
    const h = containerEl.clientHeight;
    const isVertical = dragAxis === 'vertical' || (dragAxis === 'auto' && h > w);

    const pixelDelta = isVertical ? e.clientY - dragStartY : e.clientX - dragStartX;
    const axisSize = isVertical ? h : w;
    if (axisSize <= 0) return;

    // Fractional day delta — rounding happens only at frame flush, so panning
    // tracks the pointer continuously instead of jumping a whole day at a time.
    const dayDelta = (-pixelDelta / axisSize) * dragSpan;
    const newStart = Math.max(0, Math.min(dragStartDayIdx + dayDelta, total - dragSpan));
    liveStart = newStart;
    liveEnd = newStart + dragSpan;
    scheduleFrame();
  };

  const onDragEnd = () => {
    isDragging.value = false;
  };

  return {
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
  };
}
