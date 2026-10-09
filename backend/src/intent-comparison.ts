export interface Intent {
  action: 'balance' | 'send_eth' | 'send_usdc';
  amount?: string;
  recipient?: string;
  confidence: number;
}

export interface TransactionPreview {
  network: string;
  asset?: 'ETH' | 'USDC';
  contractAddress?: string;
  sender?: string;
  recipient: string;
  amount?: string;
  amountRaw?: string;
  amountEth: string;
  estimatedGas: string;
  gasCostEth?: string;
  totalCostEth: string;
  simulationStatus: 'success' | 'failed' | string;
  failureReason?: string;
}

export interface RiskResult {
  verdict: 'PASS' | 'WARN' | 'BLOCK';
  reasons: string[];
}

export type VerificationStatus = 'passed' | 'failed' | 'pending' | 'inconclusive';

export interface VerificationChecklistItem {
  id: 'hash' | 'receipt' | 'recipient' | 'intent' | 'balance';
  label: string;
  status: VerificationStatus;
  description?: string;
}

export interface BalanceVerificationDetails {
  status: 'passed' | 'mismatch' | 'inconclusive' | 'pending';
  asset: 'ETH' | 'USDC';
  preSenderEth: string;
  postSenderEth?: string;
  senderEthDelta?: string;
  actualGasFeeWei?: string;
  actualGasFeeEth?: string;
  preSenderUsdc?: string;
  postSenderUsdc?: string;
  senderUsdcDelta?: string;
  preRecipientUsdc?: string;
  postRecipientUsdc?: string;
  recipientUsdcDelta?: string;
  expectedTransferUnits: string;
  details?: string;
}

export interface FieldComparison {
  field: string;
  voiceValue: string;
  executedValue: string;
  isMatch: boolean;
  statusText: string;
  isWarning?: boolean;
}

export interface ComparisonResult {
  hasMismatch: boolean;
  comparisons: FieldComparison[];
  discrepancies: string[];
}

/**
 * Compares the original voice-transcribed request against the backend's
 * validated structured intent and preview to identify and highlight any mismatches.
 *
 * Invariant: This comparison is purely informative for the user.
 * The frontend text NEVER overrides backend execution parameters.
 */
export function detectMismatches(
  originalText: string,
  intent: Intent | null,
  preview?: TransactionPreview | null
): ComparisonResult {
  if (!intent) {
    return { hasMismatch: false, comparisons: [], discrepancies: [] };
  }

  const comparisons: FieldComparison[] = [];
  const discrepancies: string[] = [];
  const textLower = originalText.toLowerCase();

  // 1. Action Check
  let voiceAction = 'Unknown';
  if (/check|show|view|what('?s| is)?|balance/i.test(originalText)) {
    voiceAction = 'balance';
  } else if (/send|transfer|pay/i.test(originalText)) {
    voiceAction = 'send';
  }

  const isActionMatch =
    (intent.action === 'balance' && voiceAction === 'balance') ||
    ((intent.action === 'send_eth' || intent.action === 'send_usdc') && voiceAction === 'send') ||
    voiceAction === 'Unknown';

  comparisons.push({
    field: 'Action',
    voiceValue: voiceAction === 'send' ? 'Transfer' : voiceAction === 'balance' ? 'Check Balance' : 'Spoken Phrase',
    executedValue: intent.action.toUpperCase(),
    isMatch: isActionMatch,
    statusText: isActionMatch ? 'Match' : 'Action mismatch',
    isWarning: !isActionMatch
  });

  if (!isActionMatch) {
    discrepancies.push(`Spoken action appears different from detected action (${intent.action})`);
  }

  if (intent.action !== 'balance') {
    // 2. Asset Check
    const mentionsUsdc = /\busdc\b/i.test(originalText);
    const mentionsEth = /\beth\b|\bether\b/i.test(originalText);
    const executedAsset = preview?.asset || (intent.action === 'send_usdc' ? 'USDC' : 'ETH');

    let isAssetMatch = true;
    let voiceAsset = 'Not specified';
    if (mentionsUsdc && !mentionsEth) {
      voiceAsset = 'USDC';
      if (executedAsset !== 'USDC') {
        isAssetMatch = false;
      }
    } else if (mentionsEth && !mentionsUsdc) {
      voiceAsset = 'ETH';
      if (executedAsset !== 'ETH') {
        isAssetMatch = false;
      }
    } else if (mentionsEth && mentionsUsdc) {
      voiceAsset = 'Ambiguous (ETH & USDC)';
      isAssetMatch = false;
    }

    comparisons.push({
      field: 'Asset',
      voiceValue: voiceAsset,
      executedValue: executedAsset,
      isMatch: isAssetMatch,
      statusText: isAssetMatch ? 'Match' : 'Asset mismatch detected',
      isWarning: !isAssetMatch
    });

    if (!isAssetMatch) {
      discrepancies.push(`Spoken asset (${voiceAsset}) does not match executed token (${executedAsset})`);
    }

    // 3. Amount Check
    const executedAmount = intent.amount || preview?.amount || '';
    const hasExplicitAmountInText = executedAmount.length > 0 && originalText.includes(executedAmount);

    comparisons.push({
      field: 'Amount',
      voiceValue: hasExplicitAmountInText ? `${executedAmount} ${executedAsset}` : `Heard: "${originalText.match(/\b\d+(\.\d+)?\b/)?.[0] || 'Unclear'}"`,
      executedValue: `${executedAmount} ${executedAsset}`,
      isMatch: hasExplicitAmountInText,
      statusText: hasExplicitAmountInText ? 'Match' : 'Verify amount carefully',
      isWarning: !hasExplicitAmountInText
    });

    if (!hasExplicitAmountInText) {
      discrepancies.push(`Verbal amount may differ from validated decimal amount (${executedAmount})`);
    }

    // 4. Recipient Contact & Resolved Address Check
    const executedContact = intent.recipient || '';
    const resolvedAddress = preview?.recipient || 'Unresolved';
    const hasContactInText = executedContact.length > 0 && textLower.includes(executedContact.toLowerCase());

    comparisons.push({
      field: 'Recipient Contact',
      voiceValue: hasContactInText ? executedContact : `Heard: "${originalText}"`,
      executedValue: `${executedContact} (${resolvedAddress.slice(0, 6)}...${resolvedAddress.slice(-4)})`,
      isMatch: hasContactInText,
      statusText: hasContactInText ? 'Resolved via Contact Book' : 'Contact verification required',
      isWarning: !hasContactInText
    });

    if (!hasContactInText) {
      discrepancies.push(`Spoken recipient could not be confirmed verbatim with resolved contact (${executedContact})`);
    }
  }

  return {
    hasMismatch: discrepancies.length > 0,
    comparisons,
    discrepancies
  };
}

/**
 * Checks whether the user is permitted to confirm and execute the pending transaction.
 *
 * Security Invariants:
 * - Only a fresh PASS result with a valid, short-lived approval token enables confirmation.
 * - Stale previews, pending edits, balance queries, WARN, BLOCK, or simulation failures never enable confirmation.
 */
export function isConfirmationAllowed(
  intent: Intent | null,
  preview: TransactionPreview | null,
  risk: RiskResult | null,
  approvalToken: string | null,
  isStale: boolean
): boolean {
  if (isStale) return false;
  if (!intent || intent.action === 'balance') return false;
  if (!preview || preview.simulationStatus !== 'success') return false;
  if (!risk || risk.verdict !== 'PASS') return false;
  if (!approvalToken || typeof approvalToken !== 'string' || approvalToken.trim().length === 0) return false;
  return true;
}
