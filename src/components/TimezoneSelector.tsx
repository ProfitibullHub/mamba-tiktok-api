import { useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown, Check, Search } from 'lucide-react';
import { TIMEZONE_OPTIONS, getTimezoneOffset } from '../utils/timezoneMapping';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

interface TimezoneSelectorProps {
  shopId: string;
  accountId: string;
  currentTimezone: string;
  onTimezoneChange: (timezone: string) => void;
}

export function TimezoneSelector({ shopId, accountId, currentTimezone, onTimezoneChange }: TimezoneSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Auto-focus search on open
  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus();
    }
  }, [isOpen]);

  const handleSelect = async (timezone: string) => {
    if (timezone === currentTimezone) {
      setIsOpen(false);
      setSearch('');
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/tiktok-shop/shops/${shopId}/timezone`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timezone, accountId }),
      });
      const data = await res.json();
      if (data.success) {
        onTimezoneChange(timezone);
      } else {
        console.error('Failed to update timezone:', data.error);
      }
    } catch (err) {
      console.error('Error updating timezone:', err);
    } finally {
      setSaving(false);
      setIsOpen(false);
      setSearch('');
    }
  };

  // Filter options by search
  const filteredGroups = TIMEZONE_OPTIONS.map(group => ({
    ...group,
    options: group.options.filter(opt =>
      opt.label.toLowerCase().includes(search.toLowerCase()) ||
      opt.value.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(group => group.options.length > 0);

  // Display label for current timezone
  const currentLabel = (() => {
    for (const group of TIMEZONE_OPTIONS) {
      const match = group.options.find(o => o.value === currentTimezone);
      if (match) return match.label;
    }
    // Fallback: show the city name
    const city = currentTimezone.split('/').pop()?.replace(/_/g, ' ') || currentTimezone;
    return city;
  })();

  const offset = getTimezoneOffset(currentTimezone);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={saving}
        className="flex items-center gap-2 px-3 py-1.5 bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700/50 hover:border-gray-600/50 rounded-lg text-sm transition-all duration-200 disabled:opacity-50"
        title="Change shop timezone"
      >
        <Globe size={14} className="text-indigo-400" />
        <span className="text-gray-300">{currentLabel}</span>
        <span className="text-gray-500 text-xs">{offset}</span>
        <ChevronDown size={12} className={`text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-700/50">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                ref={searchRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search timezones..."
                className="w-full pl-8 pr-3 py-2 bg-gray-900/50 border border-gray-700/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50"
              />
            </div>
          </div>

          {/* Options */}
          <div className="max-h-72 overflow-y-auto">
            {filteredGroups.map(group => (
              <div key={group.label}>
                <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-800/80 sticky top-0">
                  {group.label}
                </div>
                {group.options.map(opt => {
                  const isSelected = opt.value === currentTimezone;
                  const optOffset = getTimezoneOffset(opt.value);
                  return (
                    <button
                      key={opt.value}
                      onClick={() => handleSelect(opt.value)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between transition-colors ${
                        isSelected
                          ? 'bg-indigo-500/10 text-indigo-300'
                          : 'text-gray-300 hover:bg-gray-700/50'
                      }`}
                    >
                      <span>{opt.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">{optOffset}</span>
                        {isSelected && <Check size={14} className="text-indigo-400" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            ))}
            {filteredGroups.length === 0 && (
              <div className="px-3 py-4 text-sm text-gray-500 text-center">No timezones match your search</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
