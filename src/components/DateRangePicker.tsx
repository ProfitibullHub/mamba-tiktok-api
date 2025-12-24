import { Calendar } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

export interface DateRange {
  startDate: string;
  endDate: string;
}

interface DateRangePickerProps {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatDateDisplay = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const presets = [
    {
      label: 'Last 7 Days',
      getValue: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 7);
        return {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
        };
      }
    },
    {
      label: 'Last 30 Days',
      getValue: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 30);
        return {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
        };
      }
    },
    {
      label: 'Last 90 Days',
      getValue: () => {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 90);
        return {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
        };
      }
    },
    {
      label: 'This Month',
      getValue: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth(), 1);
        const end = new Date();
        return {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
        };
      }
    },
    {
      label: 'Last Month',
      getValue: () => {
        const now = new Date();
        const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const end = new Date(now.getFullYear(), now.getMonth(), 0);
        return {
          startDate: start.toISOString().split('T')[0],
          endDate: end.toISOString().split('T')[0]
        };
      }
    },
    {
      label: 'All Time',
      getValue: () => {
        return {
          startDate: '2020-01-01',
          endDate: new Date().toISOString().split('T')[0]
        };
      }
    }
  ];

  const handlePresetClick = (preset: typeof presets[0]) => {
    const range = preset.getValue();
    onChange(range);
    setIsOpen(false);
  };

  const handleCustomDateChange = (field: 'startDate' | 'endDate', dateValue: string) => {
    const newRange = { ...value, [field]: dateValue };
    onChange(newRange);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 border border-gray-700 rounded-lg hover:bg-gray-700 transition-colors text-white"
      >
        <Calendar className="w-4 h-4 text-gray-400" />
        <span className="text-sm font-medium">
          {formatDateDisplay(value.startDate)} - {formatDateDisplay(value.endDate)}
        </span>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-96 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          <div className="p-4 border-b border-gray-700">
            <h3 className="text-sm font-semibold text-white mb-3">Quick Select</h3>
            <div className="grid grid-cols-2 gap-2">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetClick(preset)}
                  className="px-3 py-2 text-sm text-gray-300 bg-gray-900/50 hover:bg-gray-700 rounded-lg transition-colors text-left border border-gray-700 hover:border-gray-600"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="p-4">
            <h3 className="text-sm font-semibold text-white mb-3">Custom Range</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">Start Date</label>
                <input
                  type="date"
                  value={value.startDate}
                  onChange={(e) => handleCustomDateChange('startDate', e.target.value)}
                  max={value.endDate}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">End Date</label>
                <input
                  type="date"
                  value={value.endDate}
                  onChange={(e) => handleCustomDateChange('endDate', e.target.value)}
                  min={value.startDate}
                  max={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent"
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
