// Live smoke test for the invited-registration + access-control flows.
// Runs against a real server on PORT (default 5000) using fetch, with Prisma
// only to stamp a known OTP code hash (mirrors tests/helpers.ts).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const BASE = `http://localhost:${process.env.SMOKE_PORT ?? 5000}/api/v1`;
const OTP = "123456";
const stamp = Date.now();

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}`, extra ?? "");
  }
}

async function api(path: string, opts: {
  method?: string;
  body?: unknown;
  token?: string;
} = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function registerVerified(email: string, password: string, displayName: string) {
  const reg = await api("/auth/register", {
    method: "POST",
    body: { email, password, displayName },
  });
  if (reg.status !== 201) throw new Error(`register failed: ${JSON.stringify(reg.json)}`);
  const userId = reg.json.data.user.id;
  await prisma.emailOtp.updateMany({
    where: { userId, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    data: { codeHash: await (await import("bcrypt")).hash(OTP, 10) },
  });
  const ver = await api("/auth/verify-otp", {
    method: "POST",
    token: reg.json.data.pendingToken,
    body: { code: OTP },
  });
  if (ver.status !== 200) throw new Error(`verify-otp failed: ${JSON.stringify(ver.json)}`);
  return ver.json.data; // { user, pendingInvitations, pendingToken, ... }
}

async function main() {
  // ── Owner signs up and creates a workspace ─────────────────────────────
  const ownerEmail = `smoke-owner-${stamp}@zoiko.test`;
  const verifiedOwner = await registerVerified(ownerEmail, "Password123!", "Smoke Owner");
  check("owner verify-otp has no pending invitations", verifiedOwner.pendingInvitations.length === 0);

  const ws = await api("/auth/create-workspace", {
    method: "POST",
    token: verifiedOwner.pendingToken,
    body: { tenantName: `Smoke Tenant ${stamp}`, planCode: "starter" },
  });
  check("owner create-workspace → OWNER session", ws.status === 201 && ws.json.data.membership.role === "OWNER");
  const ownerToken = ws.json.data.accessToken as string;

  // ── Access control: MEMBER-level probe on admin endpoints ──────────────
  // (no token → 401; wrong-role enforcement is covered by backend suite)
  const noAuth = await api("/membership/members");
  check("admin endpoint rejects anonymous caller", noAuth.status === 401);

  // ── Invite an email that has never registered ──────────────────────────
  const inviteeEmail = `smoke-invitee-${stamp}@zoiko.test`;
  const inv = await api("/membership/invitations", {
    method: "POST",
    token: ownerToken,
    body: { email: inviteeEmail, role: "ADMIN" },
  });
  check("invite unregistered email → INVITED placeholder", inv.status === 201 && inv.json.data.membership.status === "INVITED");

  // ── Invitee registers (claims placeholder), verifies, joins as ADMIN ───
  const verifiedInvitee = await registerVerified(inviteeEmail, "Password456!", "Smoke Invitee");
  check(
    "invitee verify-otp returns pendingInvitations[0] role=ADMIN",
    verifiedInvitee.pendingInvitations.length === 1 &&
      verifiedInvitee.pendingInvitations[0].role === "ADMIN",
    verifiedInvitee.pendingInvitations
  );

  const blocked = await api("/auth/create-workspace", {
    method: "POST",
    token: verifiedInvitee.pendingToken,
    body: { tenantName: "Nope", planCode: "starter" },
  });
  check("invited account cannot create-workspace (409)", blocked.status === 409);

  const joined = await api("/auth/join-workspace", {
    method: "POST",
    token: verifiedInvitee.pendingToken,
    body: { membershipId: verifiedInvitee.pendingInvitations[0].membershipId },
  });
  check(
    "join-workspace → ADMIN session in owner's tenant",
    joined.status === 201 &&
      joined.json.data.membership.role === "ADMIN" &&
      joined.json.data.tenant.id === ws.json.data.tenant.id
  );
  const inviteeToken = joined.json.data.accessToken as string;

  // ── Session works: /auth/me reflects the joined role ───────────────────
  const me = await api("/auth/me", { token: inviteeToken });
  check("/auth/me shows ADMIN membership", me.status === 200 && me.json.data.membership.role === "ADMIN");

  // ── Login-time INVITATION_PENDING carries an accept token ──────────────
  const invitee2Email = `smoke-invitee2-${stamp}@zoiko.test`;
  await api("/membership/invitations", {
    method: "POST",
    token: ownerToken,
    body: { email: invitee2Email, role: "MEMBER" },
  });
  // Register but do NOT join yet.
  const reg2 = await api("/auth/register", {
    method: "POST",
    body: { email: invitee2Email, password: "Password789!", displayName: "Smoke Two" },
  });
  const userId2 = reg2.json.data.user.id;
  await prisma.emailOtp.updateMany({
    where: { userId: userId2, purpose: "EMAIL_VERIFICATION", consumedAt: null },
    data: { codeHash: await (await import("bcrypt")).hash(OTP, 10) },
  });
  await api("/auth/verify-otp", { method: "POST", token: reg2.json.data.pendingToken, body: { code: OTP } });

  const login2 = await api("/auth/login", {
    method: "POST",
    body: { email: invitee2Email, password: "Password789!" },
  });
  check(
    "login with only pending invites → INVITATION_PENDING + accept token",
    login2.status === 200 &&
      login2.json.data.state === "INVITATION_PENDING" &&
      typeof login2.json.data.pendingToken === "string" &&
      login2.json.data.invitations.length === 1,
    login2.json.data.state
  );

  // Accept via the login-issued pending token (the auth-status screen flow).
  const join2 = await api("/auth/join-workspace", {
    method: "POST",
    token: login2.json.data.pendingToken,
    body: { membershipId: login2.json.data.invitations[0].membershipId },
  });
  check(
    "accept from auth-status flow → MEMBER session",
    join2.status === 201 && join2.json.data.membership.role === "MEMBER"
  );

  console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error("SMOKE TEST CRASHED:", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
