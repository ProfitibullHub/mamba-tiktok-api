import { Calendar, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect, useMemo } from 'react';
import { MAX_HISTORICAL_DAYS, getHistoricalStartDate } from '../config/dataRetention';
import { formatShopDateISO } from '../utils/dateUtils';
import { useShopStore } from '../store/useShopStore';

export interface DateRange {
  startDate: string;
  endDate: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
  timezone?: string;
}

export function DateRangePicker({ value, onChange, timezone = 'America/Los_Angeles' }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [tempRange, setTempRange] = useState<DateRange>(value);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Connect to store for loading state
  const isFetchingDateRange = useShopStore(state => state.isFetchingDateRange);
  const fetchDateRange = useShopStore(state => state.fetchDateRange);

  // Calculate the minimum allowed date based on MAX_HISTORICAL_DAYS
  const minDate = useMemo(() => getHistoricalStartDate(), []);
  const maxDate = useMemo(() => {
    // Use Shop Timezone Today
    return formatShopDateISO(new Date(), timezone);
  }, [timezone]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setTempRange(value); // Reset temp range on close
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [value]);

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
    onChange(range);
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
    onChange(tempRange);
    setIsOpen(false);
  };

  // Check if we are fetching data for the current value
  // We check if the fetched range ENDS at the same date, and STARTS at or before our start date
  // This allows fetching "wider" ranges (e.g. including previous period) while still showing loading
  const isLoading = isFetchingDateRange &&
    fetchDateRange.endDate === value.endDate &&
    (fetchDateRange.startDate === value.startDate || !!(fetchDateRange.startDate && value.startDate && fetchDateRange.startDate <= value.startDate));

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
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => !isLoading && setIsOpen(!isOpen)}
        disabled={isLoading}
        className={`flex items-center gap-3 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg hover:border-pink-500/50 hover:bg-gray-700 transition-all duration-200 text-white group ${isLoading ? 'opacity-90 cursor-wait' : ''}`}
      >
        <Calendar className={`w-4 h-4 ${isLoading ? 'text-pink-400/50' : 'text-pink-400 group-hover:text-pink-300'} transition-colors`} />
        <span className="text-sm font-medium text-gray-100">
          {getButtonLabel()}
        </span>
        {!isLoading && <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />}

        {/* Loading Indicator Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-gray-900/80 backdrop-blur-[1px] rounded-lg flex items-center justify-center gap-2 z-10 border border-pink-500/20">
            <svg className="animate-spin h-4 w-4 text-pink-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-xs font-semibold text-pink-400 animate-pulse">Loading data...</span>
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-3 w-[420px] bg-gray-900 border border-gray-700 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
          {/* Presets Section */}
          <div className="p-5 border-b border-gray-800">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                <Calendar className="w-4 h-4 text-pink-400" />
                Quick Select
              </h3>
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetClick(preset)}
                  className="px-4 py-2.5 text-sm font-medium text-gray-300 bg-gray-800 hover:bg-pink-500/10 rounded-lg transition-all duration-200 text-left border border-gray-700 hover:border-pink-500/50 hover:text-pink-300"
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
                    focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50
                    hover:border-pink-500/30 transition-all duration-200
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
                    focus:outline-none focus:ring-2 focus:ring-pink-500/50 focus:border-pink-500/50
                    hover:border-pink-500/30 transition-all duration-200
                    [color-scheme:dark]
                    placeholder:text-gray-500"
                />
                <p className="text-xs text-gray-500 mt-1.5">Latest: {formatDateDisplay(maxDate)}</p>
              </div>

              {/* Apply Button */}
              <button
                onClick={handleApplyCustomRange}
                className="w-full px-4 py-3 mt-2 bg-gradient-to-r from-pink-600 to-pink-500 hover:from-pink-500 hover:to-pink-400
                  text-white text-sm font-semibold rounded-lg transition-all duration-200
                  hover:shadow-lg hover:shadow-pink-500/25 active:scale-[0.98]"
              >
                Apply Range
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
