import { describe, it, mock, afterEach } from 'node:test';
import assert from 'node:assert';
import { constructUnsignedTransaction, getSenderAccount, publicClient, simulateAndPreviewTransaction } from './blockchain';
import { SendIntent } from './intent';
import { parseEther } from 'viem';

process.env.SEPOLIA_PRIVATE_KEY = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('Blockchain Module (Local Validation)', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should generate an account from private key', () => {
    const account = getSenderAccount();
    assert.strictEqual(account.address.startsWith('0x'), true);
  });

  it('should throw on invalid Ethereum recipient address', async () => {
    const intent: SendIntent = { action: 'send', amount: 1, confidence: 0.99, recipient: 'Rahul' };
    try {
      await constructUnsignedTransaction(intent, 'not-an-address');
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.strictEqual(err.message, 'Invalid Ethereum recipient address');
    }
  });

  it('should throw on non-positive amount', async () => {
    const intent: SendIntent = { action: 'send', amount: -1, confidence: 0.99, recipient: 'Rahul' };
    const resolvedAddress = '0x1234567890123456789012345678901234567890';
    try {
      await constructUnsignedTransaction(intent, resolvedAddress);
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.strictEqual(err.message, 'Amount must be strictly positive');
    }
  });

  it('should throw insufficient balance using mocked RPC', async () => {
    mock.method(publicClient, 'getBalance', async () => parseEther('0.5'));

    const intent: SendIntent = { action: 'send', amount: 1, confidence: 0.99, recipient: 'Rahul' };
    const resolvedAddress = '0x1234567890123456789012345678901234567890';
    
    try {
      await constructUnsignedTransaction(intent, resolvedAddress);
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.ok(err.message.includes('Insufficient wallet balance'));
    }
  });
  
  it('should succeed transaction construction using mocked RPC', async () => {
    mock.method(publicClient, 'getBalance', async () => parseEther('10'));

    const intent: SendIntent = { action: 'send', amount: 1, confidence: 0.99, recipient: 'Rahul' };
    const resolvedAddress = '0x1234567890123456789012345678901234567890';
    
    const tx = await constructUnsignedTransaction(intent, resolvedAddress);
    assert.strictEqual(tx.to, resolvedAddress);
    assert.strictEqual(tx.value, parseEther('1'));
  });
});

describe('Simulation Module (Local Validation)', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should successfully simulate and preview transaction', async () => {
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => parseEther('0.000000001')); // 1 gwei
    
    const unsignedTx = {
      to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      value: parseEther('1'),
      from: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`,
      chainId: 11155111
    };

    const preview = await simulateAndPreviewTransaction(unsignedTx);
    assert.strictEqual(preview.simulationStatus, 'success');
    assert.strictEqual(preview.estimatedGas, '21000');
    assert.strictEqual(preview.amountEth, '1');
    assert.strictEqual(preview.network, 'sepolia');
  });

  it('should return failed status when simulation fails', async () => {
    mock.method(publicClient, 'estimateGas', async () => {
      throw new Error('Execution reverted');
    });
    mock.method(publicClient, 'getGasPrice', async () => parseEther('0.000000001'));

    const unsignedTx = {
      to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      value: parseEther('1'),
      from: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`,
      chainId: 11155111
    };

    const preview = await simulateAndPreviewTransaction(unsignedTx);
    assert.strictEqual(preview.simulationStatus, 'failed');
    assert.ok(preview.failureReason?.includes('Execution reverted'));
  });
});
