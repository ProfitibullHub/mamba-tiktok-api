import { RefreshCw } from 'lucide-react';

interface SyncIndicatorProps {
    message?: string;
}

export function SyncIndicator({ message = 'Syncing latest data...' }: SyncIndicatorProps) {
    return (
        <div className="fixed top-4 right-4 z-50">
            <div className="bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 shadow-lg">
                <div className="flex items-center gap-3">
                    <RefreshCw className="w-4 h-4 animate-spin text-blue-400" />
                    <span className="text-sm text-gray-300">{message}</span>
                </div>
            </div>
        </div>
    );
}
