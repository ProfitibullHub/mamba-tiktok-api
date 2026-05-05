/**
 * P&L API payload (`plData`) is global in the shop store. While a new range is loading,
 * `plData` still reflects the previous range — mixing it with orders filtered to the
 * current range causes bogus net profit / fee totals. Only use `plData` when the
 * store key matches the view's selected range (same format as `fetchPLData` in useShopStore).
 */
export function plDataKeyForRange(
  accountId: string,
  shopId: string | undefined,
  startDate: string,
  endDate: string
): string {
  if (!shopId) return '';
  return `${accountId}:${shopId}:${startDate}:${endDate}`;
}

export function plDataMatchesShopDateRange(
  plDataKey: string,
  accountId: string,
  shopId: string | undefined,
  startDate: string,
  endDate: string
): boolean {
  if (!plDataKey || !shopId) return false;
  return plDataKey === plDataKeyForRange(accountId, shopId, startDate, endDate);
}

export function scopePlDataToDateRange<T>(
  plData: T | null | undefined,
  plDataKey: string,
  accountId: string,
  shopId: string | undefined,
  startDate: string,
  endDate: string
): T | null {
  if (plData == null) return null;
  return plDataMatchesShopDateRange(plDataKey, accountId, shopId, startDate, endDate) ? plData : null;
}

export function scopedPlDataFromCache<T>(
  plData: T | null | undefined,
  plDataKey: string,
  plDataCache: Record<string, T | undefined>,
  accountId: string,
  shopId: string | undefined,
  startDate: string,
  endDate: string
): T | null {
  const key = plDataKeyForRange(accountId, shopId, startDate, endDate);
  if (!key) return null;
  return plDataCache[key] ?? scopePlDataToDateRange(plData, plDataKey, accountId, shopId, startDate, endDate);
}
