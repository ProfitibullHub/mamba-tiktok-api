import { Calendar, ChevronDown, Clock } from 'lucide-react';
import { useState, useRef, useEffect, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { MAX_HISTORICAL_DAYS, getHistoricalStartDate } from '../config/dataRetention';
import { formatShopDateISO } from '../utils/dateUtils';
import { useShopStore } from '../store/useShopStore';

export interface DateRange {
  startDate: string;
  endDate: string;
  /**
   * Overview: set when the user applies a multi-day range via the picker's **Apply** (custom)
   * so we also load the prior comparison window for charts. Preset quick-picks omit this.
   */
  includePreviousPeriodForCharts?: boolean;
}

/** Preset = quick-select buttons; custom = explicit Apply on typed/picked dates (Overview uses this to gate comparison-period fetch). */
export type DateRangeChangeMeta = { source: 'preset' | 'custom' };

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange, meta?: DateRangeChangeMeta) => void;
  timezone?: string;
  /** Shorter control for dense toolbars (single-row headers). */
  compact?: boolean;
}

export function DateRangePicker({ value, onChange, timezone = 'America/Los_Angeles', compact = false }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(value);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number } | null>(null);

  // Connect to store for loading state
  const isFetchingDateRange = useShopStore(state => state.isFetchingDateRange);
  const dateRangeFetchShopId = useShopStore(state => state.dateRangeFetchShopId);
  const lastFetchShopId = useShopStore(state => state.lastFetchShopId);
  const fetchDateRange = useShopStore(state => state.fetchDateRange);
  const shopDataFetchQueued = useShopStore(state => state.shopDataFetchQueued);
  const queuedShopDataRequestShopId = useShopStore(state => state.queuedShopDataRequestShopId);
  const queuedShopDataRequestRange = useShopStore(state => state.queuedShopDataRequestRange);

  // Calculate the minimum allowed date based on MAX_HISTORICAL_DAYS
  const minDate = useMemo(() => getHistoricalStartDate(), []);
  const maxDate = useMemo(() => {
    // Use Shop Timezone Today
    return formatShopDateISO(new Date(), timezone);
  }, [timezone]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node;
      if (dropdownRef.current?.contains(t)) return;
      if (panelRef.current?.contains(t)) return;
      setIsOpen(false);
      setTempRange(value); // Reset temp range on close
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setTempRange(value);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, value]);

  // Portal + fixed position: toolbar parents use overflow-x-auto / overflow-hidden and clip absolute dropdowns.
  useLayoutEffect(() => {
    if (!isOpen || typeof document === 'undefined') {
      setPanelStyle(null);
      return;
    }

    const anchor = dropdownRef.current;
    if (!anchor) return;

    const update = () => {
      const rect = anchor.getBoundingClientRect();
      const panelWidth = Math.min(420, Math.max(280, window.innerWidth - 16));
      let left = rect.right - panelWidth;
      left = Math.max(8, Math.min(left, window.innerWidth - panelWidth - 8));
      const top = rect.bottom + 10;
      setPanelStyle({ top, left, width: panelWidth });
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [isOpen, compact, value.startDate, value.endDate]);

  // Sync tempRange with value when opened
  useEffect(() => {
    if (isOpen) {
      setTempRange(value);
    }
  }, [isOpen, value]);

  const formatDateDisplay = (dateStr: string) => {
    // Format simply for display based on string parts (YYYY-MM-DD)
    // We assume dateStr is already in the correct timezone (Shop Time)
    // So we just want "Feb 12, 2026"
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Dynamic presets based on MAX_HISTORICAL_DAYS
  const presets = useMemo(() => {
    const allPresets = [
      {
        label: 'Today',
        days: 1,
        getValue: () => {
          const today = new Date();
          const todayStr = formatShopDateISO(today, timezone);
          return {
            startDate: todayStr,
            endDate: todayStr
          };
        }
      },
      {
        label: 'Last 7 Days',
        days: 7,
        getValue: () => {
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - 6); // 7 days inclusive
          return {
            startDate: formatShopDateISO(start, timezone),
            endDate: formatShopDateISO(end, timezone)
          };
        }
      },
      {
        label: 'Last 30 Days',
        days: 30,
        getValue: () => {
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - 29); // 30 days inclusive
          return {
            startDate: formatShopDateISO(start, timezone),
            endDate: formatShopDateISO(end, timezone)
          };
        }
      },
      {
        label: 'Last 90 Days',
        days: 90,
        getValue: () => {
          const end = new Date();
          const start = new Date();
          start.setDate(start.getDate() - 90);
          return {
            startDate: formatShopDateISO(start, timezone),
            endDate: formatShopDateISO(end, timezone)
          };
        }
      }
    ];

    // Only show presets that fit within MAX_HISTORICAL_DAYS
    return allPresets.filter(preset => preset.days <= MAX_HISTORICAL_DAYS);
  }, [timezone]); // Refreshes if timezone changes

  const handlePresetClick = (preset: typeof presets[0]) => {
    const range = preset.getValue();
    onChange(range, { source: 'preset' });
    setIsOpen(false);
  };

  const handleCustomDateChange = (field: 'startDate' | 'endDate', dateValue: string) => {
    // Enforce min/max date constraints
    let constrainedValue = dateValue;

    if (field === 'startDate') {
      if (dateValue < minDate) constrainedValue = minDate;
      if (dateValue > tempRange.endDate) constrainedValue = tempRange.endDate;
    } else {
      if (dateValue > maxDate) constrainedValue = maxDate;
      if (dateValue < tempRange.startDate) constrainedValue = tempRange.startDate;
    }

    setTempRange({ ...tempRange, [field]: constrainedValue });
  };

  const handleApplyCustomRange = () => {
    onChange(tempRange, { source: 'custom' });
    setIsOpen(false);
  };

  // Check if we are fetching data for the current value
  // Only show loading for this exact picker range. Wider background prefetches
  // (Overview previous-period data, P&L 30-day prewarm) should not block this control.
  const isLoading =
    isFetchingDateRange &&
    !!lastFetchShopId &&
    dateRangeFetchShopId === lastFetchShopId &&
    fetchDateRange.endDate === value.endDate &&
    fetchDateRange.startDate === value.startDate;

  const isQueued =
    shopDataFetchQueued &&
    !!lastFetchShopId &&
    queuedShopDataRequestShopId === lastFetchShopId &&
    !!queuedShopDataRequestRange.startDate &&
    !!queuedShopDataRequestRange.endDate &&
    queuedShopDataRequestRange.startDate === value.startDate &&
    queuedShopDataRequestRange.endDate === value.endDate;

  const getButtonLabel = () => {
    const today = new Date();
    const todayStr = formatShopDateISO(today, timezone);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = formatShopDateISO(yesterday, timezone);

    if (value.startDate === todayStr && value.endDate === todayStr) {
      return `Today, ${formatDateDisplay(todayStr)}`;
    }
    if (value.startDate === yesterdayStr && value.endDate === yesterdayStr) {
      return `Yesterday, ${formatDateDisplay(yesterdayStr)}`;
    }

    return `${formatDateDisplay(value.startDate)} - ${formatDateDisplay(value.endDate)}`;
  };

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        type="button"
        className={`flex items-center bg-gray-800 border border-gray-700 rounded-lg hover:border-mamba-green/50 hover:bg-gray-700 transition-all duration-200 text-white group shrink-0 ${isLoading || isQueued ? 'opacity-90 cursor-wait' : ''} ${
          compact
            ? 'h-9 gap-2 px-2.5 sm:px-3'
            : 'gap-3 px-4 py-2.5'
        }`}
      >
        <Calendar className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} ${isLoading ? 'text-mamba-neon/50' : isQueued ? 'text-amber-400/90' : 'text-mamba-neon group-hover:text-mamba-neon'} transition-colors shrink-0`} />
        <span className={`font-medium text-gray-100 whitespace-nowrap ${compact ? 'text-xs sm:text-sm max-w-[9rem] sm:max-w-none truncate sm:truncate-none' : 'text-sm'}`}>
          {getButtonLabel()}
        </span>
        {!isLoading && !isQueued && (
          <ChevronDown
            className={`${compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-gray-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`}
          />
        )}

        {/* Active load */}
        {isLoading && (
          <div className="pointer-events-none absolute inset-0 bg-gray-900/80 backdrop-blur-[1px] rounded-lg flex items-center justify-center gap-2 z-10 border border-mamba-green/20">
            <svg className="animate-spin h-4 w-4 text-mamba-green shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-xs font-semibold text-mamba-neon animate-pulse">Loading…</span>
          </div>
        )}
        {/* Queued behind an in-flight fetch (same shop) */}
        {!isLoading && isQueued && (
          <div className="pointer-events-none absolute inset-0 bg-gray-900/75 backdrop-blur-[1px] rounded-lg flex items-center justify-center gap-2 z-10 border border-amber-500/35 px-2">
            <Clock className="w-4 h-4 text-amber-400 shrink-0" strokeWidth={2.25} />
            <span className="text-[11px] sm:text-xs font-semibold text-amber-200/95 text-center leading-tight">
              In queue
            </span>
          </div>
        )}
      </button>

      {isOpen &&
        panelStyle &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            className="fixed max-h-[min(78vh,calc(100vh-24px))] overflow-y-auto overscroll-contain bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 z-[10050]"
            style={{
              top: panelStyle.top,
              left: panelStyle.left,
              width: panelStyle.width,
            }}
            role="dialog"
            aria-label="Date range"
          >
            {/* Presets Section */}
            <div className="p-5 border-b border-gray-800">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-mamba-neon" />
                  Quick Select
                </h3>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => handlePresetClick(preset)}
                    className="px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-mamba-green/10 rounded-lg transition-all duration-200 text-left border border-gray-700 hover:border-mamba-green/50 hover:text-mamba-neon"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Range Section */}
            <div className="p-5">
              <h3 className="text-sm font-semibold text-white mb-4">Custom Range (Type or Pick)</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">
                    Start Date <span className="text-gray-500">(Click to type or pick)</span>
                  </label>
                  <input
                    type="date"
                    value={tempRange.startDate}
                    onChange={(e) => handleCustomDateChange('startDate', e.target.value)}
                    min={minDate}
                    max={tempRange.endDate}
                    placeholder="YYYY-MM-DD"
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-medium
                    focus:outline-none focus:ring-2 focus:ring-mamba-green/50 focus:border-mamba-green/50
                    hover:border-mamba-green/30 transition-all duration-200
                    [color-scheme:dark]
                    placeholder:text-gray-500"
                  />
                  <p className="text-xs text-gray-500 mt-1.5">Earliest: {formatDateDisplay(minDate)}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-2">
                    End Date <span className="text-gray-500">(Click to type or pick)</span>
                  </label>
                  <input
                    type="date"
                    value={tempRange.endDate}
                    onChange={(e) => handleCustomDateChange('endDate', e.target.value)}
                    min={tempRange.startDate}
                    max={maxDate}
                    placeholder="YYYY-MM-DD"
                    className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm font-medium
                    focus:outline-none focus:ring-2 focus:ring-mamba-green/50 focus:border-mamba-green/50
                    hover:border-mamba-green/30 transition-all duration-200
                    [color-scheme:dark]
                    placeholder:text-gray-500"
                  />
                  <p className="text-xs text-gray-500 mt-1.5">Latest: {formatDateDisplay(maxDate)}</p>
                </div>

                <button
                  type="button"
                  onClick={handleApplyCustomRange}
                  className="w-full px-4 py-3 mt-2 bg-gradient-to-r from-mamba-green to-mamba-green hover:from-mamba-green hover:to-mamba-neon
                  text-white text-sm font-semibold rounded-lg transition-all duration-200
                  hover:shadow-lg hover:shadow-mamba-green/25 active:scale-[0.98]"
                >
                  Apply Range
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
