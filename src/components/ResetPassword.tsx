import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { Video, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';

type Props = {
    mode: 'reset' | 'invite';
    onComplete: () => void;
};

export function ResetPassword({ mode, onComplete }: Props) {
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [done, setDone] = useState(false);

    const title = mode === 'invite' ? 'Set your password' : 'Reset your password';
    const subtitle =
        mode === 'invite'
            ? 'You were invited to Mamba. Choose a password to complete your account setup.'
            : 'Enter your new password below.';

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (password.length < 6) {
            setError('Password must be at least 6 characters.');
            return;
        }
        if (password !== confirmPassword) {
            setError('Passwords do not match.');
            return;
        }

        setLoading(true);
        const { error: updateErr } = await supabase.auth.updateUser({ password });
        setLoading(false);

        if (updateErr) {
            setError(updateErr.message);
            return;
        }

        setDone(true);
        window.history.replaceState({}, '', '/');
        setTimeout(onComplete, 1500);
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center p-4">
            <div className="w-full max-w-md">
                <div className="bg-gray-800 rounded-2xl shadow-2xl p-8 border border-gray-700">
                    <div className="flex justify-center mb-8">
                        <div className="bg-gradient-to-r from-pink-500 to-red-500 p-4 rounded-2xl">
                            <Video className="w-10 h-10 text-white" />
                        </div>
                    </div>

                    <h1 className="text-2xl font-bold text-center text-white mb-2">{title}</h1>
                    <p className="text-gray-400 text-center mb-8 text-sm">{subtitle}</p>

                    {done ? (
                        <div className="flex flex-col items-center gap-3 py-6">
                            <CheckCircle className="w-12 h-12 text-emerald-400" />
                            <p className="text-emerald-300 font-medium">Password set successfully!</p>
                            <p className="text-gray-500 text-sm">Redirecting to dashboard...</p>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    New password
                                </label>
                                <div className="relative">
                                    <input
                                        type={showPassword ? 'text' : 'password'}
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                        minLength={6}
                                        className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all pr-12"
                                        placeholder="At least 6 characters"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-gray-400 hover:text-white transition-colors"
                                    >
                                        {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-300 mb-2">
                                    Confirm password
                                </label>
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={confirmPassword}
                                    onChange={(e) => setConfirmPassword(e.target.value)}
                                    required
                                    className="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-transparent transition-all"
                                    placeholder="Re-enter your password"
                                />
                            </div>

                            {error && (
                                <div className="flex items-center gap-2 bg-red-900/30 border border-red-500 text-red-300 px-4 py-3 rounded-lg text-sm">
                                    <AlertCircle className="w-4 h-4 shrink-0" />
                                    {error}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-gradient-to-r from-pink-500 to-red-500 text-white py-3 rounded-lg font-semibold hover:from-pink-600 hover:to-red-600 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-offset-2 focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-all transform hover:scale-[1.02]"
                            >
                                {loading ? 'Saving...' : 'Set password'}
                            </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
