import { GhlTicketingProvider } from './ghl-ticketing.provider.js';
import { getGoHighLevelCredentials } from '../email.js';
import type { TicketingProvider, TicketingCreatedIssue, TicketingCreateInput, TicketingIssueStatus } from './ticketing.types.js';

class NoneTicketingProvider implements TicketingProvider {
    readonly id = 'none' as const;

    async createIssue(_input: TicketingCreateInput): Promise<TicketingCreatedIssue> {
        throw new Error('Ticketing is not configured');
    }

    async getIssueStatus(_externalId: string): Promise<TicketingIssueStatus | null> {
        return null;
    }
}

/** Bug reports use GoHighLevel Conversations (LeadConnector) when PIT, location, and inbox are set. */
export function createTicketingProvider(): TicketingProvider {
    const creds = getGoHighLevelCredentials();
    const inbox = (process.env.GOHIGHLEVEL_BUG_REPORT_TO_EMAIL ?? '').trim();
    if (!creds || !inbox.includes('@')) {
        return new NoneTicketingProvider();
    }
    return new GhlTicketingProvider(inbox);
}

export function isTicketingConfigured(provider: TicketingProvider): boolean {
    return provider.id !== 'none';
}
