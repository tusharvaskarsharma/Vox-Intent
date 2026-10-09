import './test-setup';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  detectMismatches,
  isConfirmationAllowed,
  Intent,
  TransactionPreview,
  RiskResult
} from './intent-comparison';

describe('Intent Comparison & Confirmation Guard', () => {
  const validPreview: TransactionPreview = {
    network: 'sepolia',
    asset: 'ETH',
    sender: '0x1234567890123456789012345678901234567890',
    recipient: '0x1D9f6830b29773733411736db3883cBA9a5f93AC',
    amount: '0.05',
    amountEth: '0.05',
    estimatedGas: '21000',
    gasCostEth: '0.000021',
    totalCostEth: '0.050021',
    simulationStatus: 'success'
  };

  const validIntent: Intent = {
    action: 'send_eth',
    amount: '0.05',
    recipient: 'Rahul',
    confidence: 0.98
  };

  const passRisk: RiskResult = {
    verdict: 'PASS',
    reasons: []
  };

  describe('detectMismatches()', () => {
    it('should report no mismatches for an aligned voice request', () => {
      const res = detectMismatches('Send 0.05 ETH to Rahul', validIntent, validPreview);
      assert.strictEqual(res.hasMismatch, false);
      assert.strictEqual(res.discrepancies.length, 0);

      const actionComp = res.comparisons.find(c => c.field === 'Action');
      assert.strictEqual(actionComp?.isMatch, true);

      const assetComp = res.comparisons.find(c => c.field === 'Asset');
      assert.strictEqual(assetComp?.isMatch, true);

      const amountComp = res.comparisons.find(c => c.field === 'Amount');
      assert.strictEqual(amountComp?.isMatch, true);

      const recipientComp = res.comparisons.find(c => c.field === 'Recipient Contact');
      assert.strictEqual(recipientComp?.isMatch, true);
    });

    it('should detect asset mismatch when voice requested USDC but intent was ETH', () => {
      const res = detectMismatches('Send 50 USDC to Rahul', validIntent, validPreview);
      assert.strictEqual(res.hasMismatch, true);
      const assetComp = res.comparisons.find(c => c.field === 'Asset');
      assert.strictEqual(assetComp?.isMatch, false);
      assert.ok(res.discrepancies.some(d => d.includes('Spoken asset')));
    });

    it('should detect amount discrepancy when verbal amount differs from validated amount', () => {
      const res = detectMismatches('Send 5 ETH to Rahul', validIntent, validPreview);
      assert.strictEqual(res.hasMismatch, true);
      const amountComp = res.comparisons.find(c => c.field === 'Amount');
      assert.strictEqual(amountComp?.isMatch, false);
      assert.ok(res.discrepancies.some(d => d.includes('Verbal amount')));
    });

    it('should detect recipient discrepancy when voice contact name differs from resolved contact', () => {
      const res = detectMismatches('Send 0.05 ETH to Bob', validIntent, validPreview);
      assert.strictEqual(res.hasMismatch, true);
      const recComp = res.comparisons.find(c => c.field === 'Recipient Contact');
      assert.strictEqual(recComp?.isMatch, false);
      assert.ok(res.discrepancies.some(d => d.includes('Spoken recipient')));
    });
  });

  describe('isConfirmationAllowed()', () => {
    it('should permit confirmation when all security constraints are met', () => {
      const allowed = isConfirmationAllowed(validIntent, validPreview, passRisk, 'token-uuid-1234', false);
      assert.strictEqual(allowed, true);
    });

    it('should block confirmation when preview is marked as stale', () => {
      const allowed = isConfirmationAllowed(validIntent, validPreview, passRisk, 'token-uuid-1234', true);
      assert.strictEqual(allowed, false);
    });

    it('should block confirmation for read-only balance queries', () => {
      const balanceIntent: Intent = { action: 'balance', confidence: 0.99 };
      const allowed = isConfirmationAllowed(balanceIntent, null, passRisk, null, false);
      assert.strictEqual(allowed, false);
    });

    it('should block confirmation when firewall issued WARN', () => {
      const warnRisk: RiskResult = { verdict: 'WARN', reasons: ['Exceeds 50% balance'] };
      const allowed = isConfirmationAllowed(validIntent, validPreview, warnRisk, 'token-uuid-1234', false);
      assert.strictEqual(allowed, false);
    });

    it('should block confirmation when firewall issued BLOCK', () => {
      const blockRisk: RiskResult = { verdict: 'BLOCK', reasons: ['Unknown contact'] };
      const allowed = isConfirmationAllowed(validIntent, validPreview, blockRisk, 'token-uuid-1234', false);
      assert.strictEqual(allowed, false);
    });

    it('should block confirmation when approvalToken is missing or empty', () => {
      const allowed1 = isConfirmationAllowed(validIntent, validPreview, passRisk, null, false);
      assert.strictEqual(allowed1, false);

      const allowed2 = isConfirmationAllowed(validIntent, validPreview, passRisk, '   ', false);
      assert.strictEqual(allowed2, false);
    });

    it('should block confirmation when EVM simulation failed', () => {
      const failedPreview: TransactionPreview = {
        ...validPreview,
        simulationStatus: 'failed',
        failureReason: 'Execution reverted'
      };
      const allowed = isConfirmationAllowed(validIntent, failedPreview, passRisk, 'token-uuid-1234', false);
      assert.strictEqual(allowed, false);
    });
  });
});
