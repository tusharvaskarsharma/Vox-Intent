import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { validateIntent } from './intent';
import { connectDB, closeDB, getContactsCollection } from './db';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer;

describe('VoiceIntent Validation', () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    const uri = mongod.getUri();
    await connectDB(uri);

    const collection = getContactsCollection();
    await collection.insertMany([
      { name: 'Rahul', walletAddress: '0x1D9f6830b29773733411736db3883cBA9a5f93AC' },
      { name: 'Alice', walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' }
    ]);
  });

  after(async () => {
    await closeDB();
    if (mongod) {
      await mongod.stop();
    }
  });

  it('should validate a valid balance intent', async () => {
    const payload = { action: 'balance', confidence: 0.95 };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, true);
    if (result.valid) {
      assert.strictEqual(result.intent.action, 'balance');
    }
  });

  it('should reject a balance intent with unexpected extra fields', async () => {
    const payload = { action: 'balance', confidence: 0.95, amount: '1', recipient: 'Rahul' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Unexpected fields in intent payload');
    }
  });

  it('should validate a valid send_eth intent and resolve address (case-insensitive)', async () => {
    const payload = { action: 'send_eth', confidence: 0.95, amount: '10', recipient: 'rahul' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, true);
    if (result.valid) {
      assert.strictEqual(result.intent.action, 'send_eth');
      assert.strictEqual((result.intent as any).amount, '10');
      assert.strictEqual(result.resolvedAddress, '0x1D9f6830b29773733411736db3883cBA9a5f93AC');
    }
  });

  it('should validate a valid send_usdc intent and resolve address', async () => {
    const payload = { action: 'send_usdc', confidence: 0.95, amount: '25.5', recipient: 'Alice' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, true);
    if (result.valid) {
      assert.strictEqual(result.intent.action, 'send_usdc');
      assert.strictEqual((result.intent as any).amount, '25.5');
      assert.strictEqual(result.resolvedAddress, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    }
  });

  it('should reject invalid actions (including legacy send and swap)', async () => {
    for (const act of ['swap', 'send', 'transfer', 'stake']) {
      const payload = { action: act, confidence: 0.9 };
      const result = await validateIntent(payload);
      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.strictEqual(result.error, 'Invalid or missing action');
      }
    }
  });

  it('should reject a low-confidence intent', async () => {
    const payload = { action: 'send_eth', confidence: 0.89, amount: '10', recipient: 'Rahul' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Low-confidence intent');
    }
  });

  it('should reject an unknown recipient', async () => {
    const payload = { action: 'send_eth', confidence: 0.9, amount: '10', recipient: 'Bob' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Unknown recipient');
    }
  });

  it('should reject non-string amounts (reject floating-point and integer numbers)', async () => {
    const numericAmounts = [10, 0.1, -5, NaN, Infinity];
    for (const amt of numericAmounts) {
      const payload = { action: 'send_eth', confidence: 0.95, amount: amt, recipient: 'Rahul' };
      const result = await validateIntent(payload);
      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.strictEqual(result.error, 'Invalid amount');
      }
    }
  });

  it('should reject an invalid amount string', async () => {
    const payload = { action: 'send_eth', confidence: 0.9, amount: '-5', recipient: 'Rahul' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Invalid amount');
    }
  });

  it('should reject missing fields', async () => {
    const payload = { action: 'send_eth', confidence: 0.9 };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
  });

  it('should reject unexpected fields (attack case)', async () => {
    const payload = { action: 'send_eth', confidence: 0.9, amount: '10', recipient: 'Rahul', maliciousData: '0xBAD' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Unexpected fields in intent payload');
    }
  });

  it('should accept strictly validated positive decimal strings for amount', async () => {
    const payload = { action: 'send_eth', confidence: 0.95, amount: '0.005', recipient: 'Rahul' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, true);
    if (result.valid) {
      assert.strictEqual(result.intent.action, 'send_eth');
      assert.strictEqual((result.intent as any).amount, '0.005');
    }
  });

  it('should reject malformed or non-positive decimal strings', async () => {
    const invalidAmounts = ['0', '0.0', '-5', 'abc', '1e-5', '0.1.2', ''];
    for (const amt of invalidAmounts) {
      const payload = { action: 'send_eth', confidence: 0.95, amount: amt, recipient: 'Rahul' };
      const result = await validateIntent(payload);
      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.strictEqual(result.error, 'Invalid amount');
      }
    }
  });

  it('should not allow regex injection in address-book nickname matching', async () => {
    const maliciousRecipients = ['.*', 'Rahul.*', '^Rahul$', 'Rahul|Alice', 'R.*l', 'Alice.*'];
    for (const rec of maliciousRecipients) {
      const payload = { action: 'send_eth', confidence: 0.95, amount: '1', recipient: rec };
      const result = await validateIntent(payload);
      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.strictEqual(result.error, 'Unknown recipient');
      }
    }
  });

  it('should reject USDC amounts with more than 6 decimal places', async () => {
    const invalidUsdcAmounts = ['10.1234567', '0.0000001', '1.123456789'];
    for (const amt of invalidUsdcAmounts) {
      const payload = { action: 'send_usdc', confidence: 0.95, amount: amt, recipient: 'Rahul' };
      const result = await validateIntent(payload);
      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.strictEqual(result.error, 'USDC amounts cannot exceed 6 decimal places');
      }
    }
  });

  it('should accept valid USDC amounts with 6 or fewer decimal places', async () => {
    const validUsdcAmounts = ['10', '10.5', '10.123456', '0.000001', '500.00'];
    for (const amt of validUsdcAmounts) {
      const payload = { action: 'send_usdc', confidence: 0.95, amount: amt, recipient: 'Rahul' };
      const result = await validateIntent(payload);
      assert.strictEqual(result.valid, true);
      if (result.valid) {
        assert.strictEqual((result.intent as any).amount, amt);
      }
    }
  });

  it('should reject ETH amounts with more than 18 decimal places', async () => {
    const invalidEthAmounts = [
      '0.0000000000000000001', // 19 decimals
      '1.1234567890123456789', // 19 decimals
      '10.00000000000000000001' // 20 decimals
    ];
    for (const amt of invalidEthAmounts) {
      const payload = { action: 'send_eth', confidence: 0.95, amount: amt, recipient: 'Rahul' };
      const result = await validateIntent(payload);
      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.strictEqual(result.error, 'ETH amounts cannot exceed 18 decimal places');
      }
    }
  });

  it('should accept valid ETH amounts with 18 or fewer decimal places', async () => {
    const validEthAmounts = [
      '1',
      '0.5',
      '0.000000000000000001', // 18 decimals (1 wei)
      '1.123456789012345678', // 18 decimals
      '100.00'
    ];
    for (const amt of validEthAmounts) {
      const payload = { action: 'send_eth', confidence: 0.95, amount: amt, recipient: 'Rahul' };
      const result = await validateIntent(payload);
      assert.strictEqual(result.valid, true);
      if (result.valid) {
        assert.strictEqual((result.intent as any).amount, amt);
      }
    }
  });
});
