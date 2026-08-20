# Invitation Email Accept Flow — Implementation Plan

## Problem
Owner invites user → backend creates invitation but never sends email → no accept page exists → invited users can't join.

## Changes (7 total)

### 1. `Backend/src/config/env.ts` — Add APP_URL
Add `APP_URL: z.string().url().default("http://localhost:3000")` after PORT. Needed to construct invitation links in emails.

### 2. `Backend/src/common/mailer/system-mailer.ts` — Add sendInvitationEmail
Add method following sendOtpEmail pattern:
```ts
async sendInvitationEmail(to: string, inviterName: string, workspaceName: string, acceptUrl: string): Promise<void> {
  await this.send({
    to,
    subject: `You've been invited to join ${workspaceName} on Zoiko Mail`,
    text: `${inviterName} has invited you to join ${workspaceName}. Click the link to accept: ${acceptUrl}`,
    html: `<p><b>${inviterName}</b> has invited you to join <b>${workspaceName}</b> on Zoiko Mail.</p>`
      + `<p><a href="${acceptUrl}" style="display:inline-block;padding:12px 24px;background:#0A7EA4;color:white;text-decoration:none;border-radius:8px;font-weight:600">Accept Invitation</a></p>`
      + `<p style="color:#6C8092;font-size:12px">This invitation expires in ${env.INVITATION_EXPIRES_IN_HOURS} hours. If you didn't expect this, you can ignore this email.</p>`,
  });
}
```

### 3. `Backend/src/modules/membership/membership.service.ts` — Call email from createInvitation
After line 164 (return statement), before the closing brace, add email sending:
```ts
// Send invitation email (fire-and-forget — don't block the response)
const tenant = await prisma.tenant.findUnique({ where: { id: context.tenantId }, select: { name: true } });
const actor = await prisma.appUser.findUnique({ where: { id: context.userId }, select: { displayName: true, email: true } });
const acceptUrl = `${env.APP_URL}/accept-invitation?token=${invitationToken}`;
systemMailer.sendInvitationEmail(
  input.email,
  actor?.displayName ?? actor?.email ?? "A team member",
  tenant?.name ?? "the workspace",
  acceptUrl,
).catch((err) => logger.error({ err }, "Failed to send invitation email"));
```
Add imports: `import { systemMailer } from "../../common/mailer/system-mailer.js";` and `import { logger } from "../../config/logger.js";`

### 4. `Frontend/lib/owner-api.ts` — Add acceptInvitation API function
After the cancelInvitation function (~line 58), add:
```ts
export async function acceptInvitation(invitationToken: string): Promise<{ id: string; role: string; status: string }> {
  return apiRequest("/membership/invitations/accept", {
    method: "POST",
    body: { invitationToken },
  });
}
```

### 5. `Frontend/app/accept-invitation/page.tsx` — NEW FILE
Full accept invitation page that:
- Reads `?token=xxx` from URL search params
- On mount, calls `acceptInvitation(token)`
- Shows loading spinner while processing
- On success: shows "You've joined {workspace}!" with "Go to Dashboard" button
- On error: shows error message (expired/invalid) with "Back to Login" link

### 6. `Frontend/lib/auth-hooks.ts` — Handle INVITATION_PENDING in login
After the `EMAIL_VERIFICATION_REQUIRED` block and before the final `else` (~line 95), add:
```ts
} else if (data.state === "INVITATION_PENDING") {
  const names = (data.invitations ?? []).map((w: { name: string }) => w.name).join(",");
  href = `/auth-status?state=INVITATION_PENDING${names ? `&invitations=${encodeURIComponent(names)}` : ""}`;
```

### 7. `Backend/src/config/.env.example` — Add APP_URL
Add `APP_URL=http://localhost:3000` for documentation.
