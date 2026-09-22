import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createSupabasePaymentTransactionRepository } from './repository';
import type { IciciInitiateSaleTransactionInput } from './requestBuilder';

const TRANSACTION_INPUT: IciciInitiateSaleTransactionInput = {
  merchantTxnNo: 'PZ123ABC',
  amount: '2.00',
  txnDate: '20241121115413',
  customerEmailID: 'customer@example.com',
  customerMobileNo: '919876543210',
  customerName: 'Test Customer',
  returnURL: 'https://prezenti.com/api/payments/icici/return',
};

function createMockSupabaseClient(
  insertResult: { error: unknown },
  updateResult: { error: unknown },
  selectResult: { data: unknown; error: unknown } = { data: null, error: null },
  rpcResult: { error: unknown } = { error: null },
) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const eq = vi.fn().mockReturnValue({
    // eq() is used both as a terminal call (update chain) and to continue
    // chaining before maybeSingle() (select chain) — mock supports both.
    ...updateResult,
    then: (resolve: (value: typeof updateResult) => void) => resolve(updateResult),
    maybeSingle: vi.fn().mockResolvedValue(selectResult),
  });
  const update = vi.fn().mockReturnValue({ eq });
  const select = vi.fn().mockReturnValue({ eq });
  const from = vi.fn().mockReturnValue({ insert, update, select });
  const rpc = vi.fn().mockResolvedValue(rpcResult);

  return { client: { from, rpc } as unknown as SupabaseClient, insert, update, select, eq, from, rpc };
}

describe('createSupabasePaymentTransactionRepository', () => {
  describe('createInitiatedTransaction', () => {
    it('inserts a row into payment_transactions with status INITIATED', async () => {
      const { client, insert, from } = createMockSupabaseClient({ error: null }, { error: null });
      const repo = createSupabasePaymentTransactionRepository(client);

      await repo.createInitiatedTransaction({
        merchantTxnNo: 'PZ123ABC',
        amount: '2.00',
        currencyCode: '356',
        internalReference: 'QUOTE-001',
        transactionInput: TRANSACTION_INPUT,
      });

      expect(from).toHaveBeenCalledWith('payment_transactions');
      expect(insert).toHaveBeenCalledWith(
        expect.objectContaining({
          merchant_txn_no: 'PZ123ABC',
          status: 'INITIATED',
          amount: '2.00',
          currency: '356',
          internal_reference: 'QUOTE-001',
        }),
      );
    });

    it('never includes any ICICI hash key or Supabase secret in the inserted row', async () => {
      const { client, insert } = createMockSupabaseClient({ error: null }, { error: null });
      const repo = createSupabasePaymentTransactionRepository(client);

      await repo.createInitiatedTransaction({
        merchantTxnNo: 'PZ123ABC',
        amount: '2.00',
        currencyCode: '356',
        internalReference: 'QUOTE-001',
        transactionInput: TRANSACTION_INPUT,
      });

      const insertedRow = insert.mock.calls[0][0];
      expect(Object.keys(insertedRow)).not.toContain('hashKey');
      expect(Object.keys(insertedRow)).not.toContain('secureHash');
    });

    it('throws a descriptive error when the insert fails', async () => {
      const { client } = createMockSupabaseClient({ error: { message: 'unique_violation' } }, { error: null });
      const repo = createSupabasePaymentTransactionRepository(client);

      await expect(
        repo.createInitiatedTransaction({
          merchantTxnNo: 'PZ123ABC',
          amount: '2.00',
          currencyCode: '356',
          internalReference: 'QUOTE-001',
          transactionInput: TRANSACTION_INPUT,
        }),
      ).rejects.toThrow(/unique_violation/);
    });
  });

  describe('recordInitiateSaleOutcome', () => {
    it('updates the row matching merchant_txn_no', async () => {
      const { client, update, eq, from } = createMockSupabaseClient({ error: null }, { error: null });
      const repo = createSupabasePaymentTransactionRepository(client);

      await repo.recordInitiateSaleOutcome({
        merchantTxnNo: 'PZ123ABC',
        status: 'INITIATED',
        responseCode: 'R1000',
        tranCtx: 'ctx-abc',
        rawInitiateResponse: { responseCode: 'R1000' },
      });

      expect(from).toHaveBeenCalledWith('payment_transactions');
      expect(update).toHaveBeenCalledWith(expect.objectContaining({ status: 'INITIATED', tran_ctx: 'ctx-abc' }));
      expect(eq).toHaveBeenCalledWith('merchant_txn_no', 'PZ123ABC');
    });

    it('throws a descriptive error when the update fails', async () => {
      const { client } = createMockSupabaseClient({ error: null }, { error: { message: 'row not found' } });
      const repo = createSupabasePaymentTransactionRepository(client);

      await expect(
        repo.recordInitiateSaleOutcome({
          merchantTxnNo: 'PZ123ABC',
          status: 'UNKNOWN',
          rawInitiateResponse: {},
        }),
      ).rejects.toThrow(/row not found/);
    });
  });

  describe('getPublicStatusByMerchantTxnNo', () => {
    it('returns only safe fields for an existing transaction', async () => {
      const { client, select, eq } = createMockSupabaseClient(
        { error: null },
        { error: null },
        {
          data: {
            merchant_txn_no: 'PZ123ABC',
            status: 'INITIATED',
            amount: '2.00',
            currency: '356',
            response_description: null,
            payment_mode: null,
            payment_datetime: null,
          },
          error: null,
        },
      );
      const repo = createSupabasePaymentTransactionRepository(client);

      const result = await repo.getPublicStatusByMerchantTxnNo('PZ123ABC');

      expect(select).toHaveBeenCalled();
      expect(eq).toHaveBeenCalledWith('merchant_txn_no', 'PZ123ABC');
      expect(result).toEqual({
        merchantTxnNo: 'PZ123ABC',
        status: 'INITIATED',
        amount: '2.00',
        currency: '356',
        responseDescription: undefined,
        paymentMode: undefined,
        paymentDatetime: undefined,
      });
    });

    it('returns null for an unknown merchantTxnNo rather than throwing', async () => {
      const { client } = createMockSupabaseClient({ error: null }, { error: null }, { data: null, error: null });
      const repo = createSupabasePaymentTransactionRepository(client);

      const result = await repo.getPublicStatusByMerchantTxnNo('DOES-NOT-EXIST');
      expect(result).toBeNull();
    });

    it('never returns internal id, raw gateway payload, or any secret field', async () => {
      const { client } = createMockSupabaseClient(
        { error: null },
        { error: null },
        {
          data: {
            merchant_txn_no: 'PZ123ABC',
            status: 'SUCCESS',
            amount: '2.00',
            currency: '356',
            response_description: 'successful',
            payment_mode: 'UPI',
            payment_datetime: '2024-11-21T11:54:13Z',
          },
          error: null,
        },
      );
      const repo = createSupabasePaymentTransactionRepository(client);

      const result = await repo.getPublicStatusByMerchantTxnNo('PZ123ABC');

      expect(Object.keys(result!).sort()).toEqual(
        ['amount', 'currency', 'merchantTxnNo', 'paymentDatetime', 'paymentMode', 'responseDescription', 'status'].sort(),
      );
    });

    it('throws a descriptive error when the lookup fails', async () => {
      const { client } = createMockSupabaseClient(
        { error: null },
        { error: null },
        { data: null, error: { message: 'connection refused' } },
      );
      const repo = createSupabasePaymentTransactionRepository(client);

      await expect(repo.getPublicStatusByMerchantTxnNo('PZ123ABC')).rejects.toThrow(/connection refused/);
    });
  });

  describe('recordCallback', () => {
    it('calls the atomic record_payment_callback RPC (an UPDATE, never an INSERT)', async () => {
      const { client, rpc, insert } = createMockSupabaseClient({ error: null }, { error: null });
      const repo = createSupabasePaymentTransactionRepository(client);

      await repo.recordCallback({
        merchantTxnNo: 'PZ123ABC',
        status: 'UNKNOWN',
        rawCallbackPayload: { responseCode: '0000' },
      });

      expect(rpc).toHaveBeenCalledWith('record_payment_callback', {
        p_merchant_txn_no: 'PZ123ABC',
        p_status: 'UNKNOWN',
        p_raw_callback_payload: { responseCode: '0000' },
        p_provider_transaction_id: null,
        p_provider_payment_id: null,
        p_response_code: null,
        p_response_description: null,
        p_payment_mode: null,
        p_payment_datetime: null,
      });
      // recordCallback must never call insert() — a repeated callback for
      // the same transaction can never create a second row.
      expect(insert).not.toHaveBeenCalled();
    });

    it('passes through provider identifiers and response metadata when given', async () => {
      const { client, rpc } = createMockSupabaseClient({ error: null }, { error: null });
      const repo = createSupabasePaymentTransactionRepository(client);

      await repo.recordCallback({
        merchantTxnNo: 'PZ123ABC',
        status: 'SUCCESS',
        rawCallbackPayload: { responseCode: '0000' },
        providerTransactionId: 'T1472640294491',
        providerPaymentId: '006503',
        responseCode: '0000',
        responseDescription: 'SUCCESS',
        paymentMode: 'UPI',
        paymentDatetime: '2024-11-21T11:54:13+05:30',
      });

      expect(rpc).toHaveBeenCalledWith('record_payment_callback', {
        p_merchant_txn_no: 'PZ123ABC',
        p_status: 'SUCCESS',
        p_raw_callback_payload: { responseCode: '0000' },
        p_provider_transaction_id: 'T1472640294491',
        p_provider_payment_id: '006503',
        p_response_code: '0000',
        p_response_description: 'SUCCESS',
        p_payment_mode: 'UPI',
        p_payment_datetime: '2024-11-21T11:54:13+05:30',
      });
    });

    it('throws a descriptive error when the RPC fails', async () => {
      const { client } = createMockSupabaseClient(
        { error: null },
        { error: null },
        { data: null, error: null },
        { error: { message: 'function not found' } },
      );
      const repo = createSupabasePaymentTransactionRepository(client);

      await expect(
        repo.recordCallback({ merchantTxnNo: 'PZ123ABC', status: 'UNKNOWN', rawCallbackPayload: {} }),
      ).rejects.toThrow(/function not found/);
    });
  });
});
