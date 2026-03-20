import React, { useState } from 'react';
import { X, DollarSign, Calendar, User, FileText, Loader2 } from 'lucide-react';
import { useShopStore } from '../store/useShopStore';
import { Account } from '../lib/supabase';
import { toLocalDateString } from '../utils/dateUtils';

interface ManualAffiliateModalProps {
    isOpen: boolean;
    onClose: () => void;
    account: Account;
    shopId: string;
}

export function ManualAffiliateModal({ isOpen, onClose, account, shopId }: ManualAffiliateModalProps) {
    const [formData, setFormData] = useState({
        affiliate_name: '',
        amount: '',
        date: toLocalDateString(new Date()),
        description: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const addAffiliateSettlement = useShopStore(state => state.addAffiliateSettlement);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.affiliate_name || !formData.amount || !formData.date) return;

        setIsSubmitting(true);
        try {
            await addAffiliateSettlement({
                account_id: account.id,
                shop_id: shopId,
                date: formData.date,
                affiliate_name: formData.affiliate_name,
                amount: parseFloat(formData.amount),
                description: formData.description
            });
            onClose();
            setFormData({
                affiliate_name: '',
                amount: '',
                date: toLocalDateString(new Date()),
                description: ''
            });
        } catch (error) {
            console.error('Failed to add affiliate settlement:', error);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md p-6 shadow-2xl">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="text-xl font-bold text-white">Add Affiliate Retainer</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Affiliate Name */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Affiliate Name</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <User size={16} className="text-gray-500" />
                            </div>
                            <input
                                type="text"
                                required
                                value={formData.affiliate_name}
                                onChange={e => setFormData({ ...formData, affiliate_name: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none"
                                placeholder="e.g. Jane Doe"
                            />
                        </div>
                    </div>

                    {/* Amount */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Amount</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <DollarSign size={16} className="text-gray-500" />
                            </div>
                            <input
                                type="number"
                                step="0.01"
                                required
                                value={formData.amount}
                                onChange={e => setFormData({ ...formData, amount: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none"
                                placeholder="0.00"
                            />
                        </div>
                    </div>

                    {/* Date */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Date</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                                <Calendar size={16} className="text-gray-500" />
                            </div>
                            <input
                                type="date"
                                required
                                value={formData.date}
                                onChange={e => setFormData({ ...formData, date: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none"
                            />
                        </div>
                    </div>

                    {/* Description */}
                    <div>
                        <label className="block text-sm font-medium text-gray-400 mb-1">Description (Optional)</label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 pt-3 pointer-events-none">
                                <FileText size={16} className="text-gray-500" />
                            </div>
                            <textarea
                                value={formData.description}
                                onChange={e => setFormData({ ...formData, description: e.target.value })}
                                className="w-full bg-gray-800 border border-gray-700 text-white rounded-lg pl-10 pr-4 py-2 focus:ring-2 focus:ring-pink-500 focus:border-transparent outline-none resize-none h-24"
                                placeholder="Notes about this retainer..."
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex gap-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-2 bg-gray-800 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="flex-1 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 transition-colors flex items-center justify-center gap-2"
                        >
                            {isSubmitting ? (
                                <>
                                    <Loader2 size={16} className="animate-spin" />
                                    Saving...
                                </>
                            ) : (
                                'Save Retainer'
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
