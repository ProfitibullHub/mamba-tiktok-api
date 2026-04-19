import { useState, useRef, useEffect } from 'react';
import { Globe, ChevronDown, Check, Search, AlertTriangle, X } from 'lucide-react';
import { TIMEZONE_OPTIONS, getTimezoneOffset } from '../utils/timezoneMapping';
import { apiFetch } from '../lib/apiClient';

interface TimezoneSelectorProps {
  shopId: string;
  accountId: string;
  currentTimezone: string;
  onTimezoneChange: (timezone: string) => void;
  /** When true, timezone cannot be changed (e.g. Seller User read-only shop). */
  readOnly?: boolean;
  /** Shorter trigger for dense toolbars. */
  compact?: boolean;
}

export function TimezoneSelector({
  shopId,
  accountId,
  currentTimezone,
  onTimezoneChange,
  readOnly,
  compact = false,
}: TimezoneSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [searchMode, setSearchMode] = useState(false);
  const [saving, setSaving] = useState(false);
  
  // Modal state
  const [pendingTimezone, setPendingTimezone] = useState<string | null>(null);
  
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      // Don't close if clicking inside the modal
      const modalEl = document.getElementById('timezone-warning-modal');
      if (modalEl && modalEl.contains(e.target as Node)) {
        return;
      }
      
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearch('');
        setSearchMode(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search only when user explicitly opens search mode
  useEffect(() => {
    if (isOpen && searchMode && searchRef.current && !pendingTimezone) {
      const t = requestAnimationFrame(() => searchRef.current?.focus());
      return () => cancelAnimationFrame(t);
    }
  }, [isOpen, searchMode, pendingTimezone]);

  const handleSelect = (timezone: string) => {
    if (readOnly) return;
    if (timezone === currentTimezone) {
      setIsOpen(false);
      setSearch('');
      setSearchMode(false);
      return;
    }

    // Instead of saving immediately, show the warning modal
    setPendingTimezone(timezone);
  };
  
  const confirmTimezoneChange = async () => {
    if (!pendingTimezone) return;
    
    setSaving(true);
    try {
      const res = await apiFetch(`/api/tiktok-shop/shops/${shopId}/timezone`, {
        method: 'PATCH',
        body: JSON.stringify({ timezone: pendingTimezone, accountId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        onTimezoneChange(pendingTimezone);
      } else {
        console.error('Failed to update timezone:', data.error || res.statusText);
      }
    } catch (err) {
      console.error('Error updating timezone:', err);
    } finally {
      setSaving(false);
      setPendingTimezone(null);
      setIsOpen(false);
      setSearch('');
      setSearchMode(false);
    }
  };
  
  const cancelTimezoneChange = () => {
    setPendingTimezone(null);
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
  
  // Get label for pending timezone
  const pendingLabel = (() => {
    if (!pendingTimezone) return '';
    for (const group of TIMEZONE_OPTIONS) {
      const match = group.options.find(o => o.value === pendingTimezone);
      if (match) return match.label;
    }
    return pendingTimezone;
  })();

  return (
    <>
      <div className="relative shrink-0 min-w-0" ref={dropdownRef}>
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          onClick={() => {
            if (readOnly) return;
            setIsOpen((open) => {
              const next = !open;
              if (!next) {
                setSearch('');
                setSearchMode(false);
              }
              return next;
            });
          }}
          disabled={saving || readOnly}
          className={`flex items-center bg-gray-800/60 hover:bg-gray-700/60 border border-gray-700/50 hover:border-gray-600/50 rounded-lg transition-all duration-200 disabled:opacity-50 min-w-0 max-w-full ${
            compact
              ? 'h-9 gap-1.5 px-2 sm:px-2.5 text-xs'
              : 'gap-2 px-3 py-1.5 text-sm'
          }`}
          title={readOnly ? 'Read-only for your role' : 'Change shop timezone'}
        >
          <Globe size={compact ? 13 : 14} className="text-indigo-400 shrink-0" />
          <span className={`text-gray-300 truncate min-w-0 ${compact ? 'max-w-[6rem] sm:max-w-[9rem] md:max-w-[12rem]' : ''}`}>
            {currentLabel}
          </span>
          <span className={`text-gray-500 shrink-0 ${compact ? 'text-[10px] hidden sm:inline' : 'text-xs'}`}>{offset}</span>
          <ChevronDown
            size={compact ? 11 : 12}
            className={`text-gray-500 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>

        {isOpen && !pendingTimezone && (
          <div
            className="absolute top-full right-0 mt-2 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 overflow-hidden"
            aria-label="Shop timezone"
          >
            <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-700/50 bg-gray-800/90">
              <span className="text-xs font-medium text-gray-400 truncate">Select timezone</span>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  title={searchMode ? 'Hide search' : 'Search timezones'}
                  aria-pressed={searchMode}
                  onClick={() => {
                    setSearchMode((m) => {
                      const next = !m;
                      if (!next) setSearch('');
                      return next;
                    });
                  }}
                  className={`p-1.5 rounded-lg border transition-colors ${
                    searchMode
                      ? 'border-indigo-500/50 bg-indigo-500/15 text-indigo-300'
                      : 'border-gray-700/80 bg-gray-900/40 text-gray-400 hover:text-white hover:border-gray-600'
                  }`}
                >
                  <Search size={15} />
                </button>
                {searchMode && search.trim() !== '' && (
                  <button
                    type="button"
                    title="Clear search"
                    onClick={() => setSearch('')}
                    className="p-1.5 rounded-lg border border-gray-700/80 bg-gray-900/40 text-gray-400 hover:text-white hover:border-gray-600"
                  >
                    <X size={15} />
                  </button>
                )}
              </div>
            </div>

            {searchMode && (
              <div className="p-2 border-b border-gray-700/50">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" />
                  <input
                    ref={searchRef}
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setSearch('');
                        setSearchMode(false);
                      }
                    }}
                    placeholder="Filter by city or region…"
                    className="w-full pl-8 pr-3 py-2 bg-gray-900/50 border border-gray-700/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500/50"
                  />
                </div>
              </div>
            )}

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
      
      {/* Timezone Warning Modal */}
      {pendingTimezone && (
        <div id="timezone-warning-modal" className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            <div className="flex items-start justify-between p-5 border-b border-gray-800">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-amber-500" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-white">Change Shop Timezone?</h3>
                  <p className="text-sm text-gray-400 mt-1">
                    To <span className="text-white font-medium">{pendingLabel}</span>
                  </p>
                </div>
              </div>
              <button 
                onClick={cancelTimezoneChange}
                disabled={saving}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <X size={20} />
              </button>
            </div>
            
            <div className="p-5 space-y-4 text-sm text-gray-300">
              <p>
                Please confirm that <strong className="text-white">{pendingLabel}</strong> is the timezone your TikTok Seller Center uses to calculate your metrics.
              </p>
              
              <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-400 font-medium">
                  <Globe size={16} />
                  <span>Important Note on Data</span>
                </div>
                <p className="text-amber-500/80 leading-relaxed">
                  Changing your timezone <strong className="text-amber-400 text-opacity-100">will not corrupt your data</strong>, but it can cause confusion. Historical days will re-bucket based on the new timezone, meaning orders placed near midnight may shift to adjacent days in your reports.
                </p>
              </div>
            </div>
            
            <div className="p-5 bg-gray-800/50 border-t border-gray-800 flex justify-end gap-3">
              <button
                onClick={cancelTimezoneChange}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-gray-300 hover:text-white bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmTimezoneChange}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {saving ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                    <span>Applying...</span>
                  </>
                ) : (
                  <span>Confirm Change</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
