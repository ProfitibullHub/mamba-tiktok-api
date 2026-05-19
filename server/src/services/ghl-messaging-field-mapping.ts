/**
 * GoHighLevel / LeadConnector — unified messaging field mapping (email-first spike).
 *
 * ## Outbound
 * - Endpoint: `POST https://services.leadconnectorhq.com/conversations/messages`
 * - Header: `Version: 2021-04-15`
 * - Body: `type: "Email"`, `contactId`, `emailTo`, `emailFrom`, `subject`, `html`, `message` (plain)
 * - **Threading:** include `conversationId` in the JSON body to continue an existing GHL email
 *   conversation when we already have `external_thread_id` from a prior send or inbound webhook.
 * - Response: may include `conversationId`, `messageId` / `id` / `message.id` (store as provider ids).
 *
 * ## Inbound (webhook)
 * - Event: `type === "InboundMessage"` (GHL Marketplace → webhook URL).
 * - Email payloads: `messageType === "Email"`, `direction === "inbound"`, `conversationId`, `contactId`,
 *   `body` (often HTML), `from`, `to`, `emailMessageId`, `threadId`, `dateAdded`, `locationId`.
 * - **Match to Mamba:** lookup `messaging_conversations` where `provider = 'ghl'` and
 *   `external_thread_id` = webhook `conversationId`.
 * - **Dedupe:** use `emailMessageId` or top-level `messageId` as `provider_message_id` (unique per message).
 *
 * ## Inbound without Marketplace app (PIT + Location only)
 * - `GET /conversations/{conversationId}/messages` returns **`messages.messages`** (nested array),
 *   plus **`lastMessageId`** / **`nextPage`** for pagination — not a top-level array.
 * - Do **not** use `GET /conversations/messages?conversationId=…`: the server may treat `messages`
 *   as a conversation id path param (`400` "Conversation with id messages not found").
 * - Rows often have **no `body`** on list responses for Email; Mamba calls
 *   `GET /conversations/messages/:messageId` to hydrate before insert.
 * - Mamba runs the above poll when loading a thread (`GET /api/messaging/conversations/:id/messages`), throttled.
 * - No webhook or separate GHL app is required for this path.
 * @see https://marketplace.gohighlevel.com/docs/webhook/InboundMessage/index.html
 * @see https://marketplace.gohighlevel.com/docs/ghl/conversations/send-a-new-message/index.html
 */
export const MESSAGING_GHL_PROVIDER = 'ghl' as const;
