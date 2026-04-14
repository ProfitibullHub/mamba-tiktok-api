/**
 * Finance Debug: TikTok statement_transactions returns max page_size rows per request.
 * P&L uses all pages (sync); this merges pages so line-level sums match DB / Seller Center.
 */

export const STATEMENT_TX_MAX_PAGES = 50;
export const STATEMENT_TX_PAGE_SIZE = 100;

export type MergedEnvelopeMeta = {
    tx_pages_fetched: number;
    merged_transaction_count: number;
    hit_page_cap: boolean;
};

type ApiJson = { success?: boolean; error?: string; tiktok?: { code?: number; message?: string; data?: any; request_id?: string } };

/**
 * Paginate GET .../statement_transactions (envelope) until no next_page_token.
 * First page’s statement-level fields are kept; `data.transactions` is the concatenation of all pages.
 */
export async function mergeStatementTransactionEnvelopePages(
    fetchEnvelopeJson: (url: string) => Promise<ApiJson>,
    buildEnvelopeUrl: (qs: URLSearchParams) => string
): Promise<{ tiktok: NonNullable<ApiJson['tiktok']>; meta: MergedEnvelopeMeta }> {
    let allTx: any[] = [];
    let lastTiktok: ApiJson['tiktok'] | undefined;
    let txToken: string | undefined;
    let pages = 0;
    let nextAfterLastPage: string | undefined;

    while (pages < STATEMENT_TX_MAX_PAGES) {
        const qs = new URLSearchParams({ page_size: String(STATEMENT_TX_PAGE_SIZE) });
        if (txToken) qs.set('page_token', txToken);
        const url = buildEnvelopeUrl(qs);
        const res = await fetchEnvelopeJson(url);
        if (!res.success || !res.tiktok) {
            throw new Error(res.error || 'Request failed');
        }
        const tiktok = res.tiktok;
        if (tiktok.code !== undefined && tiktok.code !== 0) {
            throw new Error(tiktok.message || `TikTok error code ${tiktok.code}`);
        }
        lastTiktok = tiktok;
        const data = tiktok.data;
        if (!data) break;
        const batch = Array.isArray(data.transactions) ? data.transactions : [];
        allTx.push(...batch);
        const next = data.next_page_token;
        pages += 1;
        nextAfterLastPage = typeof next === 'string' ? next : undefined;
        if (!next || next === txToken || batch.length === 0) break;
        txToken = next;
    }

    const hitPageCap = pages >= STATEMENT_TX_MAX_PAGES && !!nextAfterLastPage;

    if (lastTiktok?.data) {
        lastTiktok = {
            ...lastTiktok,
            data: {
                ...lastTiktok.data,
                transactions: allTx,
                next_page_token: undefined,
            },
        };
    }

    if (!lastTiktok) {
        throw new Error('No TikTok envelope returned');
    }

    return {
        tiktok: lastTiktok,
        meta: {
            tx_pages_fetched: pages,
            merged_transaction_count: allTx.length,
            hit_page_cap: hitPageCap,
        },
    };
}
