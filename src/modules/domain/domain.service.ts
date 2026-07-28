import { randomBytes } from "node:crypto";
import { resolveMx, resolveTxt } from "node:dns/promises";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../common/errors/AppError.js";
import { ErrorCodes } from "../../common/errors/errorCodes.js";
import { auditService } from "../audit/audit.service.js";

interface DnsResult<T> {
  values: T;
  error?: { code: string; message: string };
}

function readableDnsError(record: string, error: unknown) {
  const code = error && typeof error === "object" && "code" in error && typeof error.code === "string"
    ? error.code : "DNS_LOOKUP_FAILED";
  const descriptions: Record<string, string> = {
    ENOTFOUND: `${record} record was not found`,
    ENODATA: `${record} record has no usable value`,
    ETIMEOUT: `${record} lookup timed out; retry the check`,
    ESERVFAIL: `DNS server could not answer the ${record} lookup`,
    EREFUSED: `DNS server refused the ${record} lookup`,
  };
  return { code, message: descriptions[code] ?? `${record} lookup failed; verify the DNS record and retry` };
}

async function txt(name: string, record: string): Promise<DnsResult<string[]>> {
  try {
    return { values: (await resolveTxt(name)).map((parts) => parts.join("")) };
  } catch (error) {
    return { values: [], error: readableDnsError(record, error) };
  }
}

async function mx(name: string): Promise<DnsResult<Awaited<ReturnType<typeof resolveMx>>>> {
  try {
    return { values: await resolveMx(name) };
  } catch (error) {
    return { values: [], error: readableDnsError("MX", error) };
  }
}

export class DomainService {
  list(tenantId: string) {
    return prisma.mailDomain.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  }
  async add(domainName: string, tenantId: string, userId: string) {
    const existing = await prisma.mailDomain.findFirst({ where: { tenantId, domainName } });
    if (existing) throw new AppError("Domain already exists", 409, ErrorCodes.CONFLICT);
    const domain = await prisma.mailDomain.create({
      data: { tenantId, domainName, verificationToken: `zoiko-mail-verification=${randomBytes(24).toString("hex")}` },
    });
    await auditService.record({ tenantId, actorUserId: userId, eventType: "DOMAIN_ADDED", targetType: "MailDomain", targetId: domain.id });
    return domain;
  }
  async diagnostics(domainId: string, tenantId: string, userId: string) {
    const domain = await prisma.mailDomain.findFirst({ where: { id: domainId, tenantId } });
    if (!domain) throw new AppError("Domain not found", 404, ErrorCodes.NOT_FOUND);
    const [rootTxt, dmarc, dkim, mxRecords] = await Promise.all([
      txt(domain.domainName, "TXT/SPF"), txt(`_dmarc.${domain.domainName}`, "DMARC"),
      txt(`default._domainkey.${domain.domainName}`, "DKIM"), mx(domain.domainName),
    ]);
    const errors = {
      ...(rootTxt.error ? { txt: rootTxt.error } : {}),
      ...(mxRecords.error ? { mx: mxRecords.error } : {}),
      ...(dkim.error ? { dkim: dkim.error } : {}),
      ...(dmarc.error ? { dmarc: dmarc.error } : {}),
    };
    const now = new Date();
    const data = {
      verificationStatus: rootTxt.values.includes(domain.verificationToken) ? "VERIFIED" as const : "FAILED" as const,
      mxStatus: mxRecords.values.length ? "VALID" as const : "INVALID" as const,
      spfStatus: rootTxt.values.some((v) => v.toLowerCase().startsWith("v=spf1")) ? "VALID" as const : "INVALID" as const,
      dkimStatus: dkim.values.some((v) => v.toLowerCase().includes("v=dkim1")) ? "VALID" as const : "INVALID" as const,
      dmarcStatus: dmarc.values.some((v) => /^v=dmarc1;\s*p=(none|quarantine|reject)(;|$)/i.test(v)) ? "VALID" as const : "INVALID" as const,
      firstCheckedAt: domain.firstCheckedAt ?? now,
      lastCheckedAt: now,
      errorDetails: errors,
    };
    const ready = data.verificationStatus === "VERIFIED" && data.spfStatus === "VALID"
      && data.dkimStatus === "VALID" && data.dmarcStatus === "VALID";
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.mailDomain.update({
        where: { id: domain.id, tenantId },
        data: {
          ...data,
          ...(!ready ? { sendingEnabled: false, activatedAt: null } : {}),
        },
      });
      await tx.domainDnsCheck.create({
        data: {
          tenantId, domainId: domain.id,
          verificationStatus: data.verificationStatus,
          mxStatus: data.mxStatus, spfStatus: data.spfStatus,
          dkimStatus: data.dkimStatus, dmarcStatus: data.dmarcStatus,
          errorDetails: errors,
          checkedAt: now,
        },
      });
      await auditService.record({
        tenantId, actorUserId: userId, eventType: "DOMAIN_DNS_CHECKED",
        targetType: "MailDomain", targetId: domain.id,
        metadata: { readyForSending: ready },
      }, tx);
      return result;
    });
    return { ...updated, records: { verificationTxt: domain.verificationToken, dkimHost: `default._domainkey.${domain.domainName}`, dmarcHost: `_dmarc.${domain.domainName}` } };
  }

  async listChecks(domainId: string, tenantId: string) {
    const domain = await prisma.mailDomain.findFirst({ where: { id: domainId, tenantId }, select: { id: true } });
    if (!domain) throw new AppError("Domain not found", 404, ErrorCodes.NOT_FOUND);
    return prisma.domainDnsCheck.findMany({
      where: { tenantId, domainId },
      orderBy: { checkedAt: "desc" },
      take: 100,
    });
  }

  async activate(domainId: string, tenantId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const domain = await tx.mailDomain.findFirst({ where: { id: domainId, tenantId } });
      if (!domain) throw new AppError("Domain not found", 404, ErrorCodes.NOT_FOUND);
      const failures = [
        domain.verificationStatus !== "VERIFIED" ? "TXT ownership verification" : null,
        domain.spfStatus !== "VALID" ? "SPF" : null,
        domain.dkimStatus !== "VALID" ? "DKIM" : null,
        domain.dmarcStatus !== "VALID" ? "DMARC (minimum p=none)" : null,
      ].filter(Boolean);
      if (failures.length) {
        throw new AppError(
          `Domain cannot send until these checks pass: ${failures.join(", ")}`,
          409,
          ErrorCodes.CONFLICT
        );
      }
      const activated = await tx.mailDomain.update({
        where: { id: domain.id, tenantId },
        data: { sendingEnabled: true, activatedAt: new Date() },
      });
      await auditService.record({
        tenantId, actorUserId: userId, eventType: "DOMAIN_SENDING_ACTIVATED",
        targetType: "MailDomain", targetId: domain.id,
      }, tx);
      return activated;
    });
  }
}
export const domainService = new DomainService();
