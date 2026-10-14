/**
 * Zoiko Mail inbound edge for the pilot (implementation guide v2.5, Profile A).
 *
 * Cloudflare Email Routing receives mail for a domain on Cloudflare DNS and
 * runs this Worker once per recipient. The Worker signs the raw message and
 * posts it to Zoiko's ingest endpoint:
 *
 *   POST {ZOIKO_INBOUND_URL}            e.g. https://api.zoikomail.com/api/v1/internal/inbound/messages
 *   X-Zoiko-Timestamp, X-Zoiko-Recipients, X-Zoiko-Sender, X-Zoiko-Signature
 *
 * Signature: hex HMAC-SHA256 with INBOUND_WEBHOOK_SECRET over
 * "<timestamp>.<recipients>." followed by the raw message bytes — the same
 * scheme as IngestService.sign in the backend.
 *
 * Outcomes:
 *   200  stored (or already stored)          → accepted
 *   404  no mailbox for this address          → rejected in the SMTP session (550)
 *   other / unreachable                       → forwarded to BACKUP_FORWARD when
 *                                               set, otherwise a temporary failure
 *                                               so the sending server retries
 *
 * Secrets (wrangler secret put): INBOUND_WEBHOOK_SECRET.
 * Vars (wrangler.toml): ZOIKO_INBOUND_URL, optional BACKUP_FORWARD (a verified
 * Email Routing destination address).
 */
export default {
  async email(message, env) {
    const raw = new Uint8Array(await new Response(message.raw).arrayBuffer());
    const timestamp = String(Date.now());
    const recipients = message.to.toLowerCase();

    const prefix = new TextEncoder().encode(`${timestamp}.${recipients}.`);
    const signed = new Uint8Array(prefix.length + raw.length);
    signed.set(prefix);
    signed.set(raw, prefix.length);
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(env.INBOUND_WEBHOOK_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = [...new Uint8Array(await crypto.subtle.sign("HMAC", key, signed))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    let response;
    try {
      response = await fetch(env.ZOIKO_INBOUND_URL, {
        method: "POST",
        headers: {
          "content-type": "message/rfc822",
          "x-zoiko-timestamp": timestamp,
          "x-zoiko-recipients": recipients,
          "x-zoiko-sender": message.from,
          "x-zoiko-signature": signature,
        },
        body: raw,
      });
    } catch {
      response = null;
    }

    if (response && response.ok) return;
    if (response && response.status === 404) {
      message.setReject("550 5.1.1 No such mailbox here");
      return;
    }
    if (env.BACKUP_FORWARD) {
      // Zoiko is unreachable: keep the mail rather than lose it.
      await message.forward(env.BACKUP_FORWARD);
      return;
    }
    // Throwing makes Cloudflare answer the sending server with a temporary
    // failure, so it retries later instead of bouncing.
    throw new Error(`Zoiko ingest unavailable (${response ? response.status : "network"})`);
  },
};
