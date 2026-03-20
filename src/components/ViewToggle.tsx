import { LayoutGrid, List, Columns3 } from 'lucide-react';

export type ViewMode = 'cards' | 'list' | 'kanban';

interface ViewToggleProps {
    currentView: ViewMode;
    onViewChange: (view: ViewMode) => void;
    showKanban?: boolean;
}

export function ViewToggle({ currentView, onViewChange, showKanban = true }: ViewToggleProps) {
    const views: { id: ViewMode; label: string; icon: React.ReactNode }[] = [
        { id: 'cards', label: 'Cards', icon: <LayoutGrid size={18} /> },
        { id: 'list', label: 'List', icon: <List size={18} /> },
        ...(showKanban ? [{ id: 'kanban' as ViewMode, label: 'Kanban', icon: <Columns3 size={18} /> }] : [])
    ];


    return (
        <div className="flex items-center bg-gray-800 rounded-lg p-1 border border-gray-700">
            {views.map((view) => (
                <button
                    key={view.id}
                    onClick={() => onViewChange(view.id)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${currentView === view.id
                        ? 'bg-pink-600 text-white'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                        }`}
                    title={view.label}
                >
                    {view.icon}
                    <span className="hidden sm:inline">{view.label}</span>
                </button>
            ))}
        </div>
    );
}



