import './test-setup';
import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  constructUnsignedTransaction,
  getSenderAccount,
  publicClient,
  simulateAndPreviewTransaction,
  getSepoliaUsdcAddress,
  CIRCLE_SEPOLIA_USDC_ADDRESS
} from './blockchain';
import { SendIntent } from './intent';
import { parseEther, parseUnits } from 'viem';

describe('Blockchain Module (Local Validation)', () => {
  beforeEach(() => {
    mock.method(publicClient, 'getChainId', async () => 11155111);
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it('should generate an account from private key', () => {
    const account = getSenderAccount();
    assert.strictEqual(account.address.startsWith('0x'), true);
  });

  it('should throw on invalid Ethereum recipient address', async () => {
    const intent: SendIntent = { action: 'send_eth', amount: '1', confidence: 0.99, recipient: 'Rahul' };
    try {
      await constructUnsignedTransaction(intent, 'not-an-address');
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      assert.strictEqual(err.message, 'Invalid Ethereum recipient address');
    }
  });

  it('should throw on non-positive amount', async () => {
    const intent: SendIntent = { action: 'send_eth', amount: '-1', confidence: 0.99, recipient: 'Rahul' };
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

    const intent: SendIntent = { action: 'send_eth', amount: '1', confidence: 0.99, recipient: 'Rahul' };
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

    const intent: SendIntent = { action: 'send_eth', amount: '1', confidence: 0.99, recipient: 'Rahul' };
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
    assert.strictEqual(preview.totalCostEth, 'unknown');
    assert.strictEqual(preview.estimatedGas, 'unknown');
  });

  it('should fail closed when gas price retrieval fails (does not treat gas cost as zero)', async () => {
    mock.method(publicClient, 'estimateGas', async () => 21000n);
    mock.method(publicClient, 'getGasPrice', async () => {
      throw new Error('RPC gasPrice timeout');
    });

    const unsignedTx = {
      to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      value: parseEther('1'),
      from: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`,
      chainId: 11155111
    };

    const preview = await simulateAndPreviewTransaction(unsignedTx);
    assert.strictEqual(preview.simulationStatus, 'failed');
    assert.ok(preview.failureReason?.includes('Failed to retrieve gas price'));
    assert.strictEqual(preview.totalCostEth, 'unknown');
  });
});

import { assertSepoliaChainId } from './blockchain';

describe('Chain ID Validation', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it('should succeed when RPC reports Sepolia chain ID 11155111', async () => {
    mock.method(publicClient, 'getChainId', async () => 11155111);
    await assert.doesNotReject(async () => {
      await assertSepoliaChainId();
    });
  });

  it('should fail closed when RPC reports a different chain ID (e.g. Mainnet 1)', async () => {
    mock.method(publicClient, 'getChainId', async () => 1);
    await assert.rejects(async () => {
      await assertSepoliaChainId();
    }, /CRITICAL: RPC chain mismatch. Expected Sepolia chain ID 11155111, got 1/);
  });
});

describe('USDC Contract Configuration and ERC-20 Validation', () => {
  const originalEnv = process.env.SEPOLIA_USDC_CONTRACT_ADDRESS;

  afterEach(() => {
    process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = originalEnv;
    mock.restoreAll();
  });

  it('should return official Circle Sepolia address when configured correctly', () => {
    process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = CIRCLE_SEPOLIA_USDC_ADDRESS;
    const addr = getSepoliaUsdcAddress();
    assert.strictEqual(addr.toLowerCase(), CIRCLE_SEPOLIA_USDC_ADDRESS.toLowerCase());
  });

  it('should fail if SEPOLIA_USDC_CONTRACT_ADDRESS is missing', () => {
    delete process.env.SEPOLIA_USDC_CONTRACT_ADDRESS;
    assert.throws(() => {
      getSepoliaUsdcAddress();
    }, /SEPOLIA_USDC_CONTRACT_ADDRESS configuration is missing/);
  });

  it('should fail if SEPOLIA_USDC_CONTRACT_ADDRESS is not a valid address', () => {
    process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = 'not-an-address';
    assert.throws(() => {
      getSepoliaUsdcAddress();
    }, /is not a valid Ethereum address/);
  });

  it('should fail if SEPOLIA_USDC_CONTRACT_ADDRESS does not match Circle official address', () => {
    process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = '0x0000000000000000000000000000000000000001';
    assert.throws(() => {
      getSepoliaUsdcAddress();
    }, /does not match Circle official Sepolia USDC address/);
  });

  it('should throw if USDC contract returns decimals other than 6', async () => {
    process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = CIRCLE_SEPOLIA_USDC_ADDRESS;
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
      if (functionName === 'decimals') return 18; // Wrong decimals!
      return 1000000000n;
    });

    const intent: SendIntent = { action: 'send_usdc', amount: '10', confidence: 0.95, recipient: 'Alice' };
    await assert.rejects(async () => {
      await constructUnsignedTransaction(intent, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    }, /expected 6, got 18/);
  });

  it('should throw if sender has insufficient USDC balance', async () => {
    process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = CIRCLE_SEPOLIA_USDC_ADDRESS;
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'balanceOf') return parseUnits('5', 6); // Only 5 USDC, needs 10 USDC
      return 0n;
    });

    const intent: SendIntent = { action: 'send_usdc', amount: '10', confidence: 0.95, recipient: 'Alice' };
    await assert.rejects(async () => {
      await constructUnsignedTransaction(intent, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    }, /Insufficient USDC balance. Have 5 USDC, need 10 USDC/);
  });

  it('should throw if sender has 0 ETH for gas during USDC transfer', async () => {
    process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = CIRCLE_SEPOLIA_USDC_ADDRESS;
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'balanceOf') return parseUnits('50', 6); // Has 50 USDC
      return 0n;
    });
    mock.method(publicClient, 'getBalance', async () => 0n); // 0 ETH for gas

    const intent: SendIntent = { action: 'send_usdc', amount: '10', confidence: 0.95, recipient: 'Alice' };
    await assert.rejects(async () => {
      await constructUnsignedTransaction(intent, '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd');
    }, /Insufficient ETH for gas: account has 0 ETH/);
  });

  it('should successfully construct USDC transfer with valid ERC-20 transfer calldata', async () => {
    process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = CIRCLE_SEPOLIA_USDC_ADDRESS;
    mock.method(publicClient, 'getChainId', async () => 11155111);
    mock.method(publicClient, 'readContract', async ({ functionName }: any) => {
      if (functionName === 'decimals') return 6;
      if (functionName === 'balanceOf') return parseUnits('100', 6);
      return 0n;
    });
    mock.method(publicClient, 'getBalance', async () => parseEther('0.1')); // Enough ETH for gas

    const intent: SendIntent = { action: 'send_usdc', amount: '25.5', confidence: 0.95, recipient: 'Alice' };
    const recipientAddr = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`;
    const tx = await constructUnsignedTransaction(intent, recipientAddr);

    assert.strictEqual(tx.asset, 'USDC');
    assert.strictEqual(tx.to.toLowerCase(), CIRCLE_SEPOLIA_USDC_ADDRESS.toLowerCase());
    assert.strictEqual(tx.recipient?.toLowerCase(), recipientAddr.toLowerCase());
    assert.strictEqual(tx.value, 0n); // Native ETH value is 0
    assert.strictEqual(tx.tokenAmount, '25.5');
    assert.strictEqual(tx.tokenAmountUnits, parseUnits('25.5', 6));
    assert.ok(tx.data?.startsWith('0xa9059cbb')); // ERC-20 transfer selector
  });

  it('should simulate USDC token transfer and preview native ETH gas without treating USDC as ETH', async () => {
    mock.method(publicClient, 'estimateGas', async () => 65000n);
    mock.method(publicClient, 'getGasPrice', async () => parseEther('0.000000002')); // 2 gwei

    const usdcTx = {
      asset: 'USDC' as const,
      contractAddress: CIRCLE_SEPOLIA_USDC_ADDRESS as `0x${string}`,
      to: CIRCLE_SEPOLIA_USDC_ADDRESS as `0x${string}`,
      recipient: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      value: 0n,
      data: '0xa9059cbb0000' as `0x${string}`,
      from: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as `0x${string}`,
      chainId: 11155111,
      tokenAmount: '50',
      tokenAmountUnits: parseUnits('50', 6)
    };

    const preview = await simulateAndPreviewTransaction(usdcTx);
    assert.strictEqual(preview.simulationStatus, 'success');
    assert.strictEqual(preview.asset, 'USDC');
    assert.strictEqual(preview.amount, '50');
    assert.strictEqual(preview.amountRaw, '50000000');
    assert.strictEqual(preview.amountEth, '0');
    assert.strictEqual(preview.estimatedGas, '65000');
    assert.strictEqual(preview.gasCostEth, '0.00013');
    assert.strictEqual(preview.totalCostEth, '0.00013');
  });
});
