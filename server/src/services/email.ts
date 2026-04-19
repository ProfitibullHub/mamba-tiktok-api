/**
 * Transactional HTML email via Resend.
 * @returns delivered — false when RESEND_API_KEY is missing (logged only; no mail sent).
 */
export type SendHtmlEmailOptions = {
    /** Overrides default from (REPORTS_FROM_EMAIL → INVITE_FROM_EMAIL → noreply@mamba.app). */
    from?: string;
};

async function postResendEmail(
    apiKey: string,
    body: { from: string; to: string; subject: string; html: string }
): Promise<void> {
    const resp = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const raw = await resp.text().catch(() => '');
        let detail = raw;
        try {
            const j = JSON.parse(raw) as { message?: string };
            if (j?.message) detail = j.message;
        } catch {
            /* keep raw */
        }
        throw new Error(`Resend API error (${resp.status}): ${detail || 'unknown'}`);
    }
}

export async function sendHtmlEmail(
    toEmail: string,
    subject: string,
    html: string,
    options?: SendHtmlEmailOptions
): Promise<{ delivered: boolean }> {
    const resendKey = process.env.RESEND_API_KEY;
    const defaultFrom =
        process.env.REPORTS_FROM_EMAIL || process.env.INVITE_FROM_EMAIL || 'noreply@mamba.app';
    const fromEmail = options?.from ?? defaultFrom;

    if (resendKey) {
        await postResendEmail(resendKey, { from: fromEmail, to: toEmail, subject, html });
        return { delivered: true };
    }

    console.warn('[email] RESEND_API_KEY not set — email not sent. To:', toEmail, 'Subject:', subject);
    return { delivered: false };
}
