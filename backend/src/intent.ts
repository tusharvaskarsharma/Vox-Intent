export type Action = 'balance' | 'send_eth' | 'send_usdc';
import { isAddress } from 'viem';
import { getContactsCollection } from './db';

export interface BaseIntent {
  action: Action;
  confidence: number;
}

export interface BalanceIntent extends BaseIntent {
  action: 'balance';
}

export interface SendEthIntent extends BaseIntent {
  action: 'send_eth';
  amount: string;
  recipient: string;
}

export interface SendUsdcIntent extends BaseIntent {
  action: 'send_usdc';
  amount: string;
  recipient: string;
}

export type SendIntent = SendEthIntent | SendUsdcIntent;
export type VoiceIntent = BalanceIntent | SendEthIntent | SendUsdcIntent;

export const CONFIDENCE_THRESHOLD = 0.90;

export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function validateIntent(payload: any): Promise<{ valid: true; intent: VoiceIntent; resolvedAddress?: string } | { valid: false; error: string }> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, error: 'Invalid payload format' };
  }

  const { action, confidence } = payload;
  const payloadKeys = Object.keys(payload);

  if (action !== 'balance' && action !== 'send_eth' && action !== 'send_usdc') {
    return { valid: false, error: 'Invalid or missing action' };
  }

  if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) {
    return { valid: false, error: 'Confidence must be a number between 0 and 1' };
  }

  if (confidence < CONFIDENCE_THRESHOLD) {
    return { valid: false, error: 'Low-confidence intent' };
  }

  if (action === 'balance') {
    const allowedBalanceKeys = ['action', 'confidence'];
    if (payloadKeys.some(key => !allowedBalanceKeys.includes(key))) {
      return { valid: false, error: 'Unexpected fields in intent payload' };
    }
    return {
      valid: true,
      intent: { action, confidence } as BalanceIntent
    };
  }

  if (action === 'send_eth' || action === 'send_usdc') {
    const allowedSendKeys = ['action', 'confidence', 'amount', 'recipient'];
    if (payloadKeys.some(key => !allowedSendKeys.includes(key))) {
      return { valid: false, error: 'Unexpected fields in intent payload' };
    }

    const { amount, recipient } = payload;
    let validAmountStr: string | null = null;
    if (typeof amount === 'string') {
      const trimmed = amount.trim();
      // Strictly validated positive decimal string (no scientific notation, no trailing garbage)
      if (/^(?:0|[1-9]\d*)(\.\d+)?$/.test(trimmed) && !/^0+(\.0+)?$/.test(trimmed)) {
        validAmountStr = trimmed;
      }
    }

    if (!validAmountStr) {
      return { valid: false, error: 'Invalid amount' };
    }

    if (action === 'send_usdc') {
      const parts = validAmountStr.split('.');
      if (parts[1] && parts[1].length > 6) {
        return { valid: false, error: 'USDC amounts cannot exceed 6 decimal places' };
      }
    }

    if (action === 'send_eth') {
      const parts = validAmountStr.split('.');
      if (parts[1] && parts[1].length > 18) {
        return { valid: false, error: 'ETH amounts cannot exceed 18 decimal places' };
      }
    }

    if (typeof recipient !== 'string' || recipient.trim() === '') {
      return { valid: false, error: 'Invalid recipient' };
    }

    const contacts = getContactsCollection();
    const normalizedName = recipient.trim();
    const escapedName = escapeRegex(normalizedName);
    
    // Case insensitive lookup using escaped regex
    const contact = await contacts.findOne({ name: { $regex: new RegExp(`^${escapedName}$`, 'i') } });

    if (!contact || !contact.walletAddress) {
      return { valid: false, error: 'Unknown recipient' };
    }

    if (!isAddress(contact.walletAddress)) {
      return { valid: false, error: 'Recipient address is not a valid Ethereum address' };
    }

    return {
      valid: true,
      intent: { action, confidence, amount: validAmountStr, recipient } as (SendEthIntent | SendUsdcIntent),
      resolvedAddress: contact.walletAddress
    };
  }

  return { valid: false, error: 'Unknown error' };
}
