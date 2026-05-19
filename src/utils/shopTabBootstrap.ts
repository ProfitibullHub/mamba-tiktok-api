/**
 * Guards initial tab-mount data loads so swapping Overview ↔ P&L ↔ Orders in the SPA
 * does not rerun the full fetch waterfall after every unmount/remount cycle.
 *
 * Cleared when the seller shop identity changes (`ShopShell` keeps this in sync with `sessionRangeByTab` reset).
 */
const lastFingerprintByShopAndTab = new Map<string, string>();

function mapKey(shopId: string, tab: ShopDataRangeTabId): string {
  return `${shopId}:${tab}`;
}

export type ShopDataRangeTabId = 'overview' | 'profit-loss' | 'orders';

/**
 * Returns `true` when this `{ shopId, tab, fingerprint }` was already applied on a prior mount —
 * callers should skip the redundant mount bootstrap (picker / button handlers still run as usual).
 */
export function shouldSkipShopTabMountBootstrap(
  shopId: string | undefined | null,
  tab: ShopDataRangeTabId,
  fingerprint: string,
): boolean {
  if (!shopId) return false;
  const k = mapKey(shopId, tab);
  if (lastFingerprintByShopAndTab.get(k) === fingerprint) return true;
  lastFingerprintByShopAndTab.set(k, fingerprint);
  return false;
}

/** Reset when navigating to another seller shop (fingerprints include account id separately in caller strings). */
export function clearShopTabMountBootstrapFingerprints(): void {
  lastFingerprintByShopAndTab.clear();
}
