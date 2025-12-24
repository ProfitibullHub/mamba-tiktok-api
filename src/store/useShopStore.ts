import { create } from 'zustand';

const API_BASE_URL = 'http://localhost:3001';

interface Product {
    product_id: string;
    name: string;
    status: string;
    price: number;
    currency: string;
    stock_quantity: number;
    sales_count: number;
    main_image_url: string;
}

export interface Order {
    order_id: string;
    order_status: string;
    order_amount: number;
    currency: string;
    created_time: number;
    line_items: {
        id: string;
        product_name: string;
        sku_image: string;
        quantity: number;
        sale_price: string;
    }[];
}

export interface Statement {
    id: string;
    statement_time: number;
    settlement_amount: string;
    currency: string;
    status: string;
}

interface ShopState {
    products: Product[];
    orders: Order[];
    finance: {
        statements: Statement[];
        payments: any[];
        withdrawals: any[];
        unsettledOrders: any[];
    };
    isLoading: boolean;
    error: string | null;
    lastFetchTime: number | null;


    fetchShopData: (accountId: string, shopId?: string, forceRefresh?: boolean) => Promise<void>;
    setProducts: (products: Product[]) => void;
    setOrders: (orders: Order[]) => void;
    clearData: () => void;
}

export const useShopStore = create<ShopState>((set, get) => ({
    products: [],
    orders: [],
    finance: {
        statements: [],
        payments: [],
        withdrawals: [],
        unsettledOrders: []
    },
    isLoading: false,
    error: null,
    lastFetchTime: null,

    setProducts: (products) => set({ products }),
    setOrders: (orders) => set({ orders }),
    clearData: () => set({
        products: [],
        orders: [],
        finance: { statements: [], payments: [], withdrawals: [], unsettledOrders: [] },
        lastFetchTime: null
    }),

    fetchShopData: async (accountId: string, shopId?: string, forceRefresh = false) => {
        const state = get();

        if (!forceRefresh && state.products.length > 0 && state.orders.length > 0 && state.finance.statements.length > 0) {
            console.log('[Store] Using cached data, skipping fetch');
            return;
        }

        set({ isLoading: true, error: null });

        try {
            console.log('[Store] Generating    shop data...');

            await new Promise(resolve => setTimeout(resolve, 1500));

            const products: Product[] = [
                {
                    product_id: 'prod_001',
                    name: 'Premium Wireless Headphones',
                    status: 'active',
                    price: 89.99,
                    currency: 'USD',
                    stock_quantity: 150,
                    sales_count: 342,
                    main_image_url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=400'
                },
                {
                    product_id: 'prod_002',
                    name: 'Smart Watch Pro',
                    status: 'active',
                    price: 199.99,
                    currency: 'USD',
                    stock_quantity: 75,
                    sales_count: 189,
                    main_image_url: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400'
                },
                {
                    product_id: 'prod_003',
                    name: 'Portable Bluetooth Speaker',
                    status: 'active',
                    price: 49.99,
                    currency: 'USD',
                    stock_quantity: 200,
                    sales_count: 567,
                    main_image_url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400'
                },
                {
                    product_id: 'prod_004',
                    name: 'USB-C Fast Charger',
                    status: 'active',
                    price: 24.99,
                    currency: 'USD',
                    stock_quantity: 500,
                    sales_count: 891,
                    main_image_url: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=400'
                },
                {
                    product_id: 'prod_005',
                    name: 'Laptop Stand Aluminum',
                    status: 'active',
                    price: 39.99,
                    currency: 'USD',
                    stock_quantity: 120,
                    sales_count: 234,
                    main_image_url: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400'
                }
            ];

            const orders: Order[] = [
                {
                    order_id: 'ORD-' + Date.now() + '-001',
                    order_status: 'COMPLETED',
                    order_amount: 89.99,
                    currency: 'USD',
                    created_time: Math.floor(Date.now() / 1000) - 86400,
                    line_items: [{
                        id: 'item_001',
                        product_name: 'Premium Wireless Headphones',
                        sku_image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?w=100',
                        quantity: 1,
                        sale_price: '89.99'
                    }]
                },
                {
                    order_id: 'ORD-' + Date.now() + '-002',
                    order_status: 'PROCESSING',
                    order_amount: 249.98,
                    currency: 'USD',
                    created_time: Math.floor(Date.now() / 1000) - 43200,
                    line_items: [{
                        id: 'item_002',
                        product_name: 'Smart Watch Pro',
                        sku_image: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=100',
                        quantity: 1,
                        sale_price: '199.99'
                    }, {
                        id: 'item_003',
                        product_name: 'Portable Bluetooth Speaker',
                        sku_image: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=100',
                        quantity: 1,
                        sale_price: '49.99'
                    }]
                },
                {
                    order_id: 'ORD-' + Date.now() + '-003',
                    order_status: 'SHIPPED',
                    order_amount: 74.98,
                    currency: 'USD',
                    created_time: Math.floor(Date.now() / 1000) - 172800,
                    line_items: [{
                        id: 'item_004',
                        product_name: 'USB-C Fast Charger',
                        sku_image: 'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=100',
                        quantity: 3,
                        sale_price: '24.99'
                    }]
                }
            ];

            const statements: Statement[] = [
                {
                    id: 'stmt_001',
                    statement_time: Math.floor(Date.now() / 1000) - 604800,
                    settlement_amount: '2450.75',
                    currency: 'USD',
                    status: 'SETTLED'
                },
                {
                    id: 'stmt_002',
                    statement_time: Math.floor(Date.now() / 1000) - 1209600,
                    settlement_amount: '3120.50',
                    currency: 'USD',
                    status: 'SETTLED'
                }
            ];

            set({
                products,
                orders,
                finance: {
                    statements,
                    payments: [],
                    withdrawals: [],
                    unsettledOrders: []
                },
                isLoading: false,
                lastFetchTime: Date.now()
            });

            console.log(`[Store] Generated ${products.length} products, ${orders.length} orders`);
            console.log(`[Store] Finance: ${statements.length} statements`);
        } catch (error: any) {
            console.error('[Store] Error generating    data:', error);
            set({ error: error.message, isLoading: false });
        }
    },
}));
