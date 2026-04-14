/**
 * TikTok list responses may not honor start_time/end_time; Finance Debug aligns
 * to the master range by filtering on each statement's statement_time (Unix).
 */

export function parseStatementTimeSeconds(statementTime: unknown): number | null {
    if (statementTime == null || statementTime === '') return null;
    const n = Number(statementTime);
    if (!Number.isFinite(n)) return null;
    if (n > 1e12) return Math.floor(n / 1000);
    return Math.floor(n);
}

export function statementTimeInRange(
    statementTime: unknown,
    startSecInclusive: number,
    endSecExclusive: number
): boolean {
    const t = parseStatementTimeSeconds(statementTime);
    if (t === null) return false;
    return t >= startSecInclusive && t < endSecExclusive;
}

/** Keep statements whose statement_time falls in [startSec, endSec). Drops rows with missing/unparseable time. */
export function filterStatementsByStatementTimeWindow<T extends { statement_time?: unknown }>(
    statements: T[],
    startSecInclusive: number,
    endSecExclusive: number
): T[] {
    return statements.filter((s) => statementTimeInRange(s.statement_time, startSecInclusive, endSecExclusive));
}
