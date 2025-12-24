import { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  icon: LucideIcon;
  iconColor: string;
  subtitle?: string;
  subValue?: string;
  onClick?: () => void;
}

export function StatCard({ title, value, subValue, change, icon: Icon, iconColor, subtitle, onClick }: StatCardProps) {
  const isPositive = change !== undefined && change >= 0;
  const showChange = change !== undefined && change !== 0;

  return (
    <div
      onClick={onClick}
      className={`bg-gray-800 rounded-xl p-6 border border-gray-700 hover:border-gray-600 transition-all ${onClick ? 'cursor-pointer hover:bg-gray-750' : ''}`}
    >
      <div className="flex items-start justify-between mb-4">
        <div className={`p-3 rounded-lg ${iconColor}`}>
          <Icon className="w-6 h-6 text-white" />
        </div>
        {showChange && (
          <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-sm font-semibold ${isPositive ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
            }`}>
            <span>{isPositive ? '+' : ''}{change.toFixed(1)}%</span>
          </div>
        )}
      </div>

      <div>
        <p className="text-gray-400 text-sm font-medium mb-1">{title}</p>
        <p className="text-3xl font-bold text-white mb-1">{value}</p>
        {subValue && (
          <p className="text-sm font-medium text-gray-300 mb-1">{subValue}</p>
        )}
        {subtitle && (
          <p className="text-gray-500 text-xs">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
