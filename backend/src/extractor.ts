import { Type, Schema } from '@google/genai';
import { generateContentWithSchema } from './llm';
import { parseFallbackIntent, FallbackIntent } from './fallback';

export { parseFallbackIntent, FallbackIntent };

export type ExtractedIntent =
  | { action: 'balance'; confidence: number }
  | { action: 'send_eth'; confidence: number; amount: string; recipient: string }
  | { action: 'send_usdc'; confidence: number; amount: string; recipient: string };

const intentSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      description: "The action to perform. Must be either 'balance', 'send_eth', or 'send_usdc'."
    },
    confidence: {
      type: Type.NUMBER,
      description: "The model's confidence in this extraction between 0.0 and 1.0. Set to 0 if the user is asking for an unsupported action, being ambiguous, or not making a clear request."
    },
    amount: {
      type: Type.STRING,
      description: "For 'send_eth' or 'send_usdc' actions, the amount as a positive decimal string (e.g. '0.0001' or '10'). Omit for 'balance' or unsupported actions."
    },
    recipient: {
      type: Type.STRING,
      description: "For 'send_eth' or 'send_usdc' actions, the name of the recipient. Omit for 'balance' or unsupported actions."
    }
  },
  required: ['action', 'confidence']
};

export const deps = {
    generateFn: generateContentWithSchema,
    timeoutMs: 10000
};

export async function extractIntent(
    text: string
): Promise<ExtractedIntent> {
    const prompt = `You are an intent extraction engine for an Ethereum wallet on Sepolia. Convert the following natural language request into a strict intent schema. Supported actions are 'balance', 'send_eth', and 'send_usdc'. Omit unsupported actions or give them a confidence of 0.\n\nRequest: "${text}"`;

    let geminiSuccess = false;
    let geminiResult: ExtractedIntent | null = null;

    let timeoutHandle: NodeJS.Timeout | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error('Gemini API call timed out'));
        }, deps.timeoutMs);
        if (timeoutHandle.unref) timeoutHandle.unref();
    });

    try {
        const responseText = await Promise.race([
            deps.generateFn(prompt, intentSchema),
            timeoutPromise
        ]);

        if (typeof responseText === 'string' && responseText.trim().length > 0) {
            let parsed: any;
            try {
                parsed = JSON.parse(responseText);
            } catch {
                parsed = null;
            }

            if (
                parsed &&
                typeof parsed === 'object' &&
                !Array.isArray(parsed) &&
                typeof parsed.confidence === 'number' &&
                Number.isFinite(parsed.confidence) &&
                parsed.confidence >= 0 &&
                parsed.confidence <= 1
            ) {
                if (parsed.action === 'balance') {
                    geminiSuccess = true;
                    geminiResult = {
                        action: 'balance',
                        confidence: parsed.confidence
                    };
                } else if (
                    (parsed.action === 'send_eth' || parsed.action === 'send_usdc') &&
                    typeof parsed.amount === 'string' &&
                    parsed.amount.trim().length > 0 &&
                    typeof parsed.recipient === 'string' &&
                    parsed.recipient.trim().length > 0
                ) {
                    geminiSuccess = true;
                    geminiResult = {
                        action: parsed.action,
                        confidence: parsed.confidence,
                        amount: parsed.amount.trim(),
                        recipient: parsed.recipient.trim()
                    };
                }
            }
        }
    } catch {
        geminiSuccess = false;
    } finally {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    }

    if (geminiSuccess && geminiResult) {
        return geminiResult;
    }

    // Gemini extraction failed, timed out, returned unusable/incomplete/malformed output, or was unavailable.
    // Invoke the deterministic regex fallback parser.
    return parseFallbackIntent(text) as ExtractedIntent;
}
