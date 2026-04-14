/**
 * Finance Debug payloads can exceed localStorage limits (~5MB). We keep the bulk of
 * dataByTab in localStorage but store statement_tx_envelope (TikTok direct raw) in IndexedDB.
 */

const IDB_NAME = 'mamba_finance_debug';
const IDB_STORE = 'heavy_tabs';
const IDB_VERSION = 1;

function idbOpen(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onerror = () => reject(req.error);
        req.onsuccess = () => resolve(req.result);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) {
                db.createObjectStore(IDB_STORE);
            }
        };
    });
}

function idbPut(key: string, value: unknown): Promise<void> {
    return idbOpen().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(IDB_STORE).put(value, key);
            })
    );
}

function idbGet<T>(key: string): Promise<T | undefined> {
    return idbOpen().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readonly');
                const r = tx.objectStore(IDB_STORE).get(key);
                r.onsuccess = () => resolve(r.result as T | undefined);
                r.onerror = () => reject(r.error);
            })
    );
}

function idbDelete(key: string): Promise<void> {
    return idbOpen().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, 'readwrite');
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
                tx.objectStore(IDB_STORE).delete(key);
            })
    );
}

export function envelopeHeavyKey(accountId: string, shopId: string) {
    return `envelope:${accountId}:${shopId}`;
}

export async function saveStatementTxEnvelopeHeavy(accountId: string, shopId: string, data: unknown | undefined) {
    const key = envelopeHeavyKey(accountId, shopId);
    try {
        if (data === undefined) {
            await idbDelete(key);
        } else {
            await idbPut(key, data);
        }
    } catch (e) {
        console.warn('[FinanceDebug] IndexedDB save failed for statement_tx_envelope', e);
    }
}

export async function loadStatementTxEnvelopeHeavy(accountId: string, shopId: string) {
    try {
        return await idbGet(envelopeHeavyKey(accountId, shopId));
    } catch (e) {
        console.warn('[FinanceDebug] IndexedDB load failed for statement_tx_envelope', e);
        return undefined;
    }
}

/** Strip heavy tab from dataByTab so JSON fits in localStorage. */
export function stripHeavyTabForLocalStorage(dataByTab: Record<string, unknown>): Record<string, unknown> {
    if (!dataByTab || typeof dataByTab !== 'object') return dataByTab;
    const { statement_tx_envelope: _removed, ...rest } = dataByTab;
    return rest;
}
