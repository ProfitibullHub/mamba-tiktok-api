-- Keyset pagination for /orders/synced/.../batch orders by paid_time DESC, order_id DESC.
-- Helps Postgres satisfy OR cursor filters without regressing to heavy sorts.
CREATE INDEX IF NOT EXISTS idx_shop_orders_shop_paid_order_cursor
    ON shop_orders (shop_id, paid_time DESC NULLS LAST, order_id DESC)
    WHERE paid_time IS NOT NULL;
