import './test-setup';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseFallbackIntent } from './fallback';

describe('Deterministic Regex Fallback Parser', () => {
  describe('Balance Patterns', () => {
    const validBalancePhrases = [
      'Check my balance',
      'check my balance.',
      'check my balance?',
      'check balance',
      'my balance',
      'what is my balance',
      'what is my balance?',
      "what's my balance",
      'show my balance',
      'show balance',
      'get my balance',
      'view my balance',
      'balance',
      '  CHECK MY BALANCE  ',
    ];

    for (const phrase of validBalancePhrases) {
      it(`should parse valid balance phrase: "${phrase}"`, () => {
        const result = parseFallbackIntent(phrase);
        assert.strictEqual(result.action, 'balance');
        assert.strictEqual(result.confidence, 1.0);
        assert.strictEqual(result.amount, undefined);
        assert.strictEqual(result.recipient, undefined);
      });
    }

    it('should reject balance phrases with trailing extra words', () => {
      const invalidPhrases = [
        'check my balance on sepolia',
        'check my balance for Alice',
        'show my balance now',
        'balance of rahul',
      ];
      for (const phrase of invalidPhrases) {
        assert.throws(() => parseFallbackIntent(phrase), /Unable to parse request/);
      }
    });
  });

  describe('ETH Transfer Patterns', () => {
    it('should parse valid ETH send phrases', () => {
      const res1 = parseFallbackIntent('Send 0.01 ETH to Alice');
      assert.deepStrictEqual(res1, {
        action: 'send_eth',
        amount: '0.01',
        recipient: 'Alice',
        confidence: 1.0,
      });

      const res2 = parseFallbackIntent('send 10 ether to Bob.');
      assert.deepStrictEqual(res2, {
        action: 'send_eth',
        amount: '10',
        recipient: 'Bob',
        confidence: 1.0,
      });

      const res3 = parseFallbackIntent('Transfer 1.5 ETH to Rahul');
      assert.deepStrictEqual(res3, {
        action: 'send_eth',
        amount: '1.5',
        recipient: 'Rahul',
        confidence: 1.0,
      });

      const res4 = parseFallbackIntent('transfer 0.000000000000000001 ether to Alice');
      assert.strictEqual(res4.action, 'send_eth');
      assert.strictEqual(res4.amount, '0.000000000000000001');
    });

    it('should reject ETH transfer with more than 18 decimal places', () => {
      assert.throws(
        () => parseFallbackIntent('Send 0.0000000000000000001 ETH to Alice'),
        /ETH amounts cannot exceed 18 decimal places/
      );
    });
  });

  describe('USDC Transfer Patterns', () => {
    it('should parse valid USDC send phrases', () => {
      const res1 = parseFallbackIntent('Send 2 USDC to Alice');
      assert.deepStrictEqual(res1, {
        action: 'send_usdc',
        amount: '2',
        recipient: 'Alice',
        confidence: 1.0,
      });

      const res2 = parseFallbackIntent('transfer 50.123456 usdc to Rahul.');
      assert.deepStrictEqual(res2, {
        action: 'send_usdc',
        amount: '50.123456',
        recipient: 'Rahul',
        confidence: 1.0,
      });

      const res3 = parseFallbackIntent('Send 100 USDC to Alice');
      assert.strictEqual(res3.amount, '100');
    });

    it('should reject USDC transfer with more than 6 decimal places', () => {
      assert.throws(
        () => parseFallbackIntent('Send 1.1234567 USDC to Alice'),
        /USDC amounts cannot exceed 6 decimal places/
      );
      assert.throws(
        () => parseFallbackIntent('Send 0.0000001 USDC to Alice'),
        /USDC amounts cannot exceed 6 decimal places/
      );
    });
  });

  describe('Recipient Validation & Security', () => {
    it('should reject arbitrary Ethereum wallet addresses', () => {
      const rawAddress = '0x1D9f6830b29773733411736db3883cBA9a5f93AC';
      assert.throws(
        () => parseFallbackIntent(`Send 0.01 ETH to ${rawAddress}`),
        /Arbitrary wallet addresses are not supported in fallback requests/
      );
      assert.throws(
        () => parseFallbackIntent(`Send 50 USDC to ${rawAddress}`),
        /Arbitrary wallet addresses are not supported in fallback requests/
      );
    });

    it('should reject chained clauses and ambiguous trailing text', () => {
      const chained = [
        'Send 1 ETH to Alice and 2 to Bob',
        'Send 1 ETH to Alice then check balance',
        'Send 1 ETH to Alice with low gas',
        'Send 1 ETH to Alice after 5 minutes',
      ];
      for (const phrase of chained) {
        assert.throws(() => parseFallbackIntent(phrase), /Ambiguous request with chained clauses/);
      }
    });

    it('should reject recipient names with invalid punctuation or characters', () => {
      assert.throws(
        () => parseFallbackIntent('Send 1 ETH to Alice$'),
        /Recipient name contains invalid characters/
      );
      assert.throws(
        () => parseFallbackIntent('Send 1 ETH to Alice!'),
        /Recipient name contains invalid characters/
      );
    });
  });

  describe('Amount Format & Precision Constraints', () => {
    it('should reject zero amounts', () => {
      assert.throws(() => parseFallbackIntent('Send 0 ETH to Alice'), /Invalid amount "0"/);
      assert.throws(() => parseFallbackIntent('Send 0.0 ETH to Alice'), /Invalid amount "0.0"/);
      assert.throws(() => parseFallbackIntent('Send 0.000000 USDC to Alice'), /Invalid amount "0.000000"/);
    });

    it('should reject negative amounts', () => {
      assert.throws(() => parseFallbackIntent('Send -1 ETH to Alice'), /Invalid amount "-1"/);
      assert.throws(() => parseFallbackIntent('Send -0.5 USDC to Alice'), /Invalid amount "-0.5"/);
    });

    it('should reject scientific / exponent notation', () => {
      assert.throws(() => parseFallbackIntent('Send 1e-4 ETH to Alice'), /Invalid amount "1e-4"/);
      assert.throws(() => parseFallbackIntent('Send 1E2 USDC to Alice'), /Invalid amount "1E2"/);
    });

    it('should reject malformed numbers', () => {
      assert.throws(() => parseFallbackIntent('Send .5 ETH to Alice'), /Invalid amount "\.5"/);
      assert.throws(() => parseFallbackIntent('Send 1. ETH to Alice'), /Invalid amount "1\."/);
      assert.throws(() => parseFallbackIntent('Send 1.2.3 ETH to Alice'), /Invalid amount "1\.2\.3"/);
      assert.throws(() => parseFallbackIntent('Send abc ETH to Alice'), /Invalid amount "abc"/);
    });
  });

  describe('Missing Information and Ambiguous Patterns', () => {
    it('should reject requests missing amount', () => {
      assert.throws(() => parseFallbackIntent('Send ETH to Alice'), /Unable to parse request/);
      assert.throws(() => parseFallbackIntent('Send USDC to Alice'), /Unable to parse request/);
    });

    it('should reject requests missing asset', () => {
      assert.throws(() => parseFallbackIntent('Send 5 to Alice'), /Unable to parse request/);
      assert.throws(() => parseFallbackIntent('Transfer 10 to Rahul'), /Unable to parse request/);
    });

    it('should reject requests missing recipient', () => {
      assert.throws(() => parseFallbackIntent('Send 5 ETH'), /Unable to parse request/);
      assert.throws(() => parseFallbackIntent('Send 10 USDC to'), /Unable to parse request/);
    });

    it('should reject unsupported actions (e.g. swap, stake, buy)', () => {
      assert.throws(() => parseFallbackIntent('Swap 1 ETH for USDC'), /Unable to parse request/);
      assert.throws(() => parseFallbackIntent('Stake 5 ETH'), /Unable to parse request/);
      assert.throws(() => parseFallbackIntent('Buy 10 USDC'), /Unable to parse request/);
    });

    it('should reject empty or whitespace input', () => {
      assert.throws(() => parseFallbackIntent(''), /Request text cannot be empty/);
      assert.throws(() => parseFallbackIntent('   '), /Request text cannot be empty/);
    });
  });
});
