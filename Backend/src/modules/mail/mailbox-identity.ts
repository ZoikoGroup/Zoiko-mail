/**
 * How a Zoiko mailbox is tied to the account that was made for it on the mail
 * host. One definition, because creation writes these and cleanup reads them,
 * and a deletion that disagrees with creation about the marker would either
 * leave accounts behind or destroy ones that are not ours.
 */

/** The marker that ties a host account to the Zoiko mailbox that created it. */
export function ownershipMarker(mailboxId: string): string {
  return `zoiko:mailbox:${mailboxId}`;
}

/** The secret-store reference holding a hosted mailbox's initial credential. */
export function credentialRef(mailboxId: string): string {
  return `mailbox-credential-${mailboxId}`;
}
