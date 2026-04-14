/**
 * Transactional HTML email via Resend (same pattern as team invitations).
 * @returns delivered — false when RESEND_API_KEY is missing (logged only; no mail sent).
 */
export async function sendHtmlEmail(
    toEmail: string,
    subject: string,
    html: string
): Promise<{ delivered: boolean }> {
    const resendKey = process.env.RESEND_API_KEY;
    const fromEmail =
        process.env.REPORTS_FROM_EMAIL || process.env.INVITE_FROM_EMAIL || 'noreply@mamba.app';

    if (resendKey) {
        const resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${resendKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ from: fromEmail, to: toEmail, subject, html }),
        });
        if (!resp.ok) {
            const err = await resp.text().catch(() => 'unknown error');
            throw new Error(`Resend API error: ${err}`);
        }
        return { delivered: true };
    }

    console.warn('[email] RESEND_API_KEY not set — email not sent. To:', toEmail, 'Subject:', subject);
    return { delivered: false };
}
