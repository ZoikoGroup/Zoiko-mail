import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
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
            Terms of Service
          </h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
            Last updated: August 27, 2026
          </p>

          <div className="mt-8 space-y-8 text-sm leading-7 text-slate-600 dark:text-slate-300">
            {/* 1 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                1. Acceptance of Terms
              </h2>
              <p>
                By accessing or using Zoiko Mail (&quot;the Service&quot;), you
                agree to be bound by these Terms of Service (&quot;Terms&quot;).
                If you do not agree to all of these Terms, you may not access or
                use the Service. These Terms constitute a legally binding
                agreement between you and Zoiko Mail.
              </p>
            </section>

            {/* 2 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                2. Description of Service
              </h2>
              <p>
                Zoiko Mail is a business email and communication management
                platform that turns communication into accountable work. The
                Service provides features including but not limited to email
                management, inbox organization, team collaboration tools,
                commitment tracking, and integration with third-party email
                providers.
              </p>
            </section>

            {/* 3 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                3. User Accounts &amp; Responsibilities
              </h2>
              <ul className="mt-2 list-inside list-disc space-y-1.5">
                <li>
                  You must provide accurate, current, and complete information
                  during registration and keep your account information up to
                  date.
                </li>
                <li>
                  You are responsible for safeguarding your password and all
                  activities that occur under your account.
                </li>
                <li>
                  You must notify Zoiko Mail immediately of any unauthorized use
                  of your account.
                </li>
                <li>
                  You may not share your account credentials with others or
                  allow multiple users to access the Service through a single
                  account.
                </li>
                <li>
                  You are responsible for all content sent, received, or managed
                  through your account.
                </li>
              </ul>
            </section>

            {/* 4 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                4. Acceptable Use
              </h2>
              <p>You agree not to use the Service to:</p>
              <ul className="mt-2 list-inside list-disc space-y-1.5">
                <li>
                  Send unsolicited bulk email (spam) or communications that
                  violate any applicable law or regulation.
                </li>
                <li>
                  Phish, impersonate any person or entity, or otherwise deceive
                  recipients.
                </li>
                <li>
                  Upload or transmit malware, viruses, or other harmful code.
                </li>
                <li>
                  Attempt to gain unauthorized access to any part of the Service
                  or its related systems.
                </li>
                <li>
                  Interfere with or disrupt the integrity or performance of the
                  Service.
                </li>
                <li>
                  Harvest, collect, or scrape user information without consent.
                </li>
              </ul>
            </section>

            {/* 5 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                5. Intellectual Property
              </h2>
              <p>
                The Service and its original content, features, and functionality
                are owned by Zoiko Mail and are protected by international
                copyright, trademark, patent, trade secret, and other
                intellectual property laws. You may not modify, reproduce,
                distribute, create derivative works of, publicly display, or
                exploit any content from the Service without prior written
                permission.
              </p>
            </section>

            {/* 6 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                6. Data &amp; Privacy
              </h2>
              <p>
                Your use of the Service is also governed by our{" "}
                <Link
                  href="/privacy"
                  className="font-medium text-teal-600 hover:underline dark:text-teal-400"
                >
                  Privacy Policy
                </Link>
                , which describes how we collect, use, store, and share your
                personal information. By using the Service, you consent to the
                data practices described in the Privacy Policy.
              </p>
            </section>

            {/* 7 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                7. Third-Party Integrations
              </h2>
              <p>
                The Service may integrate with or provide access to third-party
                services (such as email providers). Your use of such third-party
                services is subject to their respective terms and policies. Zoiko
                Mail is not responsible for the availability, accuracy, or
                practices of third-party services.
              </p>
            </section>

            {/* 8 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                8. Termination
              </h2>
              <p>
                We may suspend or terminate your access to the Service at any
                time, with or without cause, and with or without notice.
                Upon termination, your right to use the Service ceases
                immediately. You may also terminate your account at any time by
                contacting our support team. Provisions that by their nature
                should survive termination will remain in effect, including
                ownership provisions, warranty disclaimers, and limitations of
                liability.
              </p>
            </section>

            {/* 9 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                9. Limitation of Liability
              </h2>
              <p>
                To the maximum extent permitted by applicable law, Zoiko Mail
                shall not be liable for any indirect, incidental, special,
                consequential, or punitive damages, or any loss of profits or
                revenue, whether incurred directly or indirectly, or any loss of
                data, use, goodwill, or other intangible losses resulting from
                your use of the Service.
              </p>
            </section>

            {/* 10 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                10. Changes to Terms
              </h2>
              <p>
                We reserve the right to modify these Terms at any time. We will
                notify you of any material changes by posting the updated Terms
                on this page and updating the &quot;Last updated&quot; date.
                Your continued use of the Service after any changes constitutes
                acceptance of the new Terms.
              </p>
            </section>

            {/* 11 */}
            <section>
              <h2 className="mb-2 text-lg font-semibold text-slate-900 dark:text-white">
                11. Contact Us
              </h2>
              <p>
                If you have any questions about these Terms, please contact us
                at{" "}
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
