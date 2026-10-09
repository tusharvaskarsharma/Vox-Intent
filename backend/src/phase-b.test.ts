import './test-setup';
import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { app, approvalTokens } from './index';
import { publicClient, walletClient, CIRCLE_SEPOLIA_USDC_ADDRESS } from './blockchain';
import { deps } from './extractor';
import { parseEther, parseUnits } from 'viem';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDB, closeDB, getContactsCollection } from './db';

describe('VoxIntent Phase B: Remediation Verification', () => {
  let mongod: MongoMemoryServer;
  let server: any;
  let baseUrl: string;

  before(async () => {
    mongod = await MongoMemoryServer.create();
    await connectDB(mongod.getUri());
    const collection = getContactsCollection();
    await collection.insertOne({ name: 'Rahul', walletAddress: '0x1D9f6830b29773733411736db3883cBA9a5f93AC' });
    await collection.insertOne({ name: 'Alice', walletAddress: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' });

    return new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve(undefined);
      });
    });
  });

  after(async () => {
    if (server) await new Promise((r) => server.close(r));
    await closeDB();
    if (mongod) await mongod.stop();
  });

  afterEach(() => {
    mock.restoreAll();
    approvalTokens.clear();
  });

  describe('1. Stale-Token Invalidation and Race Prevention', () => {
    it('should reject execution when attempting to use a stale approval token with revised parameters', async () => {
      mock.method(publicClient, 'getChainId', async () => 11155111);
      mock.method(publicClient, 'getBalance', async () => parseEther('10'));
      mock.method(publicClient, 'estimateGas', async () => 21000n);
      mock.method(publicClient, 'getGasPrice', async () => parseEther('0.000000001'));

      // Process initial request: 0.05 ETH
      deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        amount: '0.05',
        recipient: 'Rahul',
        confidence: 0.98
      });

      const res1 = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Send 0.05 ETH to Rahul' })
      });
      const data1 = await res1.json();
      assert.strictEqual(res1.status, 200);
      assert.ok(data1.approvalToken);
      const staleToken = data1.approvalToken;

      // User modifies request to 0.1 ETH and backend reprocesses
      deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        amount: '0.1',
        recipient: 'Rahul',
        confidence: 0.98
      });

      const res2 = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Send 0.1 ETH to Rahul' })
      });
      const data2 = await res2.json();
      assert.strictEqual(res2.status, 200);
      assert.ok(data2.approvalToken);
      const freshToken = data2.approvalToken;
      assert.notStrictEqual(staleToken, freshToken);

      // Attempting to execute revised 0.1 ETH intent with the stale token (which was bound to 0.05 ETH) MUST fail
      const execResStale = await fetch(`${baseUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.98 },
          confirmed: true,
          approvalToken: staleToken
        })
      });
      const staleExecData = await execResStale.json();
      assert.strictEqual(execResStale.status, 403);
      assert.strictEqual(staleExecData.error, 'Mismatched approval token details.');

      // Fresh token successfully executes
      mock.method(walletClient, 'sendTransaction', async () => '0xfreshhash123');
      mock.method(publicClient, 'waitForTransactionReceipt', async () => ({ status: 'success' }));
      mock.method(publicClient, 'getTransaction', async () => ({
        to: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
        value: parseEther('0.1')
      }));

      const execResFresh = await fetch(`${baseUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.98 },
          confirmed: true,
          approvalToken: freshToken
        })
      });
      const freshExecData = await execResFresh.json();
      assert.strictEqual(execResFresh.status, 200);
      assert.strictEqual(freshExecData.success, true);
      assert.strictEqual(freshExecData.hash, '0xfreshhash123');

      // Attempting to reuse the consumed token fails
      const execResReused = await fetch(`${baseUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { action: 'send_eth', amount: '0.1', recipient: 'Rahul', confidence: 0.98 },
          confirmed: true,
          approvalToken: freshToken
        })
      });
      const reusedData = await execResReused.json();
      assert.strictEqual(execResReused.status, 403);
      assert.strictEqual(reusedData.error, 'Invalid or reused approval token.');
    });
  });

  describe('2. Revised-Request Reprocessing', () => {
    it('should reprocess revised request from ETH to USDC and issue fresh token with USDC contract bindings', async () => {
      mock.method(publicClient, 'getChainId', async () => 11155111);
      mock.method(publicClient, 'getBalance', async () => parseEther('2')); // Enough ETH for gas
      mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
        if (functionName === 'decimals') return 6;
        if (functionName === 'balanceOf') return parseUnits('100', 6);
        return 0n;
      });
      mock.method(publicClient, 'estimateGas', async () => 65000n);
      mock.method(publicClient, 'getGasPrice', async () => parseEther('0.000000002'));

      // 1. Initial request: Send 0.05 ETH to Alice
      deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        amount: '0.05',
        recipient: 'Alice',
        confidence: 0.95
      });

      const res1 = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Send 0.05 ETH to Alice' })
      });
      const data1 = await res1.json();
      assert.strictEqual(data1.intent.action, 'send_eth');
      assert.strictEqual(data1.preview.asset, 'ETH');
      const token1 = data1.approvalToken;

      // 2. Revised request: User changes asset to USDC: Send 25 USDC to Alice
      deps.generateFn = async () => JSON.stringify({
        action: 'send_usdc',
        amount: '25',
        recipient: 'Alice',
        confidence: 0.97
      });

      const res2 = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Send 25 USDC to Alice' })
      });
      const data2 = await res2.json();
      assert.strictEqual(data2.intent.action, 'send_usdc');
      assert.strictEqual(data2.preview.asset, 'USDC');
      assert.strictEqual(data2.preview.contractAddress?.toLowerCase(), CIRCLE_SEPOLIA_USDC_ADDRESS.toLowerCase());
      assert.strictEqual(data2.preview.amount, '25');
      assert.strictEqual(data2.preview.amountRaw, '25000000');
      assert.notStrictEqual(token1, data2.approvalToken);

      // Verify token1 cannot be used for USDC execution
      const staleUsdcExec = await fetch(`${baseUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: { action: 'send_usdc', amount: '25', recipient: 'Alice', confidence: 0.97 },
          confirmed: true,
          approvalToken: token1
        })
      });
      const staleUsdcData = await staleUsdcExec.json();
      assert.strictEqual(staleUsdcExec.status, 403);
      assert.strictEqual(staleUsdcData.error, 'Mismatched approval token asset.');
    });
  });

  describe('3. Mismatch Display Data and Plan Card Attributes', () => {
    it('should return complete Plan Card attributes distinguishing confirmed facts from estimates', async () => {
      mock.method(publicClient, 'getChainId', async () => 11155111);
      mock.method(publicClient, 'getBalance', async () => parseEther('5'));
      mock.method(publicClient, 'estimateGas', async () => 21000n);
      mock.method(publicClient, 'getGasPrice', async () => parseEther('0.000000001'));

      deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        amount: '0.02',
        recipient: 'Rahul',
        confidence: 0.99
      });

      const res = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Send 0.02 ETH to Rahul' })
      });
      const data = await res.json();

      // Confirmed facts
      assert.strictEqual(data.intent.action, 'send_eth');
      assert.strictEqual(data.intent.amount, '0.02');
      assert.strictEqual(data.intent.recipient, 'Rahul');
      assert.strictEqual(data.resolvedAddress.toLowerCase(), '0x1d9f6830b29773733411736db3883cba9a5f93ac');
      assert.strictEqual(data.preview.recipient.toLowerCase(), '0x1d9f6830b29773733411736db3883cba9a5f93ac');
      assert.strictEqual(data.preview.asset, 'ETH');
      assert.strictEqual(data.preview.network, 'sepolia');

      // Estimated runtime parameters
      assert.strictEqual(data.preview.estimatedGas, '21000');
      assert.strictEqual(typeof data.preview.gasCostEth, 'string');
      assert.strictEqual(typeof data.preview.totalCostEth, 'string');
      assert.strictEqual(data.preview.simulationStatus, 'success');
      assert.strictEqual(data.risk.verdict, 'PASS');
      assert.ok(data.approvalToken);
    });

    it('should return read-only balance without preview or approval token for balance queries', async () => {
      mock.method(publicClient, 'getChainId', async () => 11155111);
      mock.method(publicClient, 'getBalance', async () => parseEther('4.25'));

      deps.generateFn = async () => JSON.stringify({
        action: 'balance',
        confidence: 0.99
      });

      const res = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'What is my balance?' })
      });
      const data = await res.json();

      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.intent.action, 'balance');
      assert.strictEqual(data.balance.balanceEth, '4.25');
      assert.strictEqual(data.balance.network, 'sepolia');
      assert.ok(data.balance.walletAddress.startsWith('0x'));

      // Invariant: Balance queries NEVER provide preview or approval tokens
      assert.strictEqual(data.preview, undefined);
      assert.strictEqual(data.approvalToken, undefined);
    });
  });

  describe('4. Blocked and Warned States (Zero Authorization Invariant)', () => {
    it('should NEVER return an approval token when firewall issues BLOCK (unknown contact)', async () => {
      deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        amount: '1',
        recipient: 'UnknownContact123',
        confidence: 0.95
      });

      const res = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Send 1 ETH to UnknownContact123' })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 400);
      assert.strictEqual(data.error, 'Unknown recipient');
      assert.strictEqual(data.approvalToken, undefined);
    });

    it('should NEVER return an approval token when firewall issues WARN (>50% balance threshold)', async () => {
      mock.method(publicClient, 'getChainId', async () => 11155111);
      mock.method(publicClient, 'getBalance', async () => parseEther('1')); // 1 ETH total balance
      mock.method(publicClient, 'estimateGas', async () => 21000n);
      mock.method(publicClient, 'getGasPrice', async () => 1000000000n);

      // 0.8 ETH is > 50% of 1 ETH (WARN)
      deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        amount: '0.8',
        recipient: 'Rahul',
        confidence: 0.95
      });

      const res = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Send 0.8 ETH to Rahul' })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.risk.verdict, 'WARN');
      assert.strictEqual(data.approvalToken, undefined);

      // Attempting to execute with empty or missing token must be denied
      const execRes = await fetch(`${baseUrl}/api/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: data.intent,
          confirmed: true,
          approvalToken: ''
        })
      });
      const execData = await execRes.json();
      assert.strictEqual(execRes.status, 403);
      assert.strictEqual(execData.error, 'Missing approval token.');
    });

    it('should NEVER return an approval token when EVM simulation reverts', async () => {
      mock.method(publicClient, 'getChainId', async () => 11155111);
      mock.method(publicClient, 'getBalance', async () => parseEther('5'));
      mock.method(publicClient, 'estimateGas', async () => {
        throw new Error('execution reverted: ERC20: transfer amount exceeds balance');
      });
      mock.method(publicClient, 'getGasPrice', async () => 1000000000n);

      deps.generateFn = async () => JSON.stringify({
        action: 'send_eth',
        amount: '1',
        recipient: 'Rahul',
        confidence: 0.95
      });

      const res = await fetch(`${baseUrl}/api/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'Send 1 ETH to Rahul' })
      });
      const data = await res.json();
      assert.strictEqual(res.status, 200);
      assert.strictEqual(data.preview.simulationStatus, 'failed');
      assert.strictEqual(data.risk.verdict, 'BLOCK');
      assert.strictEqual(data.approvalToken, undefined);
    });
  });
});
