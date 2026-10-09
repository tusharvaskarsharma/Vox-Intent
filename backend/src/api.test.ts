import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { app } from './index';
import { connectDB, closeDB, getContactsCollection } from './db';
import { MongoMemoryServer } from 'mongodb-memory-server';

let server: any;
let baseUrl: string;
let mongod: MongoMemoryServer;

// Ensure tests don't actually hit the network maliciously if it progresses too far
// Note: We don't want to actually send transactions in tests
describe('API Execution Endpoint', () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDB(mongod.getUri());
    const collection = getContactsCollection();
    await collection.insertOne({ name: 'Rahul', walletAddress: '0x1D9f6830b29773733411736db3883cBA9a5f93AC' });

    return new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve(undefined);
      });
    });
  });

  after(async () => {
    server.close();
    await closeDB();
    if (mongod) {
      await mongod.stop();
    }
  });

  it('should fail execution if confirmation field is entirely missing', async () => {
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Rahul', confidence: 0.95 }
        // confirmed field intentionally omitted
      })
    });
    
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.error, 'Explicit confirmation is required to execute transaction.');
  });
  
  it('should fail execution if confirmation field is false (unconfirmed)', async () => {
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Rahul', confidence: 0.95 },
        confirmed: false
      })
    });
    
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.strictEqual(data.error, 'Explicit confirmation is required to execute transaction.');
  });
});

import { deps } from './extractor';

describe('API Process Endpoint - Natural Language', () => {
  let originalGenerateFn: any;

  before(async () => {
    originalGenerateFn = deps.generateFn;
    mongod = await MongoMemoryServer.create();
    await connectDB(mongod.getUri());
    const collection = getContactsCollection();
    await collection.insertOne({ name: 'Rahul', walletAddress: '0x1D9f6830b29773733411736db3883cBA9a5f93AC' });

    return new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve(undefined);
      });
    });
  });

  after(async () => {
    deps.generateFn = originalGenerateFn;
    server.close();
    await closeDB();
    if (mongod) {
      await mongod.stop();
    }
  });

  it('should process natural language send intent through the pipeline', async () => {
    const { publicClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 0n);

    // Mock the LLM to deterministically return a SendIntent
    deps.generateFn = async () => JSON.stringify({
        action: 'send',
        confidence: 0.95,
        amount: 0.0001,
        recipient: 'Rahul'
    });

    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Send 0.0001 ETH to Rahul'
      })
    });
    
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    
    // The firewall, simulation, and preview should have all executed
    assert.strictEqual(data.intent.action, 'send');
    assert.strictEqual(data.intent.amount, 0.0001);
    assert.strictEqual(data.intent.recipient, 'Rahul');
    assert.ok(data.preview);
    assert.ok(data.risk);
    mock.restoreAll();
  });

  it('should reject ambiguous natural language requests', async () => {
    deps.generateFn = async () => JSON.stringify({
        action: 'send',
        confidence: 0.2
    });

    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Do something weird with my ETH'
      })
    });
    
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'Low-confidence intent');
  });

  it('should reject empty or missing text', async () => {
    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'Text field must be a non-empty string.');
  });

  it('should reject oversized text', async () => {
    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'a'.repeat(501) })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'Text is too long. Maximum 500 characters allowed.');
  });

  it('should reject unexpected fields in process payload', async () => {
    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Send 0.1 ETH to Rahul', maliciousField: true })
    });
    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'Invalid request body. Only "text" field is allowed.');
  });
});

describe('CORS Restrictions', () => {
  before(async () => {
    return new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve(undefined);
      });
    });
  });

  after(async () => {
    server.close();
  });

  it('should allow requests from the configured FRONTEND_URL', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: { 'Origin': process.env.FRONTEND_URL || 'http://localhost:5173' }
    });
    assert.strictEqual(res.status, 200);
  });

  it('should reject requests from other origins', async () => {
    const res = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      headers: { 'Origin': 'http://evil.com' }
    });
    assert.strictEqual(res.status, 500);
    const text = await res.text();
    assert.ok(text.includes('Not allowed by CORS'));
  });
});

import { approvalTokens } from './index';
import { mock } from 'node:test';

describe('API Execute Endpoint - Approval Tokens', () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDB(mongod.getUri());
    const collection = getContactsCollection();
    await collection.insertOne({ name: 'Rahul', walletAddress: '0x1D9f6830b29773733411736db3883cBA9a5f93AC' });

    return new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://localhost:${port}`;
        resolve(undefined);
      });
    });
  });

  after(async () => {
    server.close();
    await closeDB();
    if (mongod) {
      await mongod.stop();
    }
  });

  it('should fail if approval token is missing', async () => {
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Rahul', confidence: 0.95 },
        confirmed: true
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.error, 'Missing approval token.');
  });

  it('should fail if approval token is invalid or reused', async () => {
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: '123e4567-e89b-42d3-a456-426614174000'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.error, 'Invalid or reused approval token.');
  });

  it('should fail if approval token is expired', async () => {
    approvalTokens.set('223e4567-e89b-42d3-a456-426614174000', {
      recipient: '0x1D9f6830b29773733411736db3883cBA9a5f93AC',
      amount: 0.1,
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() - 1000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: '223e4567-e89b-42d3-a456-426614174000'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.error, 'Expired approval token.');
    assert.ok(!approvalTokens.has('223e4567-e89b-42d3-a456-426614174000'));
  });

  it('should fail if approval token mismatched details', async () => {
    approvalTokens.set('323e4567-e89b-42d3-a456-426614174000', {
      recipient: '0x1D9f6830b29773733411736db3883cBA9a5f93AC',
      amount: 0.2,
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() + 50000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: '323e4567-e89b-42d3-a456-426614174000'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.error, 'Mismatched approval token details.');
    assert.ok(!approvalTokens.has('323e4567-e89b-42d3-a456-426614174000'));
  });

  it('should block execution if recipient is unknown', async () => {
    approvalTokens.set('423e4567-e89b-42d3-a456-426614174000', {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: 0.1,
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() + 50000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Hacker', confidence: 0.95 },
        confirmed: true,
        approvalToken: '423e4567-e89b-42d3-a456-426614174000'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400); // Because validateIntent fails
    assert.strictEqual(data.error, 'Unknown recipient');
  });

  it('should reject unexpected fields in execute payload', async () => {
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: '123e4567-e89b-12d3-a456-426614174000',
        maliciousField: 'attack'
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.error, 'Unexpected fields in execution request body.');
  });

  it('should reject malformed approval tokens', async () => {
    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 0.1, recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: 'select * from users;--' // Not a UUID
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.error, 'Invalid approval token format.');
  });

  it('should explicitly deny execution for WARN verdicts', async () => {
    const token = '523e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: 6,
      network: 'sepolia',
      estimatedGas: '21000', // Example cost with 0 gas
      expiresAt: Date.now() + 50000
    });

    const { publicClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 0n);

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send', amount: 6, recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error.includes('Verdict: WARN'));
    mock.restoreAll();
  });
});
