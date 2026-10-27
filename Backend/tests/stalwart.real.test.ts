import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { connect } from "node:tls";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StalwartClient } from "../src/modules/stalwart/stalwart.client.js";
import { StalwartError } from "../src/modules/stalwart/stalwart.types.js";

/**
 * The client against a real Stalwart v0.16.25 in Docker — the version
 * production runs. Opt-in, because it needs Docker and pulls an image (no
 * database: it has its own vitest config):
 *
 *   npm run test:stalwart-real
 *
 * The container is set up the way production is: first-time setup through
 * the `Bootstrap` object, then a platform API key used as a Bearer token. The
 * key is exactly the one docs/DEPLOYMENT.md (step 1) describes, with deletion
 * off: account and domain management without any Destroy permission, plus the
 * permissions of a custom "Zoiko mailbox" role. So the test also shows which
 * role assignments such a key can make. Only the deletion step uses a second
 * key, the same plus `sysAccountDestroy`, as a deployment with deletion on
 * would. STALWART_REAL_KEEP=1 leaves the container running afterwards.
 */

const IMAGE = "stalwartlabs/stalwart:v0.16.25";
const CAPABILITY = "urn:stalwart:jmap";
const enabled = process.env.STALWART_REAL_TEST === "1";

const docker = (...args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

let container = "";
let base = "";
let imapPort = 0;
let platformKey = "";
/** The platform key plus sysAccountDestroy: a deployment with deletion on. */
let deletionKey = "";
let mailboxRoleId = "";
let domain = "";

async function session(auth: string) {
  const res = await fetch(`${base}/jmap/session`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`session ${res.status}`);
  return (await res.json()) as Record<string, any>;
}

async function waitForSession(auth: string) {
  const until = Date.now() + 90_000;
  for (;;) {
    try {
      return await session(auth);
    } catch (error) {
      if (Date.now() > until) throw error;
      await sleep(1000);
    }
  }
}

/** One JMAP call outside the client, for setting the server up. */
async function jmap(auth: string, method: string, args: Record<string, unknown>) {
  const res = await fetch(`${base}/jmap/`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", CAPABILITY], methodCalls: [[method, args, "c"]] }),
  });
  const body = (await res.json()) as { methodResponses: [string, Record<string, any>, string][] };
  const [name, result] = body.methodResponses[0]!;
  if (name === "error") throw new Error(`${method}: ${result.type} ${result.description ?? ""}`);
  return result;
}

/** Signs in over IMAPS (993) and reports whether the server accepted it. */
function imapLogin(user: string, password: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host: "127.0.0.1", port: imapPort, rejectUnauthorized: false });
    let buffer = "";
    let sent = false;
    const quote = (s: string) => `"${s.replace(/["\\]/g, "\\$&")}"`;
    socket.setTimeout(15_000, () => socket.destroy(new Error("IMAP timed out")));
    socket.on("error", reject);
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      if (!sent && buffer.includes("\r\n")) {
        sent = true;
        socket.write(`a1 LOGIN ${quote(user)} ${quote(password)}\r\n`);
      }
      const done = buffer.match(/^a1 (OK|NO|BAD)/m);
      if (done) {
        socket.end();
        resolve(done[1] === "OK");
      }
    });
  });
}

const client = (accountRoleId: string | null, key: () => string = () => platformKey) =>
  new StalwartClient({ baseUrl: base, enabled: true, token: async () => key(), accountRoleId });

describe.skipIf(!enabled)("StalwartClient against a real Stalwart v0.16.25", () => {
  beforeAll(async () => {
    const recovery = randomBytes(12).toString("hex");
    container = docker("run", "-d", "-p", "127.0.0.1::8080", "-p", "127.0.0.1::993", "-e", `STALWART_RECOVERY_ADMIN=admin:${recovery}`, IMAGE);
    const port = (inner: number) => Number(docker("port", container, `${inner}/tcp`).split("\n")[0]!.split(":").pop());
    // Randomly published ports change on a restart, so they are read again after one.
    const readPorts = () => {
      base = `http://127.0.0.1:${port(8080)}`;
      imapPort = port(993);
    };
    readPorts();

    // First-time setup, then a restart out of bootstrap mode.
    const recoveryAuth = basic("admin", recovery);
    const first = await waitForSession(recoveryAuth);
    const setup = await jmap(recoveryAuth, "x:Bootstrap/set", {
      accountId: first.primaryAccounts[CAPABILITY],
      update: {
        singleton: { serverHostname: "mail.zoiko-it.test", defaultDomain: "zoiko-it.test", requestTlsCertificate: false, generateDkimKeys: false },
      },
    });
    const admin = setup.updated.singleton as { username: string; secret: string };
    docker("restart", container);
    readPorts();
    const adminAuth = basic(admin.username, admin.secret);
    const s = await waitForSession(adminAuth);
    const adminAccount = Object.keys(s.accounts).find((id) => CAPABILITY in s.accounts[id].accountCapabilities)!;

    // A mailbox role: sign in, send, receive and IMAP — nothing else.
    const roles = await jmap(adminAuth, "x:Role/get", { accountId: adminAccount, ids: null });
    const user = (roles.list as Record<string, any>[]).find((r) => r.description === "User")!;
    const imap = Object.keys(user.enabledPermissions).filter((p) => p.startsWith("imap") && user.enabledPermissions[p]);
    const mailboxPermissions = ["authenticate", "authenticateWithAlias", "emailSend", "emailReceive", ...imap];
    const role = await jmap(adminAuth, "x:Role/set", {
      accountId: adminAccount,
      create: { r: { description: "Zoiko mailbox", enabledPermissions: Object.fromEntries(mailboxPermissions.map((p) => [p, true])) } },
    });
    mailboxRoleId = role.created.r.id;

    // The platform key from DEPLOYMENT.md: account and domain management with
    // no Destroy permission, plus what the role carries.
    const manage = ["Get", "Create", "Update", "Query"].map((v) => `sysAccount${v}`).concat(
      ["Get", "Create", "Query"].map((v) => `sysDomain${v}`)
    );
    const apiKey = async (description: string, permissions: string[]) => {
      const key = await jmap(adminAuth, "x:ApiKey/set", {
        accountId: adminAccount,
        create: {
          k: { description, permissions: { "@type": "Replace", permissions: Object.fromEntries(permissions.map((p) => [p, true])) } },
        },
      });
      return key.created.k.secret as string;
    };
    platformKey = await apiKey("Zoiko platform (test)", [...manage, ...mailboxPermissions]);
    deletionKey = await apiKey("Zoiko platform with deletion (test)", [...manage, "sysAccountDestroy", ...mailboxPermissions]);
    domain = `t${randomBytes(3).toString("hex")}.zoiko-it.test`;
  }, 300_000);

  afterAll(() => {
    if (container && process.env.STALWART_REAL_KEEP !== "1") docker("rm", "-f", container);
  });

  it("finds the management capability only on the account, and probes healthy", async () => {
    const s = await session(`Bearer ${platformKey}`);
    expect(CAPABILITY in s.capabilities).toBe(false);
    expect(Object.values(s.accounts).some((a: any) => CAPABILITY in a.accountCapabilities)).toBe(true);
    expect(await client(null).probe()).toEqual({ reachable: true, authenticated: true, managementCapability: true });
  });

  it("registers the domain and finds it again", async () => {
    const c = client(mailboxRoleId);
    expect(await c.findDomain(domain)).toBeNull();
    const created = await c.createDomain(domain);
    expect(await c.findDomain(domain)).toEqual(created);
  });

  it("is refused the built-in User role by a key that lacks its permissions, with Stalwart's reason and no password", async () => {
    const c = client(null);
    const hostDomain = (await c.findDomain(domain))!;
    const secret = `Pw-${randomBytes(8).toString("hex")}`;
    const error = await c
      .createAccount({ name: "plainuser", domainId: hostDomain.id, secret, diskQuotaBytes: 1024 ** 3, description: "zoiko:mailbox:it" })
      .catch((e) => e);
    expect(error).toBeInstanceOf(StalwartError);
    expect(error).toMatchObject({ code: "FORBIDDEN", jmapType: "forbidden" });
    expect(error.detail.description).toMatch(/not authorized to grant permissions/);
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("does not accept credentials as an array, which is why the client sends a map", async () => {
    const hostDomain = (await client(null).findDomain(domain))!;
    const s = await session(`Bearer ${platformKey}`);
    const accountId = Object.keys(s.accounts).find((id) => CAPABILITY in s.accounts[id].accountCapabilities)!;
    const result = await jmap(`Bearer ${platformKey}`, "x:Account/set", {
      accountId,
      create: {
        a: {
          "@type": "User",
          name: "arrayshape",
          domainId: hostDomain.id,
          roles: { "@type": "Custom", roleIds: { [mailboxRoleId]: true } },
          credentials: [{ "@type": "Password", secret: "Pw-array-shape" }],
        },
      },
    });
    expect(result.notCreated.a).toMatchObject({ type: "invalidPatch", properties: ["credentials"] });
  });

  it("creates a mailbox account with the custom role that signs in over IMAP, changes its password, and deletes it", async () => {
    const c = client(mailboxRoleId);
    const hostDomain = (await c.findDomain(domain))!;
    const first = `Pw-${randomBytes(8).toString("hex")}`;
    const account = await c.createAccount({
      name: "Info",
      domainId: hostDomain.id,
      secret: first,
      diskQuotaBytes: 1024 ** 3,
      description: "zoiko:mailbox:it",
    });
    expect(account).toMatchObject({ name: "info", domainId: hostDomain.id, description: "zoiko:mailbox:it" });
    expect(await c.findAccount("info", hostDomain.id)).toEqual(account);
    expect(await imapLogin(`info@${domain}`, first)).toBe(true);

    const second = `Pw-${randomBytes(8).toString("hex")}`;
    await c.setAccountPassword(account.id, second);
    expect(await imapLogin(`info@${domain}`, second)).toBe(true);
    expect(await imapLogin(`info@${domain}`, first)).toBe(false);

    // The documented key cannot delete; that takes sysAccountDestroy.
    await expect(c.deleteAccount(account.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const withDeletion = client(mailboxRoleId, () => deletionKey);
    expect(await withDeletion.deleteAccount(account.id)).toBe("DELETED");
    expect(await withDeletion.getAccount(account.id)).toBeNull();
  });
});
