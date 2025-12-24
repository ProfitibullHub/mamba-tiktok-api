import React from 'react';

interface TikTokConnectProps {
    accountId: string;
}

const TikTokConnect: React.FC<TikTokConnectProps> = ({ accountId }) => {
    return (
        <div className="p-4 text-center">
            <h3 className="text-lg font-medium text-gray-900">TikTok Shop Connection</h3>
            <p className="mt-2 text-sm text-gray-500">
                Connection settings for account {accountId} will appear here.
            </p>
            <button
                className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                onClick={() => alert('TikTok connection flow coming soon!')}
            >
                Connect TikTok Shop
            </button>
        </div>
    );
};

export default TikTokConnect;
