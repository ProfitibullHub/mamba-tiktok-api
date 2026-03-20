# Frontend Components

The product UI is split into two main views and a handful of modals. Here's how they fit together:

```
Dashboard
├── ProductsView (read-only browser)
│   ├── search + status filter + pagination
│   ├── ProductCard[] (grid of product tiles)
│   └── ProductDetails (modal on click)
│       └── ProductEditModal (full editor, nested)
│
└── ProductManagementView (admin/management)
    ├── sortable table + bulk actions + sync
    ├── ProductCostsModal (cost editor)
    └── ProductPerformanceCharts (analytics)
```

## ProductsView

**File:** `src/components/views/ProductsView.tsx`

This is the read-only product browser. Takes `account` and `shopId` as props, reads `products` and `orders` from the store.

It has a search bar that filters by product name (simple lowercase `.includes()`), a status dropdown (All / Active / Inactive / Frozen), and paginates at 50 items per page — all client-side. There's also a COGS coverage indicator showing how many products have COGS set vs total.

Sales counts aren't stored on the product — they're calculated on the fly by counting matching `product_id` entries across `orders.line_items`.

There's a toggle button that switches over to ProductManagementView for admin operations.

## ProductManagementView

**File:** `src/components/views/ProductManagementView.tsx`

The admin view. Takes `account`, `shopId`, and an `onBack` callback. Reads `products` and `orders` from the store, plus the cost update and bulk action methods.

It renders a sortable table with columns for title, price, sales count, COGS, and stock quantity. Rows have checkboxes for multi-select, which enables bulk actions:
- Bulk COGS editing — select products, enter a value, it applies to all of them
- Activate / Deactivate / Delete — with confirmation dialogs
- Manual sync trigger

Clicking on a product row opens the ProductCostsModal. Pagination is 25 items per page.

## ProductCard

**File:** `src/components/product/ProductCard.tsx`

The tile component used in ProductsView's grid. Takes `product`, `onClick`, and `salesCount`.

Shows the product image (with a hover zoom effect), a status badge (color-coded based on ACTIVATE / SELLER_DEACTIVATED / FROZEN / DELETED), an FBT badge if the product is fulfilled by TikTok, and a variants badge if there's more than one SKU. Price shows as a single value or a range when there are multiple SKU prices. Stock and sales count round out the card.

## ProductDetails

**File:** `src/components/product/ProductDetails.tsx`

The expanded product view that opens as a modal when you click a ProductCard. Takes `product`, `accountId`, `onClose`, and `onCostsUpdate`.

This is where most of the product management happens for read-only mode users. It has:

- An image carousel (main image + any additional images)
- The full description from `product.details?.description`, truncated with a "read more" toggle
- Key metrics: stock, price, sales, CTR, GMV
- Inline COGS editor with a date option picker (apply today vs specific date)
- Inline shipping cost editor, same date options
- Expandable per-SKU cost editors (COGS and shipping for each variant)
- FBT toggle (self-fulfilled vs fulfilled by TikTok)
- A button to open the full ProductEditModal

## ProductEditModal

**File:** `src/components/product/ProductEditModal.tsx`

The full-featured product editor. Takes `product`, `accountId`, `onClose`, `onSave`. Uses several store actions: `editProduct`, `updateProductInventory`, `updateProductPrices`, `uploadProductImage`, `fetchWarehouses`.

Organized into four tabs:

**Basic** — title and description fields. Saves via `POST /products/:id/partial-edit`.

**Pricing** — per-SKU price editing with `original_price` and `sale_price` fields. Saves via `POST /products/:id/prices`.

**Inventory** — per-SKU quantity management broken down by warehouse. Calls `fetchWarehouses()` to populate the warehouse selector. Saves via `POST /products/:id/inventory`.

**Images** — upload new images (drag-drop supported), reorder, delete. Upload goes through `POST /images/upload` to get a TikTok URI, then that URI is included in the next `partial-edit` call.

## ProductCostsModal

**File:** `src/components/product/ProductCostsModal.tsx`

Dedicated cost management modal. Takes `product`, `accountId`, `onClose`.

Has sections for product-level COGS, product-level shipping, and expandable sections for SKU-level COGS and shipping. Each has a number input and a date option — apply today or pick a specific effective date for backdating. There's also a fulfillment type radio (self-fulfilled vs TikTok).

## ProductPerformanceCharts

**File:** `src/components/product/ProductPerformanceCharts.tsx`

Renders analytics charts — GMV by product, top products by sales count, CTR trends, order trends. Takes `products` and `dateRange` as props.

## TypeScript types

These are the main interfaces used across components and the store:

```typescript
interface Product {
    product_id: string;
    name: string;
    status: string;              // ACTIVATE, SELLER_DEACTIVATED, FROZEN, DELETED
    price: number;
    currency: string;
    stock_quantity: number;
    sales_count: number;
    main_image_url: string;
    images?: string[];
    click_through_rate?: number;
    gmv?: number;
    orders_count?: number;
    cogs?: number | null;
    shipping_cost?: number | null;
    is_fbt?: boolean;
    fbt_source?: 'auto' | 'manual';
    details?: any;               // full TikTok JSON blob
    skus?: ProductSKU[];
}

interface ProductSKU {
    id: string;
    seller_sku?: string;
    price: {
        currency: string;
        sale_price?: string;
        tax_exclusive_price: string;
    };
    inventory: Array<{
        quantity: number;
        warehouse_id?: string;
    }>;
    sales_attributes?: Array<{
        id: string;
        name: string;
        value_id: string;
        value_name: string;
        sku_img?: { urls: string[] };
    }>;
    cogs?: number | null;
    shipping_cost?: number | null;
}

interface ProductEditData {
    title?: string;
    description?: string;
    main_images?: Array<{ uri: string }>;
    skus?: Array<{
        id: string;
        seller_sku?: string;
        original_price?: string;
        inventory?: Array<{
            warehouse_id: string;
            quantity: number;
        }>;
    }>;
}

interface Warehouse {
    id: string;
    name: string;
    is_default?: boolean;
    address?: {
        region?: string;
        state?: string;
        city?: string;
        postal_code?: string;
    };
}
```

All of these are defined in `src/store/useShopStore.ts`.

## MarketingDashboardView

**File:** `src/components/views/MarketingDashboardView.tsx`

The main hub for ads management. Takes `account` as a prop.

-   **Header**: Shows connection status and a "Connect TikTok Ads" button if disconnected.
-   **Date Picker**: Controls the date range for all charts and metrics.
-   **Overview Cards**: Displays Total Spend, Impressions, Clicks, Conversions, CPC, CPM, CTR, ROAS.
-   **Spend Chart**: A large area chart showing daily spend over time.
-   **Campaigns Table**: A detailed table of all campaigns, showing their status, budget, and performance metrics.
-   **Sync Button**: Triggers a manual refresh of ads data.

It relies on `useTikTokAdsStore` for all state management.

