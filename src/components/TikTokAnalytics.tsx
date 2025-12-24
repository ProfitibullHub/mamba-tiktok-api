import React from 'react';

interface TikTokAnalyticsProps {
    accountId: string;
}

const TikTokAnalytics: React.FC<TikTokAnalyticsProps> = ({ accountId }) => {
    return (
        <div className="p-4 text-center">
            <h3 className="text-lg font-medium text-gray-900">Analytics Dashboard</h3>
            <p className="mt-2 text-sm text-gray-500">
                Analytics data for account {accountId} will be displayed here.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
                <div className="bg-gray-50 overflow-hidden shadow rounded-lg">
                    <div className="px-4 py-5 sm:p-6">
                        <dt className="text-sm font-medium text-gray-500 truncate">Total Sales</dt>
                        <dd className="mt-1 text-3xl font-semibold text-gray-900">--</dd>
                    </div>
                </div>
                <div className="bg-gray-50 overflow-hidden shadow rounded-lg">
                    <div className="px-4 py-5 sm:p-6">
                        <dt className="text-sm font-medium text-gray-500 truncate">Orders</dt>
                        <dd className="mt-1 text-3xl font-semibold text-gray-900">--</dd>
                    </div>
                </div>
                <div className="bg-gray-50 overflow-hidden shadow rounded-lg">
                    <div className="px-4 py-5 sm:p-6">
                        <dt className="text-sm font-medium text-gray-500 truncate">Revenue</dt>
                        <dd className="mt-1 text-3xl font-semibold text-gray-900">--</dd>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default TikTokAnalytics;
