import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-slate-50 transition-colors duration-300 dark:bg-slate-950">
      <div className="mx-auto max-w-3xl px-6 py-12 sm:px-8">
        <Link
          href="/login"
          className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 transition hover:text-teal-700 dark:text-teal-400 dark:hover:text-teal-300"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Sign In
        </Link>

        <article className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-10">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 dark:text-white">
            Privacy Policy
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Last updated: August 27, 2026
          </p>

          <div className="mt-8 space-y-8 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {/* 1 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                1. Introduction
              </h2>
              <p>
                Zoiko Mail (&quot;we,&quot; &quot;our,&quot; or &quot;us&quot;)
                is committed to protecting your privacy. This Privacy Policy
                explains how we collect, use, disclose, and safeguard your
                information when you use our platform and services. Please read
                this policy carefully to understand our practices regarding your
                personal data.
              </p>
            </section>

            {/* 2 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                2. Information We Collect
              </h2>
              <p className="mb-3">
                We collect information you provide directly and information
                generated through your use of the Service:
              </p>
              <ul className="list-inside list-disc space-y-1.5">
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    Account Information:
                  </span>{" "}
                  Name, email address, workspace name, and role when you create
                  an account.
                </li>
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    Email Content:
                  </span>{" "}
                  Emails and attachments processed through Zoiko Mail, including
                  messages you send, receive, and organize.
                </li>
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    Connected Accounts:
                  </span>{" "}
                  Credentials and tokens for third-party email providers (such as
                  Gmail or Microsoft 365) that you choose to connect.
                </li>
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    Usage Data:
                  </span>{" "}
                  Log data, device information, browser type, IP address, pages
                  visited, and actions taken within the Service.
                </li>
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    Communications:
                  </span>{" "}
                  Any messages you send to our support team or provide through
                  feedback forms.
                </li>
              </ul>
            </section>

            {/* 3 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                3. How We Use Your Information
              </h2>
              <p>We use the information we collect to:</p>
              <ul className="mt-2 list-inside list-disc space-y-1.5">
                <li>Provide, maintain, and improve the Service.</li>
                <li>
                  Process and manage your email communications and commitments.
                </li>
                <li>
                  Authenticate your identity and secure your account against
                  unauthorized access.
                </li>
                <li>
                  Send important service-related notices (e.g., security alerts,
                  billing, policy changes).
                </li>
                <li>
                  Detect and prevent fraud, abuse, and security incidents.
                </li>
                <li>
                  Respond to your support requests and communications.
                </li>
                <li>
                  Comply with legal obligations and enforce our terms.
                </li>
              </ul>
            </section>

            {/* 4 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                4. How We Share Your Information
              </h2>
              <p>
                We do not sell your personal information. We may share your
                information in the following circumstances:
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1.5">
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    With your consent:
                  </span>{" "}
                  When you explicitly authorize us to share your data with
                  third-party services.
                </li>
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    With service providers:
                  </span>{" "}
                  Trusted third-party vendors who assist in operating the
                  Service, subject to confidentiality agreements.
                </li>
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    For legal compliance:
                  </span>{" "}
                  When required by law, regulation, or valid legal process.
                </li>
                <li>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    Business transfers:
                  </span>{" "}
                  In connection with a merger, acquisition, or sale of assets,
                  with appropriate notice to affected users.
                </li>
              </ul>
            </section>

            {/* 5 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                5. Data Security
              </h2>
              <p>
                We implement industry-standard security measures to protect your
                data, including encryption of tokens at rest using AES-256-GCM,
                TLS encryption in transit, role-based access controls, and
                regular security audits. While we take reasonable precautions, no
                method of transmission or storage is 100% secure, and we cannot
                guarantee absolute security.
              </p>
            </section>

            {/* 6 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                6. Data Retention
              </h2>
              <p>
                We retain your personal information for as long as your account
                is active or as needed to provide the Service. Email content and
                related data are retained according to your workspace settings
                and applicable retention policies. When you delete your account,
                we will delete or anonymize your personal data within a
                reasonable timeframe, except where retention is required by law.
              </p>
            </section>

            {/* 7 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                7. Your Rights
              </h2>
              <p>Depending on your location, you may have the right to:</p>
              <ul className="mt-2 list-inside list-disc space-y-1.5">
                <li>Access the personal data we hold about you.</li>
                <li>Request correction of inaccurate data.</li>
                <li>Request deletion of your personal data.</li>
                <li>Object to or restrict certain processing activities.</li>
                <li>Data portability — receive your data in a structured,
                  machine-readable format.</li>
                <li>Withdraw consent where processing is based on consent.</li>
              </ul>
              <p className="mt-3">
                To exercise any of these rights, contact us at{" "}
                <a
                  href="mailto:support@zoikomail.com"
                  className="font-medium text-teal-600 hover:underline dark:text-teal-400"
                >
                  support@zoikomail.com
                </a>
                .
              </p>
            </section>

            {/* 8 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                8. Cookies &amp; Tracking
              </h2>
              <p>
                We use minimal cookies necessary for the Service to function,
                including authentication tokens and session management. We do
                not use cookies for advertising or cross-site tracking. You can
                control cookie settings through your browser, though disabling
                essential cookies may impair the functionality of the Service.
              </p>
            </section>

            {/* 9 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                9. International Data Transfers
              </h2>
              <p>
                Your information may be transferred to and processed in
                countries other than your country of residence. We ensure that
                appropriate safeguards are in place for international transfers,
                including the use of standard contractual clauses or equivalent
                mechanisms where required by applicable law.
              </p>
            </section>

            {/* 10 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                10. Changes to This Policy
              </h2>
              <p>
                We may update this Privacy Policy from time to time. We will
                notify you of any material changes by posting the updated policy
                on this page and updating the &quot;Last updated&quot; date. We
                encourage you to review this policy periodically for any changes.
              </p>
            </section>

            {/* 11 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                11. Contact Us
              </h2>
              <p>
                If you have any questions or concerns about this Privacy Policy
                or our data practices, please contact us at{" "}
                <a
                  href="mailto:support@zoikomail.com"
                  className="font-medium text-teal-600 hover:underline dark:text-teal-400"
                >
                  support@zoikomail.com
                </a>
                .
              </p>
            </section>
          </div>
        </article>
      </div>
    </main>
  );
}
