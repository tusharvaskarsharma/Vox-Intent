import { isAddress } from 'viem';

/**
 * Supported fallback natural-language patterns:
 * 
 * 1. Balance Queries:
 *    - "check my balance"
 *    - "check balance"
 *    - "my balance"
 *    - "what is my balance"
 *    - "what's my balance"
 *    - "show my balance"
 *    - "show balance"
 *    - "get my balance"
 *    - "view my balance"
 *    - "balance"
 * 
 * 2. ETH Transfers:
 *    - "send <amount> eth to <recipient>"
 *    - "send <amount> ether to <recipient>"
 *    - "transfer <amount> eth to <recipient>"
 *    - "transfer <amount> ether to <recipient>"
 * 
 * 3. USDC Transfers:
 *    - "send <amount> usdc to <recipient>"
 *    - "transfer <amount> usdc to <recipient>"
 * 
 * Strict Invariants:
 * - Amount must be a positive decimal string (no 0, no negative, no exponents, no malformed numbers).
 * - USDC amounts cannot exceed 6 decimal places.
 * - ETH amounts cannot exceed 18 decimal places.
 * - Recipient must be a contact name, NEVER an arbitrary 0x Ethereum address.
 * - No partial matches, trailing conjunctions, or ambiguous phrasing.
 */

export interface FallbackIntent {
  action: 'balance' | 'send_eth' | 'send_usdc';
  amount?: string;
  recipient?: string;
  confidence: number;
}

const BALANCE_PATTERNS = [
  /^check\s+my\s+balance[.?]?$/i,
  /^check\s+balance[.?]?$/i,
  /^my\s+balance[.?]?$/i,
  /^what\s+is\s+my\s+balance[.?]?$/i,
  /^what's\s+my\s+balance[.?]?$/i,
  /^show\s+my\s+balance[.?]?$/i,
  /^show\s+balance[.?]?$/i,
  /^get\s+my\s+balance[.?]?$/i,
  /^view\s+my\s+balance[.?]?$/i,
  /^balance[.?]?$/i,
];

const SEND_ETH_REGEX = /^(?:send|transfer)\s+(\S+)\s+(?:eth|ether)\s+to\s+(.+?)[.]?$/i;
const SEND_USDC_REGEX = /^(?:send|transfer)\s+(\S+)\s+usdc\s+to\s+(.+?)[.]?$/i;

// Strictly validated positive decimal: no scientific notation, no trailing junk, positive (>0)
const STRICT_POSITIVE_DECIMAL = /^(?:0|[1-9]\d*)(\.\d+)?$/;
const ALL_ZEROS = /^0+(\.0+)?$/;

export function parseFallbackIntent(text: string): FallbackIntent {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new Error('Failed to extract intent: Request text cannot be empty.');
  }

  const trimmed = text.trim();

  // 1. Balance Pattern Matching
  for (const pattern of BALANCE_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        action: 'balance',
        confidence: 1.0,
      };
    }
  }

  // 2. ETH Transfer Pattern Matching
  const ethMatch = trimmed.match(SEND_ETH_REGEX);
  if (ethMatch) {
    const rawAmount = ethMatch[1].trim();
    const rawRecipient = ethMatch[2].trim();

    validateFallbackAmount(rawAmount, 'ETH');
    validateFallbackRecipient(rawRecipient);

    return {
      action: 'send_eth',
      amount: rawAmount,
      recipient: rawRecipient,
      confidence: 1.0,
    };
  }

  // 3. USDC Transfer Pattern Matching
  const usdcMatch = trimmed.match(SEND_USDC_REGEX);
  if (usdcMatch) {
    const rawAmount = usdcMatch[1].trim();
    const rawRecipient = usdcMatch[2].trim();

    validateFallbackAmount(rawAmount, 'USDC');
    validateFallbackRecipient(rawRecipient);

    return {
      action: 'send_usdc',
      amount: rawAmount,
      recipient: rawRecipient,
      confidence: 1.0,
    };
  }

  // If no exact pattern matches, fail closed with a safe, actionable error message
  throw new Error(
    'Failed to extract intent: Unable to parse request. Fallback only supports unambiguous phrases like "Check my balance", "Send <amount> ETH to <recipient>", or "Send <amount> USDC to <recipient>".'
  );
}

function validateFallbackAmount(amountStr: string, asset: 'ETH' | 'USDC'): void {
  // Reject negative, zero, exponent, and malformed formats
  if (!STRICT_POSITIVE_DECIMAL.test(amountStr) || ALL_ZEROS.test(amountStr)) {
    throw new Error(`Failed to extract intent: Invalid amount "${amountStr}". Amount must be a positive decimal number.`);
  }

  const parts = amountStr.split('.');
  if (parts.length > 2) {
    throw new Error(`Failed to extract intent: Invalid amount format.`);
  }

  if (asset === 'USDC') {
    if (parts[1] && parts[1].length > 6) {
      throw new Error(`Failed to extract intent: USDC amounts cannot exceed 6 decimal places.`);
    }
  } else if (asset === 'ETH') {
    if (parts[1] && parts[1].length > 18) {
      throw new Error(`Failed to extract intent: ETH amounts cannot exceed 18 decimal places.`);
    }
  }
}

function validateFallbackRecipient(recipientStr: string): void {
  if (!recipientStr || recipientStr.trim().length === 0) {
    throw new Error('Failed to extract intent: Recipient is missing.');
  }

  // Security Invariant: Never accept an arbitrary Ethereum wallet address from fallback text
  if (isAddress(recipientStr) || /^0x[a-fA-F0-9]{40}$/i.test(recipientStr)) {
    throw new Error(
      'Failed to extract intent: Arbitrary wallet addresses are not supported in fallback requests. Please use a contact name from your address book.'
    );
  }

  // Reject chained commands or conjunctions that indicate partial matches or ambiguity
  if (/\b(?:and|then|also|with|for|after)\b/i.test(recipientStr)) {
    throw new Error('Failed to extract intent: Ambiguous request with chained clauses.');
  }

  // Contact name should only contain alphanumeric characters, spaces, dashes, or underscores
  if (!/^[a-zA-Z0-9_\-\s]+$/.test(recipientStr)) {
    throw new Error('Failed to extract intent: Recipient name contains invalid characters.');
  }
}
