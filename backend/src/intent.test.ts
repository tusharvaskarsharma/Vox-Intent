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

  it('should validate a valid send intent and resolve address (case-insensitive)', async () => {
    const payload = { action: 'send', confidence: 0.95, amount: 10, recipient: 'rahul' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, true);
    if (result.valid) {
      assert.strictEqual(result.intent.action, 'send');
      assert.strictEqual(result.resolvedAddress, '0x1D9f6830b29773733411736db3883cBA9a5f93AC');
    }
  });

  it('should reject an invalid action', async () => {
    const payload = { action: 'swap', confidence: 0.9 };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Invalid or missing action');
    }
  });

  it('should reject a low-confidence intent', async () => {
    const payload = { action: 'send', confidence: 0.89, amount: 10, recipient: 'Rahul' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Low-confidence intent');
    }
  });

  it('should reject an unknown recipient', async () => {
    const payload = { action: 'send', confidence: 0.9, amount: 10, recipient: 'Bob' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Unknown recipient');
    }
  });

  it('should reject an invalid amount', async () => {
    const payload = { action: 'send', confidence: 0.9, amount: -5, recipient: 'Rahul' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Invalid amount');
    }
  });

  it('should reject missing fields', async () => {
    const payload = { action: 'send', confidence: 0.9 };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
  });

  it('should reject unexpected fields (attack case)', async () => {
    const payload = { action: 'send', confidence: 0.9, amount: 10, recipient: 'Rahul', maliciousData: '0xBAD' };
    const result = await validateIntent(payload);
    assert.strictEqual(result.valid, false);
    if (!result.valid) {
      assert.strictEqual(result.error, 'Unexpected fields in intent payload');
    }
  });

  it('should reject non-object payloads', async () => {
    const payloads = [null, undefined, 'string', 123, []];
    for (const p of payloads) {
      const result = await validateIntent(p);
      assert.strictEqual(result.valid, false);
      if (!result.valid) {
        assert.strictEqual(result.error, 'Invalid payload format');
      }
    }
  });
});
