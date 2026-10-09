import { VoiceIntent, SendIntent } from './intent';
import { TransactionPreview } from './blockchain';
import { parseEther } from 'viem';

export type Verdict = 'PASS' | 'WARN' | 'BLOCK';

export interface RiskResult {
  verdict: Verdict;
  reasons: string[];
  intendedRecipient: string;
  actualRecipient: string;
  intendedAmount: string;
  actualAmount: string;
  simulationStatus: string;
}

export interface FirewallConfig {
  confidenceThreshold: number; // e.g. 0.90
  maxBalancePercentageThreshold: number; // e.g. 0.5 for 50%
}

export function evaluateRisk(
  intent: VoiceIntent,
  resolvedRecipient: string | undefined,
  preview: TransactionPreview | undefined,
  walletBalanceEth: string,
  config: FirewallConfig
): RiskResult {
  const reasons: string[] = [];
  let verdict: Verdict = 'PASS';

  const isSend = intent.action === 'send';
  const intendedAmountStr = isSend ? (intent as SendIntent).amount.toString() : '0';
  
  const result: RiskResult = {
    verdict,
    reasons,
    intendedRecipient: resolvedRecipient || 'UNKNOWN',
    actualRecipient: preview?.recipient || 'UNKNOWN',
    intendedAmount: intendedAmountStr,
    actualAmount: preview?.amountEth || '0',
    simulationStatus: preview?.simulationStatus || 'none',
  };

  const escalate = (newVerdict: Verdict, reason: string) => {
    reasons.push(reason);
    if (newVerdict === 'BLOCK') verdict = 'BLOCK';
    else if (newVerdict === 'WARN' && verdict !== 'BLOCK') verdict = 'WARN';
  };

  // BLOCK RULES
  if (intent.action !== 'send') {
    escalate('BLOCK', 'Unsupported action');
  }

  if (intent.confidence < config.confidenceThreshold) {
    escalate('BLOCK', 'Confidence is below configurable threshold');
  }

  if (isSend) {
    if (!resolvedRecipient) {
      escalate('BLOCK', 'Recipient is unknown or unresolved');
    } else if (!preview || resolvedRecipient.toLowerCase() !== preview.recipient.toLowerCase()) {
      escalate('BLOCK', 'Transaction recipient does not match intended recipient');
    }

    if (!preview || intendedAmountStr !== preview.amountEth) {
      escalate('BLOCK', 'Transaction amount does not match intended amount');
    }

    if (!preview || preview.simulationStatus === 'failed') {
      escalate('BLOCK', 'Simulation failed');
    }

    if (preview) {
      try {
        const totalCostBigInt = parseEther(preview.totalCostEth);
        const balanceBigInt = parseEther(walletBalanceEth);

        if (totalCostBigInt > balanceBigInt) {
          escalate('BLOCK', 'Total cost (amount + gas) exceeds available balance');
        } else {
          // WARN RULES
          const amountNum = parseFloat(intendedAmountStr);
          const balanceNum = parseFloat(walletBalanceEth);
          if (amountNum > balanceNum * config.maxBalancePercentageThreshold) {
            escalate('WARN', 'Amount exceeds configurable percentage of the wallet balance');
          }
        }
      } catch (e) {
        escalate('BLOCK', 'Invalid amount or balance formatting');
      }
    }
  }

  result.verdict = verdict;
  return result;
}
