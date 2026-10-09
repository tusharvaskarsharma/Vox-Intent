import { describe, it } from 'node:test';
import assert from 'node:assert';
import { SendIntent } from './intent';
import { parseEther } from 'viem';
import dotenv from 'dotenv';
import path from 'path';

// Load real env vars (which sets SEPOLIA_RPC_URL)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Dynamically generate an empty wallet for testing insufficient balance, avoiding hardcoded key literals
const dummyTestPrivateKey = generatePrivateKey();
process.env.SEPOLIA_PRIVATE_KEY = dummyTestPrivateKey;
const dummyTestAccount = privateKeyToAccount(dummyTestPrivateKey);

describe('Blockchain Module (Integration - Requires Live RPC)', () => {
  it('should hit the real Sepolia RPC and report insufficient balance for empty wallet', { timeout: 30000 }, async () => {
    // Dynamically import blockchain AFTER env vars are established
    const { constructUnsignedTransaction } = await import('./blockchain');

    const intent: SendIntent = { action: 'send_eth', amount: '9999', confidence: 0.99, recipient: 'Rahul' };
    const resolvedAddress = '0x1234567890123456789012345678901234567890';
    
    try {
      await constructUnsignedTransaction(intent, resolvedAddress);
      assert.fail('Should have thrown an error');
    } catch (err: any) {
      if (err.message.includes('Insufficient wallet balance')) {
        assert.ok(true);
      } else {
        assert.fail(`Network/RPC error occurred: ${err.message}`);
      }
    }
  });

  it('should fail simulation for transferring from empty wallet (or timeout on RPC)', { timeout: 30000 }, async () => {
    const { simulateAndPreviewTransaction } = await import('./blockchain');

    const unsignedTx = {
      to: '0x1234567890123456789012345678901234567890' as `0x${string}`,
      value: parseEther('9999'),
      from: dummyTestAccount.address,
      chainId: 11155111
    };

    try {
      const preview = await simulateAndPreviewTransaction(unsignedTx);
      if (preview.simulationStatus === 'failed') {
        assert.ok(true);
      } else {
        assert.fail('Simulation should have failed');
      }
    } catch (err: any) {
      assert.fail(`Network error: ${err.message}`);
    }
  });
});
