/**
 * Persistence for ICICI payment transactions, against the
 * `payment_transactions` table (supabase/migrations/20260921040414_create_payment_transactions.sql).
 *
 * Server-side only: uses the Supabase secret key, which bypasses
 * Row Level Security — this module must never be imported by frontend
 * code, and `SUPABASE_SECRET_KEY` is never logged.
 *
 * Confirmed against the live Prezenti Supabase project (mbvxqywodlartkfwbgxd):
 * `payment_transactions`, `record_payment_callback`, the updated_at
 * trigger, indexes, and RLS were created directly via Supabase MCP SQL
 * (no migration tooling) and verified live, then exercised against the
 * real database through this repository's functions.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { IciciInitiateSaleTransactionInput } from './requestBuilder.js';

export type PaymentTransactionStatus =
  | 'INITIATED'
  | 'PENDING'
  | 'SUCCESS'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'UNKNOWN';

export interface CreateInitiatedTransactionInput {
  merchantTxnNo: string;
  amount: string;
  currencyCode: string;
  internalReference: string;
  transactionInput: IciciInitiateSaleTransactionInput;
}

export interface RecordInitiateSaleOutcomeInput {
  merchantTxnNo: string;
  status: PaymentTransactionStatus;
  responseCode?: string;
  responseDescription?: string;
  tranCtx?: string;
  rawInitiateResponse: unknown;
}

/** Only these fields are ever safe to hand to the frontend result page — never the internal id, hash key, or raw gateway payload. */
export interface PublicPaymentTransactionStatus {
  merchantTxnNo: string;
  status: PaymentTransactionStatus;
  amount: string;
  currency: string;
  responseDescription?: string;
  paymentMode?: string;
  paymentDatetime?: string;
}

export interface RecordCallbackInput {
  merchantTxnNo: string;
  status: PaymentTransactionStatus;
  rawCallbackPayload: unknown;
  /** Bank-assigned transaction ID (e.g. `txnID`) — carries the real idempotency guarantee via the DB's partial unique index. */
  providerTransactionId?: string;
  /** Bank-assigned payment ID (e.g. `paymentID`) — same idempotency purpose as above. */
  providerPaymentId?: string;
  responseCode?: string;
  responseDescription?: string;
  paymentMode?: string;
  /** ISO 8601 / timestamptz-parseable string — caller is responsible for converting the bank's `paymentDateTime` (yyyyMMddHHmmss) format. */
  paymentDatetime?: string;
}

/** Persistence boundary for payment transactions — implementations are swappable for testing. */
export interface PaymentTransactionRepository {
  createInitiatedTransaction(input: CreateInitiatedTransactionInput): Promise<void>;
  recordInitiateSaleOutcome(input: RecordInitiateSaleOutcomeInput): Promise<void>;
  /** Read-only lookup by the public merchantTxnNo reference, for the frontend result page. Returns null if not found. */
  getPublicStatusByMerchantTxnNo(merchantTxnNo: string): Promise<PublicPaymentTransactionStatus | null>;
  /**
   * Records receipt of a return/callback idempotently: always an UPDATE
   * against the existing row (never an INSERT), so a repeated callback
   * for the same merchantTxnNo can never create a second transaction.
   * `callback_received_count`/`last_callback_at` are updated atomically
   * via the `record_payment_callback` SQL function.
   */
  recordCallback(input: RecordCallbackInput): Promise<void>;
}

/**
 * Supabase-backed implementation. Constructed with an already-configured
 * client so this module never reads environment variables itself — see
 * `createSupabaseClientFromEnv` below for the one place that happens.
 */
export function createSupabasePaymentTransactionRepository(client: SupabaseClient): PaymentTransactionRepository {
  return {
    async createInitiatedTransaction(input) {
      const { error } = await client.from('payment_transactions').insert({
        merchant_txn_no: input.merchantTxnNo,
        provider: 'icici_orange_pg',
        amount: input.amount,
        currency: input.currencyCode,
        internal_reference: input.internalReference,
        customer_name: input.transactionInput.customerName,
        customer_email: input.transactionInput.customerEmailID,
        customer_mobile: input.transactionInput.customerMobileNo,
        return_url: input.transactionInput.returnURL,
        addl_param1: input.transactionInput.addlParam1 ?? '',
        addl_param2: input.transactionInput.addlParam2 ?? '',
        status: 'INITIATED',
      });

      if (error) {
        throw new Error(`Failed to persist initiated payment transaction: ${error.message}`);
      }
    },

    async recordInitiateSaleOutcome(input) {
      const { error } = await client
        .from('payment_transactions')
        .update({
          status: input.status,
          tran_ctx: input.tranCtx,
          response_code: input.responseCode,
          response_description: input.responseDescription,
          raw_initiate_response: input.rawInitiateResponse,
        })
        .eq('merchant_txn_no', input.merchantTxnNo);

      if (error) {
        throw new Error(`Failed to record Initiate Sale outcome: ${error.message}`);
      }
    },

    async getPublicStatusByMerchantTxnNo(merchantTxnNo) {
      const { data, error } = await client
        .from('payment_transactions')
        .select('merchant_txn_no, status, amount, currency, response_description, payment_mode, payment_datetime')
        .eq('merchant_txn_no', merchantTxnNo)
        .maybeSingle();

      if (error) {
        throw new Error(`Failed to look up payment transaction status: ${error.message}`);
      }
      if (!data) return null;

      return {
        merchantTxnNo: data.merchant_txn_no,
        status: data.status,
        amount: data.amount,
        currency: data.currency,
        responseDescription: data.response_description ?? undefined,
        paymentMode: data.payment_mode ?? undefined,
        paymentDatetime: data.payment_datetime ?? undefined,
      };
    },

    async recordCallback(input) {
      const { error } = await client.rpc('record_payment_callback', {
        p_merchant_txn_no: input.merchantTxnNo,
        p_status: input.status,
        p_raw_callback_payload: input.rawCallbackPayload,
        p_provider_transaction_id: input.providerTransactionId ?? null,
        p_provider_payment_id: input.providerPaymentId ?? null,
        p_response_code: input.responseCode ?? null,
        p_response_description: input.responseDescription ?? null,
        p_payment_mode: input.paymentMode ?? null,
        p_payment_datetime: input.paymentDatetime ?? null,
      });

      if (error) {
        throw new Error(`Failed to record payment callback: ${error.message}`);
      }
    },
  };
}

/**
 * Reads SUPABASE_URL and SUPABASE_SECRET_KEY from process.env and
 * constructs a privileged, RLS-bypassing Supabase client. Server-side
 * only — throws if either is absent rather than silently falling back
 * to the publishable/anon key. Reuses the existing VITE_SUPABASE_URL
 * value (a public, non-secret project URL) if a dedicated server-side
 * SUPABASE_URL is not set, to avoid a redundant duplicate env var.
 *
 * SUPABASE_SECRET_KEY is the current Supabase secret-key convention
 * (paired with the publishable key used client-side). SUPABASE_SERVICE_ROLE_KEY
 * is accepted as a legacy fallback for projects still issuing the older
 * JWT-format service_role key.
 */
export function createSupabaseClientFromEnv(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) {
    throw new Error('Missing required environment variable: SUPABASE_URL (or VITE_SUPABASE_URL)');
  }
  if (!secretKey) {
    throw new Error('Missing required environment variable: SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY)');
  }

  return createClient(url, secretKey, { auth: { persistSession: false } });
}
