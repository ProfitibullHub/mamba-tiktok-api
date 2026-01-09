import { RefreshCw, X } from 'lucide-react';

interface RefreshPromptProps {
    onRefresh: () => void;
    onDismiss: () => void;
    isStale?: boolean;
}

export function RefreshPrompt({ onRefresh, onDismiss, isStale = true }: RefreshPromptProps) {
    return (
        <div className="fixed top-4 right-4 z-50 animate-slide-in">
            <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 shadow-lg max-w-sm">
                <div className="flex items-start gap-3">
                    <div className="flex-shrink-0">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 flex items-center justify-center">
                            <RefreshCw className="w-5 h-5 text-white" />
                        </div>
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-white font-medium mb-1">
                            {isStale ? 'Data may be outdated' : 'Showing cached data'}
                        </p>
                        <p className="text-gray-400 text-sm">
                            {isStale ? 'Do you want to refresh data?' : 'Click refresh to update'}
                        </p>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onRefresh}
                            className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded transition-colors"
                        >
                            Refresh
                        </button>
                        <button
                            onClick={onDismiss}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                            aria-label="Dismiss"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
