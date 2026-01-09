import React from 'react';

interface OverlayLoaderProps {
    isLoading: boolean;
    message?: string;
    children: React.ReactNode;
}

export function OverlayLoader({ isLoading, message, children }: OverlayLoaderProps) {
    return (
        <div className="relative w-full h-full">
            {children}

            {isLoading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-900/50 backdrop-blur-sm rounded-xl transition-all duration-300">
                    <div className="flex flex-col items-center gap-3 p-6 bg-gray-800 rounded-2xl shadow-2xl border border-gray-700">
                        <div className="animate-spin rounded-full h-10 w-10 border-4 border-pink-500 border-t-transparent"></div>
                        {message && (
                            <p className="text-white font-medium text-sm animate-pulse">{message}</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
