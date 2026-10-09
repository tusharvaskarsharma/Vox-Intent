import { Type, Schema } from '@google/genai';
import { generateContentWithSchema } from './llm';

const intentSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    action: {
      type: Type.STRING,
      description: "The action to perform. Must be either 'balance' or 'send'."
    },
    confidence: {
      type: Type.NUMBER,
      description: "The model's confidence in this extraction between 0.0 and 1.0. Set to 0 if the user is asking for an unsupported action, being ambiguous, or not making a clear request."
    },
    amount: {
      type: Type.NUMBER,
      description: "For 'send' actions, the amount of ETH to send. Omit for 'balance' or unsupported actions."
    },
    recipient: {
      type: Type.STRING,
      description: "For 'send' actions, the name of the recipient. Omit for 'balance' or unsupported actions."
    }
  },
  required: ['action', 'confidence']
};

export const deps = {
    generateFn: generateContentWithSchema
};

export async function extractIntent(
    text: string
): Promise<any> {
    const prompt = `You are an intent extraction engine for an Ethereum wallet. Convert the following natural language request into a strict intent schema. Supported actions are 'balance' and 'send'. Omit unsupported actions or give them a confidence of 0.\n\nRequest: "${text}"`;
    const responseText = await deps.generateFn(prompt, intentSchema);

    if (!responseText) {
        throw new Error("Failed to extract intent");
    }

    return JSON.parse(responseText);
}
