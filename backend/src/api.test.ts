import './test-setup';
import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { app, approvalTokens } from './index';
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
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
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
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 }
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
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
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
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
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
    mock.method(publicClient, 'getChainId', async () => 11155111);

    // Mock the LLM to deterministically return a SendIntent
    deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        confidence: 0.95,
        amount: '0.0001',
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
    assert.strictEqual(data.intent.action, 'send_eth');
    assert.strictEqual(data.intent.amount, '0.0001');
    assert.strictEqual(data.intent.recipient, 'Rahul');
    assert.ok(data.preview);
    assert.ok(data.risk);
    assert.ok(data.approvalToken);
    mock.restoreAll();
  });

  it('should process natural language balance query and return wallet address and Sepolia balance without recipient or amount', async () => {
    const { publicClient, getSenderAccount } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('5.25'));

    deps.generateFn = async () => JSON.stringify({
      action: 'balance',
      confidence: 0.98
    });

    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'What is my Sepolia balance?'
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.intent.action, 'balance');
    assert.strictEqual(data.intent.confidence, 0.98);
    assert.strictEqual(data.intent.recipient, undefined);
    assert.strictEqual(data.intent.amount, undefined);
    assert.strictEqual(data.balance.walletAddress, getSenderAccount().address);
    assert.strictEqual(data.balance.balanceEth, '5.25');
    assert.strictEqual(data.balance.network, 'sepolia');
    assert.strictEqual(data.risk.verdict, 'PASS');
    assert.strictEqual(data.approvalToken, undefined);
    mock.restoreAll();
  });

  it('should reject ambiguous natural language requests', async () => {
    deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        confidence: 0.2,
        amount: '1',
        recipient: 'Rahul'
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

  it('should process unambiguous ETH transfer via fallback when Gemini is offline', async () => {
    const { publicClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 0n);
    mock.method(publicClient, 'getChainId', async () => 11155111);

    // Simulate Gemini API offline / throwing error
    deps.generateFn = async () => {
      throw new Error('Gemini service unreachable');
    };

    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Send 0.0001 ETH to Rahul'
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.intent.action, 'send_eth');
    assert.strictEqual(data.intent.amount, '0.0001');
    assert.strictEqual(data.intent.recipient, 'Rahul');
    assert.strictEqual(data.intent.confidence, 1.0);
    assert.ok(data.preview);
    assert.ok(data.risk);
    assert.strictEqual(data.risk.verdict, 'PASS');
    assert.ok(data.approvalToken);
    mock.restoreAll();
  });

  it('should process unambiguous USDC transfer via fallback when Gemini times out', async () => {
    const { publicClient } = require('./blockchain');
    const { parseEther, parseUnits } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('1')); // 1 ETH for gas
    mock.method(publicClient, 'estimateGas', async () => 65000n);
    mock.method(publicClient, 'getGasPrice', async () => 1000000000n);
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'balanceOf') return parseUnits('100', 6);
      return 0n;
    });

    // Simulate Gemini timeout
    const originalTimeout = deps.timeoutMs;
    deps.timeoutMs = 15;
    deps.generateFn = async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return '';
    };

    try {
      const res = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Send 25.5 USDC to Rahul'
        })
      });

      assert.strictEqual(res.status, 200);
      const data = await res.json();
      assert.strictEqual(data.intent.action, 'send_usdc');
      assert.strictEqual(data.intent.amount, '25.5');
      assert.strictEqual(data.intent.recipient, 'Rahul');
      assert.strictEqual(data.intent.confidence, 1.0);
      assert.ok(data.preview);
      assert.strictEqual(data.preview.asset, 'USDC');
      assert.ok(data.approvalToken);
    } finally {
      deps.timeoutMs = originalTimeout;
      mock.restoreAll();
    }
  });

  it('should process unambiguous balance query via fallback as read-only (no approval token)', async () => {
    const { publicClient, getSenderAccount } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('2.5'));

    deps.generateFn = async () => {
      throw new Error('Gemini API unavailable');
    };

    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Check my balance'
      })
    });

    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.intent.action, 'balance');
    assert.strictEqual(data.intent.confidence, 1.0);
    assert.strictEqual(data.balance.walletAddress, getSenderAccount().address);
    assert.strictEqual(data.balance.balanceEth, '2.5');
    assert.strictEqual(data.risk.verdict, 'PASS');
    assert.strictEqual(data.approvalToken, undefined); // Read-only! Never issues approval token
    mock.restoreAll();
  });

  it('should reject fallback when recipient is an unknown contact', async () => {
    deps.generateFn = async () => {
      throw new Error('Gemini API unavailable');
    };

    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Send 1 ETH to Stranger'
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.strictEqual(data.error, 'Unknown recipient');
    assert.strictEqual(data.approvalToken, undefined);
  });

  it('should reject fallback when user specifies an arbitrary wallet address instead of contact name', async () => {
    deps.generateFn = async () => {
      throw new Error('Gemini API unavailable');
    };

    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Send 0.01 ETH to 0x1D9f6830b29773733411736db3883cBA9a5f93AC'
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(data.details.includes('Arbitrary wallet addresses are not supported in fallback requests'));
    assert.strictEqual(data.approvalToken, undefined);
  });

  it('should reject ambiguous or unsupported requests during fallback without leaking provider secrets', async () => {
    deps.generateFn = async () => {
      throw new Error('Confidential API key leaked in provider stacktrace');
    };

    const res = await fetch(`${baseUrl}/api/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: 'Swap 10 ETH for DAI'
      })
    });

    assert.strictEqual(res.status, 400);
    const data = await res.json();
    assert.ok(!JSON.stringify(data).includes('Confidential API key'));
    assert.ok(data.details.includes('Unable to parse request'));
    assert.strictEqual(data.approvalToken, undefined);
  });
});

describe('CORS Restrictions', () => {
  before(async () => {
    return new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
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

import { CIRCLE_SEPOLIA_USDC_ADDRESS, getSenderAccount, publicClient } from './blockchain';
import { parseUnits, parseEther } from 'viem';

describe('API Execute Endpoint - Approval Tokens', () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDB(mongod.getUri());
    const collection = getContactsCollection();
    await collection.insertOne({ name: 'Rahul', walletAddress: '0x1D9f6830b29773733411736db3883cBA9a5f93AC' });

    return new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
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
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
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
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
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
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() - 1000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
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
      amount: '0.2',
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() + 50000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
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
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() + 50000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Hacker', confidence: 0.95 },
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
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
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
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
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
      amount: '6',
      network: 'sepolia',
      estimatedGas: '21000', // Example cost with 0 gas
      expiresAt: Date.now() + 50000
    });

    const { publicClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 0n);

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '6', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error.includes('Verdict: WARN'));
    mock.restoreAll();
  });

  it('should prevent concurrent execution race conditions for the same token', async () => {
    const token = '623e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      maxCostEth: '0.2',
      expiresAt: Date.now() + 50000
    });

    const { publicClient, walletClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 1000000000n);
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(walletClient, 'sendTransaction', async () => '0xmockhash-concurrent');
    mock.method(publicClient, 'waitForTransactionReceipt', async () => ({ status: 'success' }));
    mock.method(publicClient, 'getTransaction', async () => ({
      to: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      value: parseEther('0.1')
    }));

    const makeReq = () => fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });

    // Fire two concurrent requests with identical token
    const [res1, res2] = await Promise.all([makeReq(), makeReq()]);
    const results = [await res1.json(), await res2.json()];
    
    // Exactly one could claim the token; the other MUST be rejected as invalid or reused
    const reusedErrors = results.filter(r => r.error === 'Invalid or reused approval token.');
    assert.strictEqual(reusedErrors.length, 1);
    mock.restoreAll();
  });

  it('should allow execution when gas price fluctuates within approved maxCostEth', async () => {
    const token = '723e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      maxCostEth: '0.2', // Approved up to 0.2 ETH
      expiresAt: Date.now() + 50000
    });

    const { publicClient, walletClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 21000n); // gas estimate unchanged
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n); // gas price fluctuates up to 2 gwei
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(walletClient, 'sendTransaction', async () => '0xmockhash123');
    mock.method(publicClient, 'waitForTransactionReceipt', async () => ({ status: 'success' }));
    mock.method(publicClient, 'getTransaction', async () => ({
      to: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      value: parseEther('0.1')
    }));

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    
    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.hash, '0xmockhash123');
    mock.restoreAll();
  });

  it('should reject execution if gas estimate increases beyond approved limit', async () => {
    const token = '823e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000', // Approved for 21000
      maxCostEth: '0.2',
      expiresAt: Date.now() + 50000
    });

    const { publicClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 50000n); // Re-simulation requires 50000 gas!
    mock.method(publicClient, 'getGasPrice', async () => 1000000000n);
    mock.method(publicClient, 'getChainId', async () => 11155111);

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error.includes('gas estimate increased beyond approved limit'));
    mock.restoreAll();
  });

  it('should reject execution if RPC reports non-Sepolia chain ID', async () => {
    const token = '923e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      maxCostEth: '0.2',
      expiresAt: Date.now() + 50000
    });

    const { publicClient } = require('./blockchain');
    mock.method(publicClient, 'getChainId', async () => 1); // Mainnet instead of Sepolia!

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error.includes('Chain mismatch'));
    mock.restoreAll();
  });

  it('should reject execution of a balance query', async () => {
    const token = 'a23e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0',
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() + 50000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'balance', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 400);
    assert.strictEqual(data.error, 'Balance query cannot be executed as a transaction.');
  });

  it('should reject execution with non-string/float amount or unsupported actions', async () => {
    const token = 'b23e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() + 50000
    });

    // Test float/number amount
    const resFloat = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: 0.1, recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    assert.strictEqual(resFloat.status, 400);
    const dataFloat = await resFloat.json();
    assert.strictEqual(dataFloat.error, 'Invalid amount');

    // Test unsupported action
    const token2 = 'c23e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token2, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      expiresAt: Date.now() + 50000
    });
    const resAction = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'swap', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token2
      })
    });
    assert.strictEqual(resAction.status, 400);
    const dataAction = await resAction.json();
    assert.strictEqual(dataAction.error, 'Invalid or missing action');
  });

  const validRecipient = '0x1D9f6830b29773733411736db3883cBA9a5f93AC';

  it('should reject USDC execution if token details mismatch (recipient or amount)', async () => {
    const token = 'd23e4567-e89b-42d3-a456-426614174000';
    const sender = getSenderAccount().address.toLowerCase();
    approvalTokens.set(token, {
      asset: 'USDC',
      contractAddress: CIRCLE_SEPOLIA_USDC_ADDRESS,
      sender,
      recipient: validRecipient.toLowerCase(),
      amount: '25',
      amountRaw: '25000000',
      network: 'sepolia',
      estimatedGas: '65000',
      maxCostEth: '0.001',
      expiresAt: Date.now() + 50000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_usdc', amount: '30', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.error, 'Mismatched approval token details.');
  });

  it('should reject USDC execution if token contract address is mismatched', async () => {
    const token = 'e23e4567-e89b-42d3-a456-426614174000';
    const sender = getSenderAccount().address.toLowerCase();
    approvalTokens.set(token, {
      asset: 'USDC',
      contractAddress: '0x0000000000000000000000000000000000000001', // Fake contract address!
      sender,
      recipient: validRecipient.toLowerCase(),
      amount: '25',
      amountRaw: '25000000',
      network: 'sepolia',
      estimatedGas: '65000',
      maxCostEth: '0.001',
      expiresAt: Date.now() + 50000
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_usdc', amount: '25', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.strictEqual(data.error, 'Mismatched approval token contract address.');
  });

  it('should reject USDC execution if gas estimate increases beyond approved limit', async () => {
    const token = 'f23e4567-e89b-42d3-a456-426614174000';
    const sender = getSenderAccount().address.toLowerCase();
    approvalTokens.set(token, {
      asset: 'USDC',
      contractAddress: CIRCLE_SEPOLIA_USDC_ADDRESS,
      sender,
      recipient: validRecipient.toLowerCase(),
      amount: '25',
      amountRaw: '25000000',
      network: 'sepolia',
      estimatedGas: '65000', // Approved for 65000
      maxCostEth: '0.001',
      expiresAt: Date.now() + 50000
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'getBalance', async () => parseEther('1'));
    mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'balanceOf') return parseUnits('100', 6);
      return 0n;
    });
    mock.method(publicClient, 'estimateGas', async () => 85000n); // Increased to 85000!
    mock.method(publicClient, 'getGasPrice', async () => 1000000000n);

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_usdc', amount: '25', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error.includes('gas estimate increased beyond approved limit'));
  });

  it('should reject USDC execution if firewall yields WARN (e.g. exceeding 50% balance threshold)', async () => {
    const token = '123e4567-e89b-42d3-a456-426614174001';
    const sender = getSenderAccount().address.toLowerCase();
    approvalTokens.set(token, {
      asset: 'USDC',
      contractAddress: CIRCLE_SEPOLIA_USDC_ADDRESS,
      sender,
      recipient: validRecipient.toLowerCase(),
      amount: '25',
      amountRaw: '25000000',
      network: 'sepolia',
      estimatedGas: '65000',
      maxCostEth: '0.001',
      expiresAt: Date.now() + 50000
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'getBalance', async () => parseEther('1'));
    mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'balanceOf') return parseUnits('40', 6); // 40 USDC; 25 > 0.5 * 40 = 20 (WARN)
      return 0n;
    });
    mock.method(publicClient, 'estimateGas', async () => 65000n);
    mock.method(publicClient, 'getGasPrice', async () => 1000000000n);

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_usdc', amount: '25', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error.includes('Verdict: WARN'));
  });

  it('should reject USDC execution if token simulation fails', async () => {
    const token = '123e4567-e89b-42d3-a456-426614174002';
    const sender = getSenderAccount().address.toLowerCase();
    approvalTokens.set(token, {
      asset: 'USDC',
      contractAddress: CIRCLE_SEPOLIA_USDC_ADDRESS,
      sender,
      recipient: validRecipient.toLowerCase(),
      amount: '25',
      amountRaw: '25000000',
      network: 'sepolia',
      estimatedGas: '65000',
      maxCostEth: '0.001',
      expiresAt: Date.now() + 50000
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'getBalance', async () => parseEther('1'));
    mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'balanceOf') return parseUnits('100', 6);
      return 0n;
    });
    mock.method(publicClient, 'estimateGas', async () => {
      throw new Error('ERC20: transfer reverted');
    });
    mock.method(publicClient, 'getGasPrice', async () => 1000000000n);

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_usdc', amount: '25', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });
    const data = await res.json();
    assert.strictEqual(res.status, 403);
    assert.ok(data.error.includes('Failed to reconstruct/simulate'));
  });

  it('should only activate test mode when NODE_ENV is strictly test', () => {
    const { isTestMode } = require('./index');
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'test';
      assert.strictEqual(isTestMode(), true);

      process.env.NODE_ENV = 'production';
      assert.strictEqual(isTestMode(), false);

      delete process.env.NODE_ENV;
      assert.strictEqual(isTestMode(), false);
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  it('should return pending status with hash when waitForTransactionReceipt times out after broadcast', async () => {
    const token = 'b23e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      maxCostEth: '0.2',
      expiresAt: Date.now() + 50000
    });

    const { publicClient, walletClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 1000000000n);
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(walletClient, 'sendTransaction', async () => '0xbroadcasttimedouthash123');
    mock.method(publicClient, 'waitForTransactionReceipt', async () => {
      const err = new Error('Timed out waiting for transaction receipt');
      err.name = 'WaitForTransactionReceiptTimeoutError';
      throw err;
    });

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });

    const data = await res.json();
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.pending, true);
    assert.strictEqual(data.success, false);
    assert.strictEqual(data.hash, '0xbroadcasttimedouthash123');
    assert.ok(data.message.includes('confirmation timed out'));
    assert.strictEqual(data.error, undefined);
    mock.restoreAll();
  });

  it('should report failure when transaction actually reverts on-chain', async () => {
    const token = 'c23e4567-e89b-42d3-a456-426614174000';
    approvalTokens.set(token, {
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      amount: '0.1',
      network: 'sepolia',
      estimatedGas: '21000',
      maxCostEth: '0.2',
      expiresAt: Date.now() + 50000
    });

    const { publicClient, walletClient } = require('./blockchain');
    const { parseEther } = require('viem');
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 1000000000n);
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(walletClient, 'sendTransaction', async () => '0xrevertedhash123');
    mock.method(publicClient, 'waitForTransactionReceipt', async () => ({
      status: 'reverted'
    }));

    const res = await fetch(`${baseUrl}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.95 },
        confirmed: true,
        approvalToken: token
      })
    });

    const data = await res.json();
    assert.strictEqual(res.status, 500);
    assert.strictEqual(data.error, 'Transaction reverted on-chain');
    mock.restoreAll();
  });
});
