import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, PhoneCall, ShieldAlert, XCircle } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { cn } from '../lib/cn';
import { QuoteSummaryPanel } from '../components/inquiry/QuoteSummaryPanel';
import { CallbackRequestPanel, CallbackSuccessState } from '../components/inquiry/CallbackRequestPanel';
import { loadQuoteDraft, type QuoteDraft } from '../modules/inquiry/quoteTypes';
import { initiatePayment } from '../services/paymentApi';
import { SEO } from '../seo/SEO';

type PaymentView = 'form' | 'processing' | 'failure' | 'callback' | 'callback-success';

function MissingQuoteState() {
  return (
    <div className="mx-auto w-full max-w-2xl rounded-lg border border-warning-100 bg-warning-50 p-6 text-center sm:p-8">
      <ShieldAlert size={28} className="mx-auto text-warning-600" aria-hidden="true" />
      <h1 className="mt-3 text-xl font-semibold text-neutral-950">No active quote found</h1>
      <p className="mt-2 text-sm leading-6 text-neutral-600">
        We couldn't find quote details for this payment session. Please start a new quote request.
      </p>
      <Link to="/talk-to-us" className="mt-5 inline-flex items-center justify-center rounded-full bg-primary-800 px-6 py-3 text-sm font-semibold text-white hover:bg-primary-900">
        Start a Quote Request
      </Link>
    </div>
  );
}

export function PaymentDemoPage() {
  const location = useLocation();
  const headingRef = useRef<HTMLHeadingElement>(null);

  const quoteId = (location.state as { quoteId?: string } | null)?.quoteId;
  const [quote] = useState<QuoteDraft | null>(() => loadQuoteDraft(quoteId));

  const [view, setView] = useState<PaymentView>('form');
  const [failureReason, setFailureReason] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    // Skip 'processing': it's a transient in-flight state on the same
    // heading text, not a new view — refocusing it would yank focus away
    // from the submit button right as its label changes to "Processing
    // payment", so that change would likely go unannounced.
    if (view === 'processing') return;
    headingRef.current?.focus();
  }, [view]);

  const maskedReference = useMemo(() => quote?.quoteId ?? '', [quote]);

  if (!quote) {
    return (
      <main className="bg-canvas pt-24 pb-14 sm:pt-28 lg:pb-20">
        <section className="mx-auto max-w-7xl px-4 sm:px-6">
          <MissingQuoteState />
        </section>
      </main>
    );
  }

  const submitPayment = async () => {
    if (isSubmitting) return;

    setIsSubmitting(true);
    setView('processing');

    try {
      const result = await initiatePayment({
        internalReference: quote.quoteId,
        customerEmailID: quote.customer.email,
        customerMobileNo: quote.customer.mobileNumber,
        customerName: quote.customer.fullName,
      });

      if (result.success && result.redirectURI) {
        // The backend guarantees this is a validated HTTPS URL on a
        // confirmed ICICI host (server-selected based on the configured
        // environment) with tranCtx appended — hand off with a plain
        // top-level navigation, no client-side rewriting.
        window.location.href = result.redirectURI;
        return;
      }

      setFailureReason(result.message || 'We could not start your payment. Please try again or ask our team to call you.');
      setView('failure');
      setIsSubmitting(false);
    } catch (error) {
      setFailureReason(
        error instanceof Error ? error.message : 'We could not start your payment. Please try again or ask our team to call you.',
      );
      setView('failure');
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <SEO
        title="Payment | Kargar"
        description="Complete your Kargar service payment securely via ICICI Bank's payment gateway."
        canonicalUrl="/payment-demo"
      />
      <main className="bg-canvas pt-24 pb-14 sm:pt-28 lg:pb-20">
        <section className="mx-auto max-w-3xl px-4 sm:px-6">
          <div className="mb-5 flex items-center justify-center gap-2 rounded-full border border-neutral-200 bg-neutral-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.14em] text-neutral-700">
            <ShieldAlert size={14} aria-hidden="true" />
            Secure Payment via ICICI Bank
          </div>

          {view === 'callback' && (
            <CallbackRequestPanel
              quote={quote}
              headingLevel="h1"
              onBack={() => setView('failure')}
              onSubmitted={() => setView('callback-success')}
            />
          )}

          {view === 'callback-success' && <CallbackSuccessState quote={quote} headingLevel="h1" />}

          {(view === 'form' || view === 'processing') && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-neutral-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-8">
              <div className="flex items-start gap-4 border-b border-neutral-100 pb-6">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-primary-800 text-white">
                  <CreditCard size={20} aria-hidden="true" />
                </span>
                <div>
                  <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-neutral-950 outline-none">
                    Complete Your Payment
                  </h1>
                  <p className="mt-2 max-w-xl text-sm leading-6 text-neutral-600">
                    You'll be redirected to ICICI's secure payment page to complete this transaction. Prezenti never
                    collects or stores your card, expiry, or CVV details.
                  </p>
                </div>
              </div>

              <div className="mt-6">
                <QuoteSummaryPanel quote={quote} headingLevel="h2" />
              </div>

              <div aria-busy={view === 'processing'} className="mt-7 grid gap-5">
                <span role="status" aria-live="polite" className="sr-only">
                  {view === 'processing' ? 'Connecting to the secure payment gateway, please wait.' : ''}
                </span>

                <Button
                  type="button"
                  variant="primary"
                  size="xl"
                  className="mt-2 w-full"
                  isLoading={view === 'processing'}
                  disabled={view === 'processing'}
                  onClick={submitPayment}
                >
                  {view === 'processing' ? 'Connecting to payment gateway' : 'Proceed to Payment'}
                </Button>
                <p className="text-center text-xs text-neutral-400">
                  You will be redirected to ICICI Bank's secure payment page to enter your card details.
                </p>
              </div>
            </motion.div>
          )}

          {view === 'failure' && (
            <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-critical-100 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-8">
              <div className="flex flex-col items-start gap-5 sm:flex-row">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-critical-50 text-critical-600">
                  <XCircle size={26} aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-neutral-950 outline-none">
                    Payment Could Not Be Started
                  </h1>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">
                    {failureReason || 'We could not process your payment.'} Your quote details are still saved, so you
                    can try again or ask the Kargar team to call you instead.
                  </p>
                  <p className="mt-4 text-xs font-semibold uppercase tracking-[0.14em] text-neutral-500">
                    Request Reference: <span className="text-neutral-900">{maskedReference}</span>
                  </p>
                  <div className="mt-6 flex flex-wrap gap-3">
                    <Button type="button" variant="primary" size="lg" onClick={() => setView('form')}>
                      Try Again
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="lg"
                      onClick={() => setView('callback')}
                      className={cn('gap-2')}
                    >
                      <PhoneCall size={16} aria-hidden="true" /> Request a Call Instead
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </section>
      </main>
    </>
  );
}
