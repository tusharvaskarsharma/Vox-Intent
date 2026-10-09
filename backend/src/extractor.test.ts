import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { extractIntent, deps } from './extractor';

describe('Intent Extractor', () => {
    let originalGenerateFn: any;

    beforeEach(() => {
        originalGenerateFn = deps.generateFn;
    });

    afterEach(() => {
        deps.generateFn = originalGenerateFn;
    });

    it('should extract a valid send_eth intent', async () => {
        deps.generateFn = async () => JSON.stringify({
            action: 'send_eth',
            confidence: 0.99,
            amount: '0.0001',
            recipient: 'Rahul'
        });

        const intent = await extractIntent("Send 0.0001 ETH to Rahul");
        assert.strictEqual(intent.action, 'send_eth');
        assert.strictEqual(intent.confidence, 0.99);
        assert.strictEqual(intent.amount, '0.0001');
        assert.strictEqual(intent.recipient, 'Rahul');
    });

    it('should extract a valid send_usdc intent', async () => {
        deps.generateFn = async () => JSON.stringify({
            action: 'send_usdc',
            confidence: 0.98,
            amount: '50',
            recipient: 'Alice'
        });

        const intent = await extractIntent("Send 50 USDC to Alice");
        assert.strictEqual(intent.action, 'send_usdc');
        assert.strictEqual(intent.confidence, 0.98);
        assert.strictEqual(intent.amount, '50');
        assert.strictEqual(intent.recipient, 'Alice');
    });

    it('should extract a valid balance intent', async () => {
        deps.generateFn = async () => JSON.stringify({
            action: 'balance',
            confidence: 0.95
        });

        const intent = await extractIntent("Check my balance");
        assert.strictEqual(intent.action, 'balance');
        assert.strictEqual(intent.confidence, 0.95);
    });

    it('should handle missing missing/invalid responses by throwing JSON parse error', async () => {
        deps.generateFn = async () => '';
        await assert.rejects(
            async () => await extractIntent("Do something weird"),
            /Failed to extract intent|Unexpected end of JSON input|Expected property name/
        );
    });

    it('should prefer Gemini result when Gemini succeeds and not silently use regex', async () => {
        // Even if user says "Send 0.01 ETH to Alice", if Gemini extracts confidence 0.88, Gemini result stands
        deps.generateFn = async () => JSON.stringify({
            action: 'send_eth',
            confidence: 0.88,
            amount: '0.01',
            recipient: 'Alice'
        });

        const intent = await extractIntent("Send 0.01 ETH to Alice");
        assert.strictEqual(intent.action, 'send_eth');
        assert.strictEqual(intent.confidence, 0.88); // Not 1.0 from fallback!
        assert.strictEqual(intent.amount, '0.01');
    });

    it('should invoke fallback when Gemini throws a provider error', async () => {
        deps.generateFn = async () => {
            throw new Error('Gemini API 503 Service Unavailable');
        };

        const intent = await extractIntent("Send 0.01 ETH to Alice");
        assert.strictEqual(intent.action, 'send_eth');
        assert.strictEqual(intent.amount, '0.01');
        assert.strictEqual(intent.recipient, 'Alice');
        assert.strictEqual(intent.confidence, 1.0);
    });

    it('should invoke fallback when Gemini times out', async () => {
        const originalTimeout = deps.timeoutMs;
        deps.timeoutMs = 15; // Set tiny timeout
        deps.generateFn = async () => {
            await new Promise((resolve) => setTimeout(resolve, 100)); // Hangs longer than timeout
            return JSON.stringify({ action: 'balance', confidence: 0.5 });
        };

        try {
            const intent = await extractIntent("Check my balance");
            assert.strictEqual(intent.action, 'balance');
            assert.strictEqual(intent.confidence, 1.0);
        } finally {
            deps.timeoutMs = originalTimeout;
        }
    });

    it('should invoke fallback when Gemini returns malformed/unusable output', async () => {
        deps.generateFn = async () => '<html>502 Bad Gateway</html>';

        const intent = await extractIntent("Send 5 USDC to Alice");
        assert.strictEqual(intent.action, 'send_usdc');
        assert.strictEqual(intent.amount, '5');
        assert.strictEqual(intent.recipient, 'Alice');
        assert.strictEqual(intent.confidence, 1.0);
    });

    it('should fail closed when Gemini fails and fallback cannot parse ambiguous request', async () => {
        deps.generateFn = async () => {
            throw new Error('Secret API Key or Internal Provider Error');
        };

        await assert.rejects(
            async () => await extractIntent("Stake 100 ETH into Lido pool"),
            (err: any) => {
                // Must not leak internal provider error message
                assert.ok(!err.message.includes('Secret API Key'));
                assert.ok(err.message.includes('Failed to extract intent'));
                return true;
            }
        );
    });
});
