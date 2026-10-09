import { VoiceIntent, SendIntent } from './intent';
import { TransactionPreview, getSepoliaUsdcAddress } from './blockchain';
import { parseEther, parseUnits } from 'viem';

export type Verdict = 'PASS' | 'WARN' | 'BLOCK';

export interface RiskResult {
  verdict: Verdict;
  reasons: string[];
  intendedRecipient: string;
  actualRecipient: string;
  intendedAmount: string;
  actualAmount: string;
  simulationStatus: string;
  asset?: 'ETH' | 'USDC';
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
  config: FirewallConfig,
  walletBalanceUsdc?: string
): RiskResult {
  const reasons: string[] = [];
  let verdict: Verdict = 'PASS';

  const isSend = intent.action === 'send_eth' || intent.action === 'send_usdc';
  const intendedAmountStr = isSend ? (intent as SendIntent).amount.toString() : '0';
  const actualAmountStr = preview ? (preview.amount || preview.amountEth || '0') : '0';
  
  const result: RiskResult = {
    verdict,
    reasons,
    intendedRecipient: resolvedRecipient || 'UNKNOWN',
    actualRecipient: preview?.recipient || 'UNKNOWN',
    intendedAmount: intendedAmountStr,
    actualAmount: actualAmountStr,
    simulationStatus: preview?.simulationStatus || 'none',
    asset: preview?.asset || (intent.action === 'send_usdc' ? 'USDC' : 'ETH'),
  };

  const escalate = (newVerdict: Verdict, reason: string) => {
    reasons.push(reason);
    if (newVerdict === 'BLOCK') verdict = 'BLOCK';
    else if (newVerdict === 'WARN' && verdict !== 'BLOCK') verdict = 'WARN';
  };

  if (intent.confidence < config.confidenceThreshold) {
    escalate('BLOCK', 'Confidence is below configurable threshold');
  }

  // Read-only balance query is safe if confidence threshold is met
  if (intent.action === 'balance') {
    result.verdict = verdict;
    return result;
  }

  // BLOCK RULES for transactions
  if (!isSend) {
    escalate('BLOCK', 'Unsupported action');
  }

  if (isSend) {
    if (!resolvedRecipient) {
      escalate('BLOCK', 'Recipient is unknown or unresolved');
    } else if (!preview || resolvedRecipient.toLowerCase() !== preview.recipient.toLowerCase()) {
      escalate('BLOCK', 'Transaction recipient does not match intended recipient');
    }

    // Asset & contract verification
    if (preview) {
      const previewAsset = preview.asset || 'ETH';
      if (intent.action === 'send_eth') {
        if (previewAsset !== 'ETH' || preview.contractAddress !== undefined) {
          escalate('BLOCK', 'Asset does not match intent');
        }
      } else if (intent.action === 'send_usdc') {
        try {
          const verifiedUsdc = getSepoliaUsdcAddress();
          if (previewAsset !== 'USDC' || !preview.contractAddress || preview.contractAddress.toLowerCase() !== verifiedUsdc.toLowerCase()) {
            escalate('BLOCK', 'Invalid or unverified token contract address');
          }
        } catch (e: any) {
          escalate('BLOCK', 'Invalid or unverified token contract address');
        }
      }
    }

    if (!preview || intendedAmountStr !== actualAmountStr) {
      escalate('BLOCK', 'Transaction amount does not match intended amount');
    }

    // Check canonical raw units match expected precision
    if (preview && preview.amountRaw) {
      try {
        let expectedRaw: string;
        if (intent.action === 'send_eth') {
          expectedRaw = parseEther(intendedAmountStr).toString();
        } else {
          expectedRaw = parseUnits(intendedAmountStr, 6).toString();
        }
        if (preview.amountRaw !== expectedRaw) {
          escalate('BLOCK', 'Transaction raw amount does not match intended amount');
        }
      } catch (e) {
        escalate('BLOCK', 'Invalid amount formatting');
      }
    }

    if (!preview || preview.simulationStatus === 'failed') {
      escalate('BLOCK', 'Simulation failed');
    }

    if (preview) {
      if (preview.totalCostEth === 'unknown' || preview.simulationStatus === 'failed') {
        if (!reasons.includes('Simulation failed')) {
          escalate('BLOCK', 'Simulation failed or gas cost unknown');
        }
      } else {
        try {
          const totalCostBigInt = parseEther(preview.totalCostEth);
          const balanceBigInt = parseEther(walletBalanceEth);

          if (intent.action === 'send_eth') {
            if (totalCostBigInt > balanceBigInt) {
              escalate('BLOCK', 'Total cost (amount + gas) exceeds available balance');
            }
          } else if (intent.action === 'send_usdc') {
            // For USDC: totalCostEth is purely native ETH gas fee
            if (totalCostBigInt > balanceBigInt) {
              escalate('BLOCK', 'Gas cost exceeds available ETH balance');
            }
          }
        } catch (e) {
          escalate('BLOCK', 'Invalid amount or balance formatting');
        }
      }

      // Check USDC balance if provided (never compare USDC directly against ETH)
      if (intent.action === 'send_usdc' && walletBalanceUsdc !== undefined) {
        try {
          const usdcBalanceUnits = parseUnits(walletBalanceUsdc, 6);
          const usdcAmountUnits = parseUnits(intendedAmountStr, 6);
          if (usdcAmountUnits > usdcBalanceUnits) {
            escalate('BLOCK', 'Requested USDC amount exceeds available USDC balance');
          }

          // Percentage threshold check for USDC (WARN)
          const thresholdBasisPoints = BigInt(Math.round(config.maxBalancePercentageThreshold * 10000));
          const maxAllowedUsdc = (usdcBalanceUnits * thresholdBasisPoints) / 10000n;
          if (usdcAmountUnits > maxAllowedUsdc) {
            escalate('WARN', 'USDC amount exceeds configurable percentage of the USDC balance');
          }
        } catch (e) {
          escalate('BLOCK', 'Invalid USDC amount or balance formatting');
        }
      }

      // WARN RULES for ETH: evaluated using canonical integer math (basis points)
      if (intent.action === 'send_eth') {
        try {
          const balanceBigInt = parseEther(walletBalanceEth);
          const amountWei = parseEther(intendedAmountStr);
          const thresholdBasisPoints = BigInt(Math.round(config.maxBalancePercentageThreshold * 10000));
          const maxAllowedWei = (balanceBigInt * thresholdBasisPoints) / 10000n;
          if (amountWei > maxAllowedWei) {
            escalate('WARN', 'Amount exceeds configurable percentage of the wallet balance');
          }
        } catch (e) {
          escalate('BLOCK', 'Invalid amount or balance formatting');
        }
      }
    }
  }

  result.verdict = verdict;
  return result;
}
