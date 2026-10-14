import { env } from "../../config/env.js";
import { providerMailService } from "../provider-mail/provider-mail.service.js";
import { relayTransport } from "./relay.transport.js";

/**
 * Which transport carries a message's outside recipients.
 *
 * The relay, when one is configured: it sends for every mailbox, as that
 * mailbox's own address. Otherwise the legacy single provider account
 * (MAIL_PROVIDER_*), which can only send for the one member it is mapped to —
 * kept so a deployment without a relay works exactly as before.
 */
export function outboundAvailable(context: { tenantId: string; membershipId: string }): boolean {
  if (relayTransport.isConfigured()) return true;
  return env.MAIL_PROVIDER_ENABLED
    && context.tenantId === env.MAIL_PROVIDER_TENANT_ID
    && context.membershipId === env.MAIL_PROVIDER_MEMBERSHIP_ID;
}

/** Sends one queued message's outside recipients (the SMTP_SEND job). */
export function sendOutbound(messageId: string, tenantId: string) {
  return relayTransport.isConfigured()
    ? relayTransport.sendMessage(messageId, tenantId)
    : providerMailService.sendMessage(messageId, tenantId);
}
