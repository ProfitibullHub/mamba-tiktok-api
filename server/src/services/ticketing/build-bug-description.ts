export type BugReportMetadata = {
    userId: string;
    userEmail: string | null;
    tenantId: string | null;
    accountId: string | null;
    shopId: string | null;
    shopName: string | null;
    clientRoute: string | null;
    requestId: string | null;
    environment: string;
    appBuild: string | null;
    userAgent: string | null;
};

/**
 * Markdown-style block appended to the user description (rendered as preformatted HTML in GHL email).
 */
export function formatBugMetadataFooter(meta: BugReportMetadata): string {
    const lines = [
        '### Technical context (auto-attached)',
        '',
        '| Field | Value |',
        '| --- | --- |',
        `| User ID | \`${meta.userId}\` |`,
        `| Email | ${meta.userEmail ?? '—'} |`,
        `| Tenant ID | ${meta.tenantId ?? '—'} |`,
        `| Account ID | ${meta.accountId ?? '—'} |`,
        `| Shop ID | ${meta.shopId ?? '—'} |`,
        `| Shop name | ${meta.shopName ?? '—'} |`,
        `| Route | ${meta.clientRoute ?? '—'} |`,
        `| Request ID | ${meta.requestId ?? '—'} |`,
        `| Environment | ${meta.environment} |`,
        `| App build | ${meta.appBuild ?? '—'} |`,
    ];
    if (meta.userAgent) {
        lines.push('');
        lines.push('<details><summary>User-Agent</summary>');
        lines.push('');
        lines.push('```');
        lines.push(meta.userAgent);
        lines.push('```');
        lines.push('');
        lines.push('</details>');
    }
    return lines.join('\n');
}
