import React from 'react';
import './TokenExpirationWarning.css';

interface TokenHealth {
    accessTokenExpiresIn: number | null;
    refreshTokenExpiresIn: number | null;
    status: 'healthy' | 'warning' | 'critical' | 'expired';
    message: string | null;
}

interface TokenExpirationWarningProps {
    tokenHealth: TokenHealth;
    onReconnect: () => void;
    onDismiss?: () => void;
}

export const TokenExpirationWarning: React.FC<TokenExpirationWarningProps> = ({
    tokenHealth,
    onReconnect,
    onDismiss
}) => {
    // Don't render if healthy or no message
    if (tokenHealth.status === 'healthy' || !tokenHealth.message) {
        return null;
    }

    const getStatusStyles = () => {
        switch (tokenHealth.status) {
            case 'expired':
                return {
                    background: 'linear-gradient(135deg, rgba(239, 68, 68, 0.15) 0%, rgba(185, 28, 28, 0.15) 100%)',
                    border: '1px solid rgba(239, 68, 68, 0.4)',
                    icon: '🔴',
                    buttonBg: 'rgba(239, 68, 68, 0.9)',
                    buttonText: 'Reconnect Now'
                };
            case 'critical':
                return {
                    background: 'linear-gradient(135deg, rgba(251, 146, 60, 0.15) 0%, rgba(234, 88, 12, 0.15) 100%)',
                    border: '1px solid rgba(251, 146, 60, 0.4)',
                    icon: '🟠',
                    buttonBg: 'rgba(251, 146, 60, 0.9)',
                    buttonText: 'Refresh Now'
                };
            case 'warning':
                return {
                    background: 'linear-gradient(135deg, rgba(250, 204, 21, 0.1) 0%, rgba(202, 138, 4, 0.1) 100%)',
                    border: '1px solid rgba(250, 204, 21, 0.3)',
                    icon: '🟡',
                    buttonBg: 'rgba(250, 204, 21, 0.9)',
                    buttonText: 'Sync to Extend'
                };
            default:
                return null;
        }
    };

    const styles = getStatusStyles();
    if (!styles) return null;

    return (
        <div
            className="token-warning-banner"
            style={{
                background: styles.background,
                border: styles.border,
            }}
        >
            <div className="token-warning-content">
                <span className="token-warning-icon">{styles.icon}</span>
                <span className="token-warning-message">{tokenHealth.message}</span>
            </div>
            <div className="token-warning-actions">
                <button
                    className="token-warning-button"
                    style={{ background: styles.buttonBg }}
                    onClick={onReconnect}
                >
                    {styles.buttonText}
                </button>
                {onDismiss && tokenHealth.status !== 'expired' && (
                    <button
                        className="token-warning-dismiss"
                        onClick={onDismiss}
                    >
                        ✕
                    </button>
                )}
            </div>
        </div>
    );
};

export default TokenExpirationWarning;
