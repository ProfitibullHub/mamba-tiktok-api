import { randomUUID } from 'crypto';
import { sendHtmlEmail } from '../email.js';
import type {
    TicketingCreatedIssue,
    TicketingCreateInput,
    TicketingIssueStatus,
    TicketingProvider,
} from './ticketing.types.js';

function escapeHtml(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** Plain-text bug body + metadata → simple HTML for LeadConnector / mailbox clients. */
function bugReportEmailHtml(fullDescription: string, variant: 'reporter' | 'support', hasAttachments: boolean): string {
    const safe = escapeHtml(fullDescription);
    const note =
        variant === 'reporter'
            ? hasAttachments
                ? 'Any screenshots you added are attached to this email. If a support inbox is configured, it receives the same attachments.'
                : 'If a support inbox is configured, it receives a copy of this report.'
            : hasAttachments
              ? 'Triage copy: reporter details below. The same image attachments as the reporter email are included on this message.'
              : 'Triage copy: reporter details below (no images were submitted).';
    return `<!DOCTYPE html><html><head><meta charset="utf-8"/></head><body style="font-family:system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.45;color:#111;">
<p style="margin:0 0 1em 0;">This message was sent from <strong>Mamba</strong> in-app bug reporting.</p>
<p style="margin:0 0 1em 0;font-size:13px;color:#555;">${escapeHtml(note)}</p>
<div style="white-space:pre-wrap;border-left:3px solid #22c55e;padding-left:12px;">${safe}</div>
</body></html>`;
}

/**
 * Sends bug reports through GoHighLevel Conversations (same transport as dashboard email).
 * Delivers to the reporter (with attachments) and, when the support inbox differs, a second
 * message to the inbox with the same attachments (GHL uploads per contact). BCC is unreliable
 * in some GHL/Mailgun setups.
 */
export class GhlTicketingProvider implements TicketingProvider {
    readonly id = 'ghl' as const;

    constructor(private readonly supportInboxEmail: string) {}

    async createIssue(input: TicketingCreateInput): Promise<TicketingCreatedIssue> {
        const reporter = input.reporterEmail?.trim().toLowerCase();
        if (!reporter?.includes('@')) {
            throw new Error('Reporter email is required for GoHighLevel ticketing');
        }
        const inbox = this.supportInboxEmail.trim().toLowerCase();
        if (!inbox.includes('@')) {
            throw new Error('Support inbox email is not configured');
        }

        const subject = `[Mamba] ${input.title}`;
        const branded = {
            from: input.emailFrom?.trim() || undefined,
            fromDisplayName: input.emailFromDisplayName?.trim() || undefined,
        };

        const hasAttachments = Boolean(input.attachments && input.attachments.length > 0);

        const result = await sendHtmlEmail(
            reporter,
            subject,
            bugReportEmailHtml(input.description, 'reporter', hasAttachments),
            {
                ...branded,
                contactEmailForUpsert: reporter,
                attachments: input.attachments,
                requireConversationAck: true,
            },
        );

        if (!result.delivered) {
            throw new Error(
                'Could not send report via GoHighLevel — check GOHIGHLEVEL_PIT, GOHIGHLEVEL_LOCATION_ID, and inbox configuration',
            );
        }

        if (inbox !== reporter) {
            const supportBody = `${input.description}\n\n---\nReporter: ${reporter}`;
            try {
                await sendHtmlEmail(
                    inbox,
                    `[Mamba][support] ${input.title}`,
                    bugReportEmailHtml(supportBody, 'support', hasAttachments),
                    {
                        ...branded,
                        contactEmailForUpsert: inbox,
                        attachments: input.attachments,
                        requireConversationAck: false,
                    },
                );
            } catch (e) {
                console.error('[ghl-ticketing] support inbox copy failed:', e instanceof Error ? e.message : e);
            }
        }

        const externalId = result.messageId ?? `ghl-${randomUUID()}`;
        return {
            externalId,
            identifier: result.messageId ?? null,
            url: null,
            initialStatus: inbox !== reporter ? 'Emailed reporter + support inbox' : 'Emailed reporter',
        };
    }

    async getIssueStatus(_externalId: string): Promise<TicketingIssueStatus | null> {
        return null;
    }
}
