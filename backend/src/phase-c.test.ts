import './test-setup';
import { describe, it, before, after, afterEach, mock } from 'node:test';
import assert from 'node:assert';
import { app, approvalTokens } from './index';
import { publicClient, walletClient, CIRCLE_SEPOLIA_USDC_ADDRESS, getSenderAccount } from './blockchain';
import { parseEther, parseUnits } from 'viem';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDB, closeDB, getContactsCollection } from './db';
import crypto from 'crypto';

describe('VoxIntent Phase C: Post-Execution Balance Verification and Checklist', () => {
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

  // Helper to issue an approval token for test execution with current account address
  function createApprovalToken(opts: {
    asset: 'ETH' | 'USDC';
    amount: string;
    recipient: string;
    contractAddress?: string;
    estimatedGas?: string;
    maxCostEth?: string;
  }) {
    const token = crypto.randomUUID();
    const account = getSenderAccount();
    const amountRaw = opts.asset === 'ETH'
      ? parseEther(opts.amount).toString()
      : parseUnits(opts.amount, 6).toString();

    approvalTokens.set(token, {
      asset: opts.asset,
      contractAddress: opts.contractAddress,
      sender: account.address.toLowerCase(),
      recipient: opts.recipient.toLowerCase(),
      amount: opts.amount,
      amountRaw,
      network: 'sepolia',
      estimatedGas: opts.estimatedGas || '21000',
      maxCostEth: opts.maxCostEth || '0.2',
      expiresAt: Date.now() + 60000
    });
    return token;
  }

  it('1. Successful ETH transfer including gas accounting', async () => {
    const token = createApprovalToken({
      asset: 'ETH',
      amount: '0.1',
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      estimatedGas: '21000',
      maxCostEth: '0.2'
    });

    const preBalance = parseEther('10');
    const transferValue = parseEther('0.1');
    const gasUsed = 21000n;
    const effectiveGasPrice = 2000000000n; // 2 gwei
    const actualGasFeeWei = gasUsed * effectiveGasPrice;
    const postBalance = preBalance - transferValue - actualGasFeeWei;

    let isBroadcasted = false;
    mock.method(publicClient, 'getBalance', async () => {
      return isBroadcasted ? postBalance : preBalance;
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n);
    mock.method(walletClient, 'sendTransaction', async () => {
      isBroadcasted = true;
      return '0xethsuccesshash123';
    });
    mock.method(publicClient, 'waitForTransactionReceipt', async () => ({
      status: 'success',
      blockNumber: 1234567n,
      gasUsed,
      effectiveGasPrice
    }));
    mock.method(publicClient, 'getTransaction', async () => ({
      to: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      value: transferValue
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
    assert.strictEqual(data.pending, false);
    assert.strictEqual(data.hash, '0xethsuccesshash123');

    // Verification Checklist checks
    assert.ok(Array.isArray(data.checklist));
    assert.strictEqual(data.checklist.length, 5);
    for (const item of data.checklist) {
      assert.strictEqual(item.status, 'passed', `Checklist item ${item.id} should be passed`);
    }

    // Balance Verification checks
    assert.strictEqual(data.balanceVerification.status, 'passed');
    assert.strictEqual(data.balanceVerification.asset, 'ETH');
    assert.strictEqual(data.balanceVerification.preSenderEth, preBalance.toString());
    assert.strictEqual(data.balanceVerification.postSenderEth, postBalance.toString());
    assert.strictEqual(data.balanceVerification.senderEthDelta, (transferValue + actualGasFeeWei).toString());
    assert.strictEqual(data.balanceVerification.actualGasFeeWei, actualGasFeeWei.toString());
    assert.strictEqual(data.balanceVerification.expectedTransferUnits, transferValue.toString());
  });

  it('2. Successful USDC transfer including sender and recipient token balance deltas', async () => {
    const token = createApprovalToken({
      asset: 'USDC',
      amount: '25',
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      contractAddress: CIRCLE_SEPOLIA_USDC_ADDRESS,
      estimatedGas: '65000',
      maxCostEth: '0.2'
    });

    const preSenderEth = parseEther('1');
    const gasUsed = 65000n;
    const effectiveGasPrice = 2000000000n;
    const actualGasFeeWei = gasUsed * effectiveGasPrice;
    const postSenderEth = preSenderEth - actualGasFeeWei;

    const transferUnits = parseUnits('25', 6);
    const preSenderUsdc = parseUnits('100', 6);
    const postSenderUsdc = preSenderUsdc - transferUnits;
    const preRecipientUsdc = parseUnits('10', 6);
    const postRecipientUsdc = preRecipientUsdc + transferUnits;

    let isBroadcasted = false;
    mock.method(publicClient, 'getBalance', async () => {
      return isBroadcasted ? postSenderEth : preSenderEth;
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'estimateGas', async () => 65000n);
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n);

    mock.method(publicClient, 'readContract', async (params: any) => {
      if (params.functionName === 'decimals') return 6;
      if (params.functionName === 'balanceOf') {
        const addr = params.args[0].toLowerCase();
        if (addr === '0x1d9f6830b29773733411736db3883cba9a5f93ac') {
          return isBroadcasted ? postRecipientUsdc : preRecipientUsdc;
        } else {
          return isBroadcasted ? postSenderUsdc : preSenderUsdc;
        }
      }
      return 0n;
    });

    mock.method(walletClient, 'sendTransaction', async () => {
      isBroadcasted = true;
      return '0xusdcsuccesshash123';
    });
    mock.method(publicClient, 'waitForTransactionReceipt', async () => ({
      status: 'success',
      blockNumber: 1234568n,
      gasUsed,
      effectiveGasPrice
    }));
    mock.method(publicClient, 'getTransaction', async () => ({
      to: CIRCLE_SEPOLIA_USDC_ADDRESS,
      input: '0xa9059cbb0000000000000000000000001d9f6830b29773733411736db3883cba9a5f93ac00000000000000000000000000000000000000000000000000000000017d7840'
    }));

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
    assert.strictEqual(res.status, 200);
    assert.strictEqual(data.success, true);
    assert.strictEqual(data.hash, '0xusdcsuccesshash123');

    // Checklist checks
    for (const item of data.checklist) {
      assert.strictEqual(item.status, 'passed', `Checklist item ${item.id} should be passed`);
    }

    // Balance Verification checks
    assert.strictEqual(data.balanceVerification.status, 'passed');
    assert.strictEqual(data.balanceVerification.asset, 'USDC');
    assert.strictEqual(data.balanceVerification.preSenderUsdc, preSenderUsdc.toString());
    assert.strictEqual(data.balanceVerification.postSenderUsdc, postSenderUsdc.toString());
    assert.strictEqual(data.balanceVerification.senderUsdcDelta, transferUnits.toString());
    assert.strictEqual(data.balanceVerification.preRecipientUsdc, preRecipientUsdc.toString());
    assert.strictEqual(data.balanceVerification.postRecipientUsdc, postRecipientUsdc.toString());
    assert.strictEqual(data.balanceVerification.recipientUsdcDelta, transferUnits.toString());
    assert.strictEqual(data.balanceVerification.actualGasFeeWei, actualGasFeeWei.toString());
  });

  it('3. Failed pre-execution balance reads preventing broadcast (fail-closed)', async () => {
    const token = createApprovalToken({
      asset: 'ETH',
      amount: '0.1',
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac'
    });

    let getBalanceCallCount = 0;
    mock.method(publicClient, 'getBalance', async () => {
      getBalanceCallCount++;
      // Calls 1, 2, 3 succeed for validation and transaction construction
      if (getBalanceCallCount <= 3) {
        return parseEther('10');
      }
      // Call 4: pre-execution balance read immediately before broadcast fails
      throw new Error('RPC connection dropped reading pre-execution balance');
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n);

    let sendTransactionCalled = false;
    mock.method(walletClient, 'sendTransaction', async () => {
      sendTransactionCalled = true;
      return '0xshouldneverbebroadcast';
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
    assert.strictEqual(res.status, 500);
    assert.ok(data.error.includes('Failed to capture pre-execution ETH balance before broadcast'));
    // CRITICAL SECURITY INVARIANT: Transaction was never signed or broadcast
    assert.strictEqual(sendTransactionCalled, false, 'sendTransaction must never be called if pre-balance read fails');
  });

  it('4. Post-execution RPC failures producing inconclusive without mislabeling as reverted', async () => {
    const token = createApprovalToken({
      asset: 'ETH',
      amount: '0.1',
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac'
    });

    const preBalance = parseEther('10');
    let isBroadcasted = false;
    mock.method(publicClient, 'getBalance', async () => {
      if (isBroadcasted) {
        // Post-execution balance query fails with RPC timeout
        throw new Error('RPC rate limit exceeded while querying post-execution balance');
      }
      return preBalance;
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n);
    mock.method(walletClient, 'sendTransaction', async () => {
      isBroadcasted = true;
      return '0xinconclusivehash123';
    });
    mock.method(publicClient, 'waitForTransactionReceipt', async () => ({
      status: 'success',
      blockNumber: 1234569n,
      gasUsed: 21000n,
      effectiveGasPrice: 2000000000n
    }));
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
    assert.strictEqual(data.hash, '0xinconclusivehash123');

    // Receipt is confirmed, but balance check is inconclusive
    const receiptItem = data.checklist.find((c: any) => c.id === 'receipt');
    assert.strictEqual(receiptItem.status, 'passed');

    const balanceItem = data.checklist.find((c: any) => c.id === 'balance');
    assert.strictEqual(balanceItem.status, 'inconclusive');

    assert.strictEqual(data.balanceVerification.status, 'inconclusive');
    assert.ok(data.balanceVerification.details.includes('inconclusive'));
    // CRITICAL: Must not mislabel the transaction as reverted
    assert.strictEqual(data.message.includes('revert'), false);
  });

  it('5. Unexpected balance deltas producing mismatch', async () => {
    const token = createApprovalToken({
      asset: 'ETH',
      amount: '0.1',
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac'
    });

    const preBalance = parseEther('10');
    // Simulate an unexpected post balance: only decreased by 0.01 ETH instead of 0.1 ETH + gas
    const unexpectedPostBalance = preBalance - parseEther('0.01');

    let isBroadcasted = false;
    mock.method(publicClient, 'getBalance', async () => {
      return isBroadcasted ? unexpectedPostBalance : preBalance;
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n);
    mock.method(walletClient, 'sendTransaction', async () => {
      isBroadcasted = true;
      return '0xmismatchhash123';
    });
    mock.method(publicClient, 'waitForTransactionReceipt', async () => ({
      status: 'success',
      blockNumber: 1234570n,
      gasUsed: 21000n,
      effectiveGasPrice: 2000000000n
    }));
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
    assert.strictEqual(data.hash, '0xmismatchhash123');

    // Receipt confirmed, but balance item failed
    const receiptItem = data.checklist.find((c: any) => c.id === 'receipt');
    assert.strictEqual(receiptItem.status, 'passed');

    const balanceItem = data.checklist.find((c: any) => c.id === 'balance');
    assert.strictEqual(balanceItem.status, 'failed');

    assert.strictEqual(data.balanceVerification.status, 'mismatch');
    assert.ok(data.balanceVerification.details.includes('mismatch'));
  });

  it('6. Pending receipt without premature verification', async () => {
    const token = createApprovalToken({
      asset: 'ETH',
      amount: '0.1',
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac'
    });

    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n);
    mock.method(walletClient, 'sendTransaction', async () => '0xpendingbroadcast123');
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
    assert.strictEqual(data.hash, '0xpendingbroadcast123');

    // Clear user message
    assert.ok(data.message.includes('confirmation timed out'));
    assert.ok(data.message.includes('receipt and balance verification pending'));

    // Checklist: hash is passed, all others MUST be pending
    const hashItem = data.checklist.find((c: any) => c.id === 'hash');
    assert.strictEqual(hashItem.status, 'passed');

    const pendingIds = ['receipt', 'recipient', 'intent', 'balance'];
    for (const id of pendingIds) {
      const item = data.checklist.find((c: any) => c.id === id);
      assert.strictEqual(item.status, 'pending', `Item ${id} should be pending while receipt is awaiting confirmation`);
    }

    assert.strictEqual(data.balanceVerification.status, 'pending');
  });

  it('7. Reverted receipt never showing successful confirmation', async () => {
    const token = createApprovalToken({
      asset: 'ETH',
      amount: '0.1',
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac'
    });

    mock.method(publicClient, 'getBalance', async () => parseEther('10'));
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n);
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
    assert.strictEqual(data.success, undefined);
  });

  it('8. Checklist status consistency', async () => {
    const token = createApprovalToken({
      asset: 'ETH',
      amount: '0.1',
      recipient: '0x1d9f6830b29773733411736db3883cba9a5f93ac'
    });

    const preBalance = parseEther('10');
    const transferValue = parseEther('0.1');
    const gasUsed = 21000n;
    const effectiveGasPrice = 2000000000n;
    const actualGasFeeWei = gasUsed * effectiveGasPrice;
    const postBalance = preBalance - transferValue - actualGasFeeWei;

    let isBroadcasted = false;
    mock.method(publicClient, 'getBalance', async () => {
      return isBroadcasted ? postBalance : preBalance;
    });

    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => 2000000000n);
    mock.method(walletClient, 'sendTransaction', async () => {
      isBroadcasted = true;
      return '0xconsistencyhash123';
    });
    mock.method(publicClient, 'waitForTransactionReceipt', async () => ({
      status: 'success',
      blockNumber: 1234571n,
      gasUsed,
      effectiveGasPrice
    }));
    mock.method(publicClient, 'getTransaction', async () => ({
      to: '0x1d9f6830b29773733411736db3883cba9a5f93ac',
      value: transferValue
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

    const validStatuses = ['passed', 'failed', 'pending', 'inconclusive'];
    const expectedIds = ['receipt', 'recipient', 'intent', 'balance', 'hash'];

    const actualIds = data.checklist.map((item: any) => item.id);
    for (const id of expectedIds) {
      assert.ok(actualIds.includes(id), `Checklist must include item id: ${id}`);
    }

    for (const item of data.checklist) {
      assert.ok(validStatuses.includes(item.status), `Item ${item.id} has invalid status ${item.status}`);
      assert.strictEqual(typeof item.label, 'string');
      assert.ok(item.label.length > 0);
    }
  });
});
