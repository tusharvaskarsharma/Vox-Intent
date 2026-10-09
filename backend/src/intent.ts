export type Action = 'balance' | 'send';
import { isAddress } from 'viem';
import { getContactsCollection } from './db';

export interface BaseIntent {
  action: Action;
  confidence: number;
}

export interface BalanceIntent extends BaseIntent {
  action: 'balance';
}

export interface SendIntent extends BaseIntent {
  action: 'send';
  amount: number;
  recipient: string;
}

export type VoiceIntent = BalanceIntent | SendIntent;

export const CONFIDENCE_THRESHOLD = 0.90;

export async function validateIntent(payload: any): Promise<{ valid: true; intent: VoiceIntent; resolvedAddress?: string } | { valid: false; error: string }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Invalid payload format' };
  }

  const allowedKeys = ['action', 'confidence', 'amount', 'recipient'];
  const payloadKeys = Object.keys(payload);
  if (payloadKeys.some(key => !allowedKeys.includes(key))) {
    return { valid: false, error: 'Unexpected fields in intent payload' };
  }

  const { action, confidence } = payload;

  if (action !== 'balance' && action !== 'send') {
    return { valid: false, error: 'Invalid or missing action' };
  }

  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    return { valid: false, error: 'Confidence must be a number between 0 and 1' };
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    return { valid: false, error: 'Low-confidence intent' };
  }

  if (action === 'balance') {
    return {
      valid: true,
      intent: { action, confidence } as BalanceIntent
    };
  }

  if (action === 'send') {
    const { amount, recipient } = payload;
    if (typeof amount !== 'number' || amount <= 0) {
      return { valid: false, error: 'Invalid amount' };
    }
    if (typeof recipient !== 'string' || recipient.trim() === '') {
      return { valid: false, error: 'Invalid recipient' };
    }

    const contacts = getContactsCollection();
    const normalizedName = recipient.trim();
    
    // Case insensitive lookup
    const contact = await contacts.findOne({ name: { $regex: new RegExp(`^${normalizedName}$`, 'i') } });

    if (!contact || !contact.walletAddress) {
      return { valid: false, error: 'Unknown recipient' };
    }

    if (!isAddress(contact.walletAddress)) {
      return { valid: false, error: 'Recipient address is not a valid Ethereum address' };
    }

    return {
      valid: true,
      intent: { action, confidence, amount, recipient } as SendIntent,
      resolvedAddress: contact.walletAddress
    };
  }

  return { valid: false, error: 'Unknown error' };
}
