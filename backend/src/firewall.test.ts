import { describe, it } from 'node:test';
import assert from 'node:assert';
import { evaluateRisk, FirewallConfig } from './firewall';
import { SendIntent } from './intent';
import { TransactionPreview } from './blockchain';

describe('VoxIntent Intent Firewall', () => {
  const config: FirewallConfig = {
    confidenceThreshold: 0.9,
    maxBalancePercentageThreshold: 0.5 // 50%
  };

  const validIntent: SendIntent = { action: 'send', amount: 1, confidence: 0.95, recipient: 'Rahul' };
  const validResolved = '0x1D9f6830b29773733411736db3883cBA9a5f93AC';
  const validPreview: TransactionPreview = {
    network: 'sepolia',
    sender: '0xsender',
    recipient: validResolved,
    amountEth: '1',
    estimatedGas: '21000',
    totalCostEth: '1.000000000000021',
    simulationStatus: 'success'
  };
  const validBalance = '10';

  it('should PASS when all conditions are met', () => {
    const result = evaluateRisk(validIntent, validResolved, validPreview, validBalance, config);
    assert.strictEqual(result.verdict, 'PASS');
    assert.strictEqual(result.reasons.length, 0);
  });

  // BLOCK CONDITIONS
  it('should BLOCK if recipient is unknown or unresolved', () => {
    const result = evaluateRisk(validIntent, undefined, validPreview, validBalance, config);
    assert.strictEqual(result.verdict, 'BLOCK');
    assert.ok(result.reasons.includes('Recipient is unknown or unresolved'));
  });

  it('should BLOCK if transaction recipient does not match intended recipient', () => {
    const preview = { ...validPreview, recipient: '0x9999999999999999999999999999999999999999' };
    const result = evaluateRisk(validIntent, validResolved, preview, validBalance, config);
    assert.strictEqual(result.verdict, 'BLOCK');
    assert.ok(result.reasons.includes('Transaction recipient does not match intended recipient'));
  });

  it('should BLOCK if transaction amount does not match intended amount', () => {
    const preview = { ...validPreview, amountEth: '2' };
    const result = evaluateRisk(validIntent, validResolved, preview, validBalance, config);
    assert.strictEqual(result.verdict, 'BLOCK');
    assert.ok(result.reasons.includes('Transaction amount does not match intended amount'));
  });

  it('should BLOCK if simulation fails', () => {
    const preview: TransactionPreview = { ...validPreview, simulationStatus: 'failed', failureReason: 'reverted' };
    const result = evaluateRisk(validIntent, validResolved, preview, validBalance, config);
    assert.strictEqual(result.verdict, 'BLOCK');
    assert.ok(result.reasons.includes('Simulation failed'));
  });

  it('should BLOCK if total cost (amount + gas) exceeds available balance', () => {
    // Intent amount is 1, total cost is ~1.000000000000021. Balance of 1.000000000000020 is insufficient!
    const result = evaluateRisk(validIntent, validResolved, validPreview, '1.000000000000020', config);
    assert.strictEqual(result.verdict, 'BLOCK');
    assert.ok(result.reasons.includes('Total cost (amount + gas) exceeds available balance'));
  });

  it('should BLOCK if action is not send', () => {
    const invalidIntent: any = { action: 'balance', confidence: 0.95 };
    const result = evaluateRisk(invalidIntent, undefined, undefined, validBalance, config);
    assert.strictEqual(result.verdict, 'BLOCK');
    assert.ok(result.reasons.includes('Unsupported action'));
  });

  it('should BLOCK if confidence is below threshold', () => {
    const intent = { ...validIntent, confidence: 0.85 }; // below 0.9
    const result = evaluateRisk(intent, validResolved, validPreview, validBalance, config);
    assert.strictEqual(result.verdict, 'BLOCK');
    assert.ok(result.reasons.includes('Confidence is below configurable threshold'));
  });



  it('should WARN if amount exceeds configurable percentage of balance', () => {
    // Amount = 1. Balance = 1.5. 1 > 0.5 * 1.5 = 0.75
    const result = evaluateRisk(validIntent, validResolved, validPreview, '1.5', config);
    assert.strictEqual(result.verdict, 'WARN');
    assert.ok(result.reasons.includes('Amount exceeds configurable percentage of the wallet balance'));
  });

  it('should BLOCK and override WARN if both exist', () => {
    // Make amount exceed 50% of balance (1 > 0.5 * 1.5) to trigger WARN
    const preview: TransactionPreview = { ...validPreview, simulationStatus: 'failed' }; // BLOCK
    const result = evaluateRisk(validIntent, validResolved, preview, '1.5', config);
    assert.strictEqual(result.verdict, 'BLOCK');
    assert.ok(result.reasons.includes('Simulation failed'));
    assert.ok(result.reasons.includes('Amount exceeds configurable percentage of the wallet balance'));
  });
});
