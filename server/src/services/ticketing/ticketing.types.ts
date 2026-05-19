export type TicketingAttachment = {
    filename: string;
    contentBase64: string;
};

export type TicketingCreateInput = {
    title: string;
    /** User-facing description; metadata appended separately by the route. */
    description: string;
    /** Used as the GoHighLevel / LeadConnector contact for the conversation; required to submit. */
    reporterEmail?: string | null;
    /** Optional images (LeadConnector upload; same limits as transactional email). */
    attachments?: TicketingAttachment[];
    /** Same whitelabel From as dashboard exports when set (GHL deliverability). */
    emailFrom?: string | null;
    emailFromDisplayName?: string | null;
};

export type TicketingCreatedIssue = {
    externalId: string;
    identifier: string | null;
    url: string | null;
    initialStatus: string | null;
};

export type TicketingIssueStatus = {
    externalId: string;
    identifier: string | null;
    url: string | null;
    status: string | null;
};

export interface TicketingProvider {
    readonly id: 'ghl' | 'none';
    createIssue(input: TicketingCreateInput): Promise<TicketingCreatedIssue>;
    getIssueStatus(externalId: string): Promise<TicketingIssueStatus | null>;
}
