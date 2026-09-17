import { prisma } from "../src/config/prisma.js";
import { mfaService } from "../src/modules/auth/mfa.service.js";
import { totp } from "../src/modules/auth/totp.js";

/**
 * Re-enrol a privileged account and print what is needed to sign in.
 *
 * AC-002 stops an Owner, Admin or Support sign-in at a second factor, which
 * is correct and is exactly what a developer without an authenticator app on
 * hand cannot get past. This prints both ways through: the setup key for an
 * app, and ten single-use recovery codes for when there is no app.
 *
 * Development only. It deliberately clears an existing enrolment, so running
 * it against a real account would lock out whoever holds that authenticator.
 */
const email = process.argv[2] ?? "devon@acme.test";

async function main() {
  const user = await prisma.appUser.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) throw new Error(`No account for ${email}`);

  // Clear whatever is there, so enrolment can start cleanly.
  await prisma.$transaction(async (tx) => {
    await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
    await tx.appUser.update({
      where: { id: user.id },
      data: { mfaSecret: null, mfaEnrolledAt: null, mfaLastUsedStep: null },
    });
  });

  const offer = await mfaService.beginEnrolment(user.id, user.email, {});
  const { recoveryCodes } = await mfaService.confirmEnrolment(
    user.id,
    totp(offer.secret),
    {}
  );

  // The code just spent cannot be reused (RFC 6238 §5.2), so clear the marker
  // and let the next one through — otherwise the first sign-in would be
  // refused for replay.
  await prisma.appUser.update({
    where: { id: user.id },
    data: { mfaLastUsedStep: null },
  });

  console.log("");
  console.log(`ACCOUNT       ${user.email}  (${user.displayName})`);
  console.log(`PASSWORD      Password123!`);
  console.log("");
  console.log(`SETUP KEY     ${offer.secret}`);
  console.log(`CODE NOW      ${totp(offer.secret)}   (changes every 30 seconds)`);
  console.log("");
  console.log("RECOVERY CODES — each works once, no app needed:");
  for (const code of recoveryCodes) console.log(`  ${code}`);
  console.log("");
}

main()
  .catch((error) => console.error("FAILED:", error.message))
  .finally(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
