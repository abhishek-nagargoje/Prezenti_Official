import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { SEO } from '../seo/SEO';
import { StructuredData } from '../seo/StructuredData';
import { SEO_CONSTANTS } from '../seo/constants';

export function PrivacyPolicy() {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);

  return (
    <main className="bg-canvas pt-24 pb-14 sm:pt-28 lg:pb-20">
      <SEO
        title="Privacy Policy | Prezenti & Prezenti Partner Apps"
        description="This Privacy Policy explains how PREZENTI BUSINESS SERVICES PRIVATE LIMITED collects, uses, shares and protects personal information for Prezenti and Prezenti Partner mobile applications."
        canonicalUrl="/privacy-policy"
      />
      <StructuredData
        type="WebPage"
        data={{
          name: 'Privacy Policy',
          description:
            'Privacy Policy for Prezenti (com.prezenti) and Prezenti Partner (com.prezenti.partner) mobile applications operated by PREZENTI BUSINESS SERVICES PRIVATE LIMITED.',
          url: `${SEO_CONSTANTS.BASE_URL}/privacy-policy`,
        }}
      />

      <div className="mx-auto max-w-4xl px-4 sm:px-6">
        <article className="rounded-2xl border border-neutral-200/90 bg-white p-6 shadow-sm sm:p-10 lg:p-12 text-neutral-800 text-base leading-relaxed">
          <header className="border-b border-neutral-100 pb-6 mb-8">
            <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900 sm:text-4xl">
              Privacy Policy
            </h1>
            <p className="mt-2 text-lg font-semibold text-primary-900">
              Prezenti &amp; Prezenti Partner mobile applications
            </p>
            <p className="mt-1 text-sm text-neutral-500">
              Last updated: 9 September 2026
            </p>
          </header>

          <div className="space-y-6 text-[15px] sm:text-base leading-relaxed">
            <p>
              This Privacy Policy explains how <strong>PREZENTI BUSINESS SERVICES PRIVATE LIMITED</strong> (&ldquo;Prezenti&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, shares and protects personal information when you use our mobile applications:
            </p>

            <ul className="list-disc pl-6 space-y-2 text-neutral-700">
              <li>
                <strong>Prezenti</strong> (package <code className="text-sm font-mono bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-800">com.prezenti</code>) &mdash; the customer app, used to book housekeeping and cleaning services.
              </li>
              <li>
                <strong>Prezenti Partner</strong> (package <code className="text-sm font-mono bg-neutral-100 px-1.5 py-0.5 rounded text-neutral-800">com.prezenti.partner</code>) &mdash; the worker app, used by cleaning professionals to receive and complete those jobs.
              </li>
            </ul>

            <p className="font-medium text-neutral-900">
              By using either app you agree to this Policy.
            </p>

            {/* Section 1 */}
            <section className="pt-4 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                1. Information we collect
              </h2>

              <div className="space-y-2.5">
                <h3 className="text-lg font-bold text-neutral-900">
                  a. Account and contact information
                </h3>
                <ul className="list-disc pl-6 space-y-2 text-neutral-700">
                  <li>Your mobile phone number, used to create your account and to sign in with a one-time password (OTP).</li>
                  <li>Your name and, for workers, your service-provider profile details.</li>
                  <li>For a booking: the on-site contact person&rsquo;s name and phone number that the customer enters.</li>
                </ul>
              </div>

              <div className="space-y-3 pt-3">
                <h3 className="text-lg font-bold text-neutral-900">
                  b. Location information
                </h3>

                <div className="rounded-xl border-l-4 border-l-primary-600 border border-primary-100 bg-[#f0f9f5] p-4 text-neutral-800 text-[15px] leading-relaxed">
                  <strong>Both apps access device location. The Prezenti Partner app collects precise location in the background (while the app is closed or not in use) during an active job.</strong> This section describes exactly when and why.
                </div>

                <div className="space-y-3 text-neutral-700">
                  <p>
                    <strong>Prezenti (customer app)</strong> &mdash; with your permission, we use your device&rsquo;s approximate or precise location to:
                  </p>
                  <ul className="list-disc pl-6 space-y-1.5">
                    <li>set or confirm the address where the service is required;</li>
                    <li>show the live location of the assigned professional on a map while your booking is active, so you can see them approaching and know when they will arrive.</li>
                  </ul>

                  <p className="pt-2">
                    <strong>Prezenti Partner (worker app)</strong> &mdash; with your permission, we collect your device&rsquo;s <strong>precise location</strong>, including <strong>in the background &mdash; even when the app is closed or not in use</strong>, in the following situation only:
                  </p>
                  <ul className="list-disc pl-6 space-y-2.5">
                    <li>
                      <strong>When it is collected:</strong> only after you accept a job and tap &ldquo;I&rsquo;m on my way&rdquo;. Collection <strong>stops automatically</strong> as soon as you tap &ldquo;I&rsquo;ve arrived&rdquo;. Location is <strong>not</strong> collected at any other time.
                    </li>
                    <li>
                      <strong>Why background access is needed:</strong> while travelling to the site you will normally have your screen off or another app open, so the location must be shared continuously in the background for live arrival tracking to work.
                    </li>
                    <li>
                      <strong>What we do with it:</strong> your location for that trip is shared with that job&rsquo;s customer so they can track your arrival, and with us to match you to nearby jobs and to record the check-in/check-out location for the job.
                    </li>
                    <li>
                      <strong>Consent:</strong> before any background location is collected, the app shows a clear disclosure screen and starts tracking only if you tap &ldquo;Accept&rdquo;. If you decline, tracking does not start.
                    </li>
                  </ul>
                </div>
              </div>

              <div className="space-y-2.5 pt-3">
                <h3 className="text-lg font-bold text-neutral-900">
                  c. Camera and photos
                </h3>
                <ul className="list-disc pl-6 space-y-2 text-neutral-700">
                  <li>Check-in and check-out selfies taken by the worker at the job site.</li>
                  <li>&ldquo;Before work&rdquo; and &ldquo;after work&rdquo; photos of the serviced area.</li>
                </ul>
                <p className="text-neutral-700">
                  These are uploaded to Prezenti and shown to the customer for that booking.
                </p>
              </div>

              <div className="space-y-2.5 pt-3">
                <h3 className="text-lg font-bold text-neutral-900">
                  d. Booking, transaction and payment information
                </h3>
                <ul className="list-disc pl-6 space-y-2 text-neutral-700">
                  <li>Details of the services you book or perform: date, time slot, site type, amount, status, ratings and feedback.</li>
                  <li>
                    Payments are made by UPI. We receive a transaction reference and status from the payment system. <strong>We do not collect or store card numbers, bank account numbers or UPI PINs.</strong>
                  </li>
                  <li>GST number and registered business name, only if a customer chooses to request a GST tax invoice.</li>
                </ul>
              </div>

              <div className="space-y-2.5 pt-3">
                <h3 className="text-lg font-bold text-neutral-900">
                  e. Device and technical information
                </h3>
                <ul className="list-disc pl-6 space-y-2 text-neutral-700">
                  <li>Device model, operating-system version and app version.</li>
                  <li>A Firebase Cloud Messaging token, used to deliver push notifications about your bookings and jobs.</li>
                  <li>Basic diagnostic and crash information to keep the apps working.</li>
                </ul>
              </div>
            </section>

            {/* Section 2 */}
            <section className="pt-4 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                2. How we use your information
              </h2>
              <ul className="list-disc pl-6 space-y-2 text-neutral-700">
                <li>To create and secure your account and sign you in.</li>
                <li>To create, assign, track and complete bookings.</li>
                <li>To match workers to nearby jobs and share live arrival location with customers.</li>
                <li>To process payments and issue invoices.</li>
                <li>To send booking and job notifications (assignment, arrival, approval, completion).</li>
                <li>To provide customer support and resolve disputes.</li>
                <li>To detect fraud and misuse and to meet legal and tax obligations.</li>
              </ul>
            </section>

            {/* Section 3 */}
            <section className="pt-4 space-y-4">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                3. How we share your information
              </h2>
              <div className="overflow-x-auto rounded-lg border border-neutral-200">
                <table className="min-w-full divide-y divide-neutral-200 text-left text-sm text-neutral-700">
                  <thead className="bg-[#f8faf9] font-semibold text-neutral-900">
                    <tr>
                      <th scope="col" className="px-4 py-3.5 sm:px-6 w-1/3 border-b border-neutral-200 font-semibold">Recipient</th>
                      <th scope="col" className="px-4 py-3.5 sm:px-6 border-b border-neutral-200 font-semibold">What is shared and why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200 bg-white">
                    <tr>
                      <td className="px-4 py-3.5 sm:px-6 font-medium text-neutral-900 align-top">The customer and worker on a booking</td>
                      <td className="px-4 py-3.5 sm:px-6">To deliver the service: the worker sees the site address and the on-site contact number; the customer sees the worker&rsquo;s name, rating and live location while the job is active.</td>
                    </tr>
                    <tr className="bg-neutral-50/50">
                      <td className="px-4 py-3.5 sm:px-6 font-medium text-neutral-900 align-top">Google (Firebase Cloud Messaging, Google Maps Platform)</td>
                      <td className="px-4 py-3.5 sm:px-6">To deliver push notifications and to display maps, routes and estimated arrival times.</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3.5 sm:px-6 font-medium text-neutral-900 align-top">Payment and SMS providers</td>
                      <td className="px-4 py-3.5 sm:px-6">To process UPI payments and to send OTP and transactional SMS.</td>
                    </tr>
                    <tr className="bg-neutral-50/50">
                      <td className="px-4 py-3.5 sm:px-6 font-medium text-neutral-900 align-top">Hosting / infrastructure providers</td>
                      <td className="px-4 py-3.5 sm:px-6">To operate our servers and store data securely.</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-3.5 sm:px-6 font-medium text-neutral-900 align-top">Authorities</td>
                      <td className="px-4 py-3.5 sm:px-6">Where required by law, regulation, legal process or to protect rights and safety.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="font-semibold text-neutral-900 pt-1">
                We do not sell your personal information, and we do not share it for advertising.
              </p>
            </section>

            {/* Section 4 */}
            <section className="pt-4 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                4. Data retention
              </h2>
              <p className="text-neutral-700">
                We keep account and booking records for as long as your account is active and for the period required to meet legal, tax and accounting obligations. Live-location trip data is retained only as long as needed to operate and audit the service and is then deleted or aggregated. Selfies and work photos are retained with the booking record.
              </p>
            </section>

            {/* Section 5 */}
            <section className="pt-4 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                5. Data security
              </h2>
              <p className="text-neutral-700">
                We use access controls, encryption in transit and other technical and organisational measures to protect personal information. No method of transmission or storage is completely secure, but we work to protect your data and to review our practices.
              </p>
            </section>

            {/* Section 6 */}
            <section className="pt-4 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                6. Your rights and choices
              </h2>
              <ul className="list-disc pl-6 space-y-2 text-neutral-700">
                <li>
                  <strong>Location:</strong> you can turn location permission on or off at any time in your device settings. Turning it off will disable live tracking and, for workers, may prevent you from starting jobs.
                </li>
                <li>
                  <strong>Notifications:</strong> you can disable push notifications in your device settings.
                </li>
                <li>
                  <strong>Access and correction:</strong> you can ask us for a copy of your data or to correct it.
                </li>
              </ul>
            </section>

            {/* Section 7 */}
            <section className="pt-4 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                7. Deleting your account and data
              </h2>
              <p className="text-neutral-700">
                You can request deletion of your Prezenti account and associated personal data by emailing{' '}
                <a href="mailto:support@prezenti.com" className="text-primary-800 hover:text-primary-900 underline font-medium">
                  support@prezenti.com
                </a>{' '}
                from your registered address, or by calling{' '}
                <a href="tel:+918788726752" className="text-primary-800 hover:text-primary-900 underline font-bold">
                  +91 8788726752
                </a>
                . We will verify your identity and delete your account and personal data within 30 days, except records we must keep for legal, tax, fraud-prevention or dispute-resolution purposes (for example, invoices), which are retained only for the period the law requires and then deleted.
              </p>
            </section>

            {/* Section 8 */}
            <section className="pt-4 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                8. Children
              </h2>
              <p className="text-neutral-700">
                The apps are intended for adults (18 years and older) and are not directed to children. We do not knowingly collect personal information from children.
              </p>
            </section>

            {/* Section 9 */}
            <section className="pt-4 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                9. Changes to this Policy
              </h2>
              <p className="text-neutral-700">
                We may update this Policy from time to time. The &ldquo;Last updated&rdquo; date at the top shows when it was last changed. Material changes will be notified in the app or by other reasonable means.
              </p>
            </section>

            {/* Section 10 */}
            <section className="pt-4 space-y-3">
              <h2 className="text-xl sm:text-2xl font-bold text-primary-950">
                10. Contact us
              </h2>
              <div className="text-neutral-800 space-y-1">
                <p className="font-semibold text-neutral-900">PREZENTI BUSINESS SERVICES PRIVATE LIMITED</p>
                <p>3rd Floor, 116/3/1/4, Unity Constructions, Baner Road, Baner, Pune, Maharashtra 411045, India</p>
                <p>
                  Email:{' '}
                  <a href="mailto:support@prezenti.com" className="text-primary-800 hover:text-primary-900 underline font-medium">
                    support@prezenti.com
                  </a>
                </p>
                <p>
                  Phone:{' '}
                  <a href="tel:+918788726752" className="text-primary-800 hover:text-primary-900 underline font-medium">
                    +91 8788726752
                  </a>
                </p>
              </div>
            </section>

            <div className="pt-6 border-t border-neutral-100 flex flex-wrap gap-4 text-xs text-neutral-500">
              <Link to="/terms-and-conditions" className="hover:underline">Terms and Conditions</Link>
              <span>&bull;</span>
              <Link to="/refund-policy" className="hover:underline">Refund Policy</Link>
              <span>&bull;</span>
              <Link to="/cancellation-policy" className="hover:underline">Cancellation Policy</Link>
              <span>&bull;</span>
              <Link to="/pricing" className="hover:underline">Pricing &amp; Payment</Link>
            </div>
          </div>
        </article>

        <p className="mt-8 text-center text-xs text-neutral-500">
          &copy; 2026 PREZENTI BUSINESS SERVICES PRIVATE LIMITED. All rights reserved.
        </p>
      </div>
    </main>
  );
}
