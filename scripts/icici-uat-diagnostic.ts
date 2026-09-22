/**
 * Controlled ICICI Orange PG UAT diagnostic.
 *
 * A developer-run script (never wired to public HTTP traffic) that
 * exercises exactly one real Initiate Sale call against ICICI's UAT
 * endpoint, with a redacted preview printed first and an explicit
 * confirmation step required before any network call is attempted.
 *
 * Usage (from repo root, with server-side env vars set — never VITE_*):
 *   npm run icici:uat-diagnostic                                          # prints the preview only
 *   ICICI_UAT_DIAGNOSTIC_CONFIRM=yes npm run icici:uat-diagnostic         # preview + one live UAT call
 *
 * Safety:
 * - getIciciConfig() throws if ICICI_ENV=production — this script cannot
 *   run against production even if misconfigured.
 * - postIciciInitiateSale() independently refuses any non-UAT hostname
 *   (see httpClient.ts assertIciciUatHost), so even a misconfigured
 *   ICICI_INITIATE_SALE_URL cannot reach production through this script.
 * - The ICICI hash key is never printed — this is verified by an
 *   automated test on buildIciciInitiateSalePreview, not just by review.
 * - This diagnostic does NOT touch Supabase/payment_transactions —
 *   it validates the ICICI leg only, independently of the (separately
 *   tracked, unresolved) Supabase project confirmation.
 */

import { getIciciConfig } from '../api/_lib/payments/icici/env';
import { generateIciciMerchantTxnNo } from '../api/_lib/payments/icici/merchantTxnNo';
import { generateIciciTxnDate } from '../api/_lib/payments/icici/txnDate';
import { buildIciciInitiateSaleRequestBody } from '../api/_lib/payments/icici/requestBuilder';
import { buildIciciInitiateSalePreview } from '../api/_lib/payments/icici/redactedPreview';
import { postIciciInitiateSale } from '../api/_lib/payments/icici/httpClient';
import { validateIciciInitiateSaleResponse } from '../api/_lib/payments/icici/initiateSaleResponse';
import { ICICI_UAT_TEST_AMOUNT } from '../api/_lib/payments/icici/initiateSaleService';

async function main() {
  const config = getIciciConfig(); // throws if ICICI_ENV=production, or if required vars are missing

  console.info('[diagnostic] ICICI environment:', config.environment);
  console.info('[diagnostic] Initiate Sale URL:', config.initiateSaleUrl);

  const merchantTxnNo = generateIciciMerchantTxnNo();
  const txnDate = generateIciciTxnDate();

  const transactionInput = {
    merchantTxnNo,
    amount: ICICI_UAT_TEST_AMOUNT,
    txnDate,
    customerEmailID: 'uat-diagnostic@example.com',
    customerMobileNo: '9999999999',
    customerName: 'UAT Diagnostic',
    returnURL: config.returnUrl,
  };

  const requestBody = buildIciciInitiateSaleRequestBody(transactionInput, config);
  const preview = buildIciciInitiateSalePreview(requestBody, config.initiateSaleUrl);

  console.info('\n=== REDACTED REQUEST PREVIEW (no hash key, no full customer PII) ===');
  console.info(JSON.stringify(preview, null, 2));
  console.info('hashKeyIncluded:', preview.hashKeyIncluded, '(must always be false)');

  const confirmed = process.env.ICICI_UAT_DIAGNOSTIC_CONFIRM === 'yes';
  if (!confirmed) {
    console.info(
      '\nPreview only — no network call was made. Set ICICI_UAT_DIAGNOSTIC_CONFIRM=yes to make ONE real UAT ' +
        'Initiate Sale call using this exact request.',
    );
    return;
  }

  console.info('\n=== MAKING ONE LIVE UAT INITIATE SALE CALL ===');
  const httpResult = await postIciciInitiateSale(config.initiateSaleUrl, requestBody);

  console.info('HTTP status:', httpResult.httpStatus);
  if (!httpResult.body) {
    console.info('Response body could not be parsed as JSON. parseError:', httpResult.parseError);
    return;
  }

  console.info('ICICI response body:', httpResult.body);

  const validation = validateIciciInitiateSaleResponse(httpResult.body, {
    merchantId: config.merchantId,
    aggregatorID: config.aggregatorId,
    merchantTxnNo,
  });

  console.info('\n=== VALIDATION RESULT (initiation only — NOT payment completion) ===');
  console.info('initiationAccepted:', validation.initiationAccepted);
  console.info('redirectURI:', validation.redirectURI);
  console.info('tranCtx:', validation.tranCtx);
  console.info('merchantTxnNo:', merchantTxnNo);
  if (validation.errors.length > 0) {
    console.info('errors:', validation.errors);
  }
  console.info(
    '\nNOTE: this diagnostic did NOT persist anything to the database. Wire this into ' +
      'initiateIciciPayment()/the /api/payments/icici/initiate route for real transactions.',
  );
}

main().catch((error) => {
  console.error('[diagnostic] failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
