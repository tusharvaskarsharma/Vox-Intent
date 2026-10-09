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

    it('should extract a valid send intent', async () => {
        deps.generateFn = async () => JSON.stringify({
            action: 'send',
            confidence: 0.99,
            amount: 0.0001,
            recipient: 'Rahul'
        });

        const intent = await extractIntent("Send 0.0001 ETH to Rahul");
        assert.strictEqual(intent.action, 'send');
        assert.strictEqual(intent.confidence, 0.99);
        assert.strictEqual(intent.amount, 0.0001);
        assert.strictEqual(intent.recipient, 'Rahul');
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
});
