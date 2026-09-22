import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Clock, Loader2, ShieldAlert, XCircle } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '../components/ui/Button';
import { getPaymentStatus, type PaymentStatusResponse } from '../services/paymentApi';
import { SEO } from '../seo/SEO';

type PageState = 'missing-reference' | 'loading' | 'error' | 'result';

type TransactionStatus = NonNullable<PaymentStatusResponse['transaction']>['status'];

interface StatusPresentation {
  icon: typeof CheckCircle2;
  iconWrapperClass: string;
  iconClass: string;
  borderClass: string;
  heading: string;
  description: string;
}

function presentationForStatus(status: TransactionStatus, responseDescription?: string): StatusPresentation {
  switch (status) {
    case 'SUCCESS':
      return {
        icon: CheckCircle2,
        iconWrapperClass: 'bg-success-50 text-success-600',
        borderClass: 'border-success-100',
        iconClass: '',
        heading: 'Payment Confirmed',
        description: 'Thank you. Your payment has been confirmed and our team has been notified to begin processing your request.',
      };
    case 'FAILED':
      return {
        icon: XCircle,
        iconWrapperClass: 'bg-critical-50 text-critical-600',
        borderClass: 'border-critical-100',
        iconClass: '',
        heading: 'Payment Failed',
        description: responseDescription || 'Your payment attempt was not successful. Please try again or contact our team.',
      };
    case 'CANCELLED':
      return {
        icon: XCircle,
        iconWrapperClass: 'bg-warning-50 text-warning-600',
        borderClass: 'border-warning-100',
        iconClass: '',
        heading: 'Payment Cancelled',
        description: 'It looks like you cancelled the payment before it was completed. You can try again whenever you are ready.',
      };
    case 'EXPIRED':
      return {
        icon: Clock,
        iconWrapperClass: 'bg-warning-50 text-warning-600',
        borderClass: 'border-warning-100',
        iconClass: '',
        heading: 'Payment Session Expired',
        description: 'Your payment session timed out before it was completed. Please start a new payment.',
      };
    case 'PENDING':
      return {
        icon: Loader2,
        iconWrapperClass: 'bg-primary-50 text-primary-700',
        borderClass: 'border-primary-100',
        iconClass: 'animate-spin',
        heading: 'Payment Still Processing',
        description: 'Your payment is still being processed by the bank. This can take a few minutes — please check back shortly.',
      };
    case 'INITIATED':
      return {
        icon: Clock,
        iconWrapperClass: 'bg-primary-50 text-primary-700',
        borderClass: 'border-primary-100',
        iconClass: '',
        heading: 'Payment Being Processed',
        description: "Your payment is being processed — we'll confirm the outcome shortly. This page does not yet show a final result, so please check back in a few minutes or contact us if you don't hear from us soon.",
      };
    case 'UNKNOWN':
    default:
      return {
        icon: AlertTriangle,
        iconWrapperClass: 'bg-warning-50 text-warning-600',
        borderClass: 'border-warning-100',
        iconClass: '',
        heading: 'Outcome Not Yet Determined',
        description: "We couldn't determine the outcome of your payment yet. Please check back shortly, or contact our team if this persists.",
      };
  }
}

export function PaymentResultPage() {
  const [searchParams] = useSearchParams();
  const merchantTxnNo = searchParams.get('merchantTxnNo');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const [pageState, setPageState] = useState<PageState>(merchantTxnNo ? 'loading' : 'missing-reference');
  const [transaction, setTransaction] = useState<PaymentStatusResponse['transaction'] | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, []);

  useEffect(() => {
    headingRef.current?.focus();
  }, [pageState]);

  const fetchStatus = useCallback(async () => {
    if (!merchantTxnNo) return;

    setIsRefreshing(true);
    try {
      const result = await getPaymentStatus(merchantTxnNo);

      if (!result.success || !result.transaction) {
        setErrorMessage(result.message || "We couldn't retrieve your payment status. Please try again.");
        setPageState('error');
        return;
      }

      setTransaction(result.transaction);
      setPageState('result');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "We couldn't retrieve your payment status. Please try again.",
      );
      setPageState('error');
    } finally {
      setIsRefreshing(false);
    }
  }, [merchantTxnNo]);

  useEffect(() => {
    if (!merchantTxnNo) return;
    void fetchStatus();
    // Only run on mount / when the reference changes — refresh is manual otherwise.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantTxnNo]);

  return (
    <>
      <SEO
        title="Payment Status | Kargar"
        description="Check the status of your Kargar service payment."
        canonicalUrl="/payment/result"
        noindex
      />
      <main className="bg-canvas pt-24 pb-14 sm:pt-28 lg:pb-20">
        <section className="mx-auto max-w-3xl px-4 sm:px-6">
          <span role="status" aria-live="polite" className="sr-only">
            {pageState === 'loading' || isRefreshing ? 'Checking your payment status, please wait.' : ''}
          </span>

          {pageState === 'missing-reference' && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-warning-100 bg-white p-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-8">
              <ShieldAlert size={28} className="mx-auto text-warning-600" aria-hidden="true" />
              <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-xl font-semibold text-neutral-950 outline-none">
                Missing Payment Reference
              </h1>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-600">
                We couldn't find a payment reference in this link, so we're unable to look up a status. If you just
                completed a payment, please check your email for confirmation or contact our team.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Link to="/talk-to-us" className="inline-flex items-center justify-center rounded-full bg-primary-800 px-6 py-3 text-sm font-semibold text-white hover:bg-primary-900">
                  Contact Us
                </Link>
                <Link to="/" className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-6 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
                  Back to Home
                </Link>
              </div>
            </motion.div>
          )}

          {pageState === 'loading' && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-neutral-200 bg-white p-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-8">
              <Loader2 size={28} className="mx-auto animate-spin text-primary-700" aria-hidden="true" />
              <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-xl font-semibold text-neutral-950 outline-none">
                Checking Your Payment Status
              </h1>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-600">
                Please wait while we check with our payment partner.
              </p>
            </motion.div>
          )}

          {pageState === 'error' && (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="rounded-lg border border-warning-100 bg-white p-6 text-center shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-8">
              <AlertTriangle size={28} className="mx-auto text-warning-600" aria-hidden="true" />
              <h1 ref={headingRef} tabIndex={-1} className="mt-3 text-xl font-semibold text-neutral-950 outline-none">
                Couldn't Retrieve Payment Status
              </h1>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-neutral-600">
                {errorMessage || "We couldn't retrieve your payment status. Please try again."}
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <Button type="button" variant="primary" size="lg" isLoading={isRefreshing} onClick={() => void fetchStatus()}>
                  Retry
                </Button>
                <Link to="/talk-to-us" className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-6 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
                  Request a Call Instead
                </Link>
              </div>
            </motion.div>
          )}

          {pageState === 'result' && transaction && (() => {
            const presentation = presentationForStatus(transaction.status, transaction.responseDescription);
            const Icon = presentation.icon;
            return (
              <motion.div
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                className={`rounded-lg border ${presentation.borderClass} bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)] sm:p-8`}
              >
                <div className="flex flex-col items-start gap-5 sm:flex-row">
                  <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg ${presentation.iconWrapperClass}`}>
                    <Icon size={26} className={presentation.iconClass} aria-hidden="true" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h1 ref={headingRef} tabIndex={-1} className="text-2xl font-semibold tracking-tight text-neutral-950 outline-none">
                      {presentation.heading}
                    </h1>
                    <p className="mt-2 max-w-2xl text-sm leading-6 text-neutral-600">{presentation.description}</p>

                    <dl className="mt-4 grid gap-x-6 gap-y-2 text-xs font-semibold uppercase tracking-[0.1em] text-neutral-500 sm:grid-cols-2">
                      <div>
                        <dt className="inline">Reference: </dt>
                        <dd className="inline text-neutral-900 normal-case tracking-normal">{transaction.merchantTxnNo}</dd>
                      </div>
                      {transaction.amount && (
                        <div>
                          <dt className="inline">Amount: </dt>
                          <dd className="inline text-neutral-900 normal-case tracking-normal">
                            {transaction.amount} {transaction.currency}
                          </dd>
                        </div>
                      )}
                      {transaction.paymentMode && (
                        <div>
                          <dt className="inline">Payment Mode: </dt>
                          <dd className="inline text-neutral-900 normal-case tracking-normal">{transaction.paymentMode}</dd>
                        </div>
                      )}
                      {transaction.paymentDatetime && (
                        <div>
                          <dt className="inline">Date: </dt>
                          <dd className="inline text-neutral-900 normal-case tracking-normal">{transaction.paymentDatetime}</dd>
                        </div>
                      )}
                    </dl>

                    <div className="mt-6 flex flex-wrap gap-3">
                      <Button type="button" variant="secondary" size="lg" isLoading={isRefreshing} onClick={() => void fetchStatus()}>
                        Refresh Status
                      </Button>
                      <Link to="/" className="inline-flex items-center justify-center rounded-full border border-neutral-200 px-6 py-3 text-sm font-semibold text-neutral-700 hover:bg-neutral-50">
                        Back to Home
                      </Link>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })()}
        </section>
      </main>
    </>
  );
}
