import dotenv from 'dotenv';
import path from 'path';
import { createPublicClient, http, parseEther, parseUnits, formatEther, formatUnits, isAddress, createWalletClient, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { SendIntent } from './intent';

if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

const rpcUrl = process.env.SEPOLIA_RPC_URL || 'https://rpc2.sepolia.org';

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

export const CIRCLE_SEPOLIA_USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const;

export function getSepoliaUsdcAddress(): `0x${string}` {
  const configured = process.env.SEPOLIA_USDC_CONTRACT_ADDRESS;
  if (!configured) {
    throw new Error('USDC is disabled: SEPOLIA_USDC_CONTRACT_ADDRESS configuration is missing');
  }
  if (!isAddress(configured)) {
    throw new Error(`Invalid SEPOLIA_USDC_CONTRACT_ADDRESS: "${configured}" is not a valid Ethereum address`);
  }
  if (configured.toLowerCase() !== CIRCLE_SEPOLIA_USDC_ADDRESS.toLowerCase()) {
    throw new Error(`CRITICAL: Configured USDC address ${configured} does not match Circle official Sepolia USDC address ${CIRCLE_SEPOLIA_USDC_ADDRESS}`);
  }
  return configured as `0x${string}`;
}

export const erc20Abi = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipient', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

export function getSenderAccount() {
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY as `0x${string}`;
  if (!privateKey || !privateKey.startsWith('0x')) {
    throw new Error('Valid SEPOLIA_PRIVATE_KEY environment variable is required and must start with 0x');
  }
  return privateKeyToAccount(privateKey);
}

export interface UnsignedTransaction {
  asset?: 'ETH' | 'USDC';
  contractAddress?: `0x${string}`;
  to: `0x${string}`;
  recipient?: `0x${string}`;
  value: bigint;
  data?: `0x${string}`;
  from: `0x${string}`;
  chainId: number;
  tokenAmount?: string;
  tokenAmountUnits?: bigint;
}

export async function constructUnsignedTransaction(
  intent: SendIntent,
  resolvedAddress: string
): Promise<UnsignedTransaction> {
  await assertSepoliaChainId();

  // Validate Ethereum recipient address
  if (!isAddress(resolvedAddress)) {
    throw new Error('Invalid Ethereum recipient address');
  }

  // Known recipient is checked via resolution presence
  if (!resolvedAddress) {
    throw new Error('Recipient address is required');
  }

  const account = getSenderAccount();
  const amountStr = intent.amount;

  if (intent.action === 'send_eth') {
    let amountInWei: bigint;
    try {
      amountInWei = parseEther(amountStr);
    } catch {
      throw new Error('Invalid decimal amount');
    }

    if (amountInWei <= 0n) {
      throw new Error('Amount must be strictly positive');
    }

    const balance = await publicClient.getBalance({ address: account.address });

    // Validate sufficient wallet balance using canonical integer units
    if (balance < amountInWei) {
      throw new Error(`Insufficient wallet balance. Have ${formatEther(balance)} ETH, need ${amountStr} ETH.`);
    }

    return {
      asset: 'ETH',
      to: resolvedAddress as `0x${string}`,
      recipient: resolvedAddress as `0x${string}`,
      value: amountInWei,
      from: account.address,
      chainId: sepolia.id,
      tokenAmount: amountStr,
      tokenAmountUnits: amountInWei,
    };
  } else if (intent.action === 'send_usdc') {
    const parts = amountStr.split('.');
    if (parts[1] && parts[1].length > 6) {
      throw new Error('USDC amounts cannot exceed 6 decimal places');
    }

    let amountInUnits: bigint;
    try {
      amountInUnits = parseUnits(amountStr, 6);
    } catch {
      throw new Error('Invalid decimal amount');
    }

    if (amountInUnits <= 0n) {
      throw new Error('Amount must be strictly positive');
    }

    const usdcAddress = getSepoliaUsdcAddress();

    // Verify token metadata (decimals)
    let decimals: number;
    try {
      decimals = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'decimals',
      });
    } catch (e: any) {
      throw new Error(`Failed to query USDC contract decimals: ${e.message}`);
    }

    if (decimals !== 6) {
      throw new Error(`USDC contract decimals mismatch: expected 6, got ${decimals}`);
    }

    // Verify sender has enough USDC for the transfer
    let usdcBalance: bigint;
    try {
      usdcBalance = await publicClient.readContract({
        address: usdcAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
    } catch (e: any) {
      throw new Error(`Failed to query USDC balance: ${e.message}`);
    }

    if (usdcBalance < amountInUnits) {
      throw new Error(`Insufficient USDC balance. Have ${formatUnits(usdcBalance, 6)} USDC, need ${amountStr} USDC.`);
    }

    // Verify sender has enough native Sepolia ETH for gas
    const ethBalance = await publicClient.getBalance({ address: account.address });
    if (ethBalance <= 0n) {
      throw new Error(`Insufficient ETH for gas: account has 0 ETH.`);
    }

    const callData = encodeFunctionData({
      abi: erc20Abi,
      functionName: 'transfer',
      args: [resolvedAddress as `0x${string}`, amountInUnits],
    });

    return {
      asset: 'USDC',
      contractAddress: usdcAddress,
      to: usdcAddress,
      recipient: resolvedAddress as `0x${string}`,
      value: 0n,
      data: callData,
      from: account.address,
      chainId: sepolia.id,
      tokenAmount: amountStr,
      tokenAmountUnits: amountInUnits,
    };
  } else {
    throw new Error(`Unsupported send action: ${(intent as any).action}`);
  }
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
  simulationStatus: 'success' | 'failed';
  failureReason?: string;
}

export async function assertSepoliaChainId(): Promise<void> {
  const chainId = await publicClient.getChainId();
  if (chainId !== 11155111 && chainId !== sepolia.id) {
    throw new Error(`CRITICAL: RPC chain mismatch. Expected Sepolia chain ID 11155111, got ${chainId}`);
  }
}

export async function simulateAndPreviewTransaction(
  unsignedTx: UnsignedTransaction
): Promise<TransactionPreview> {
  const asset = unsignedTx.asset || 'ETH';
  const recipient = (unsignedTx.recipient || unsignedTx.to) as `0x${string}`;
  const tokenAmount = unsignedTx.tokenAmount ?? (asset === 'ETH' ? formatEther(unsignedTx.value) : '0');
  const tokenAmountUnits = unsignedTx.tokenAmountUnits ?? (asset === 'ETH' ? unsignedTx.value : 0n);

  let estimatedGas: bigint = 0n;
  let simulationStatus: 'success' | 'failed' = 'success';
  let failureReason: string | undefined;

  try {
    estimatedGas = await publicClient.estimateGas({
      account: unsignedTx.from,
      to: unsignedTx.to,
      value: unsignedTx.value,
      data: unsignedTx.data,
    });
  } catch (error: any) {
    simulationStatus = 'failed';
    failureReason = error.message || 'Simulation failed';
  }

  let gasPrice: bigint | null = null;
  try {
    gasPrice = await publicClient.getGasPrice();
  } catch (e: any) {
    simulationStatus = 'failed';
    failureReason = failureReason || `Failed to retrieve gas price: ${e?.message || 'RPC error'}`;
  }

  if (gasPrice === null) {
    simulationStatus = 'failed';
    failureReason = failureReason || 'Failed to retrieve gas price from RPC';
  }

  // Fail closed: Unknown gas cost must NEVER be treated as zero
  if (simulationStatus === 'failed') {
    return {
      network: 'sepolia',
      asset,
      contractAddress: unsignedTx.contractAddress,
      sender: unsignedTx.from,
      recipient,
      amount: tokenAmount,
      amountRaw: tokenAmountUnits.toString(),
      amountEth: asset === 'ETH' ? tokenAmount : '0',
      estimatedGas: estimatedGas > 0n ? estimatedGas.toString() : 'unknown',
      gasCostEth: 'unknown',
      totalCostEth: 'unknown',
      simulationStatus: 'failed',
      failureReason,
    };
  }

  const gasCostWei = estimatedGas * gasPrice!;
  const gasCostEth = formatEther(gasCostWei);
  const totalEthCostWei = asset === 'ETH' ? gasCostWei + unsignedTx.value : gasCostWei;

  return {
    network: 'sepolia',
    asset,
    contractAddress: unsignedTx.contractAddress,
    sender: unsignedTx.from,
    recipient,
    amount: tokenAmount,
    amountRaw: tokenAmountUnits.toString(),
    amountEth: asset === 'ETH' ? tokenAmount : '0',
    estimatedGas: estimatedGas.toString(),
    gasCostEth,
    totalCostEth: formatEther(totalEthCostWei),
    simulationStatus: 'success',
  };
}

export const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

import {
  VerificationChecklistItem,
  BalanceVerificationDetails,
  VerificationStatus
} from './intent-comparison';

export interface ExecutionResult {
  hash: `0x${string}`;
  status: 'confirmed' | 'pending';
  receipt?: any;
  message: string;
  checklist: VerificationChecklistItem[];
  balanceVerification: BalanceVerificationDetails;
}

export async function executeAndVerifyTransaction(
  intent: SendIntent,
  resolvedAddress: string
): Promise<ExecutionResult> {
  await assertSepoliaChainId();
  const unsignedTx = await constructUnsignedTransaction(intent, resolvedAddress);
  const account = getSenderAccount();

  // 1. Capture pre-execution balances immediately before signing/broadcast
  // Fail closed if balance queries fail - never assume or report zero balance on error
  let preSenderEth: bigint;
  try {
    preSenderEth = await publicClient.getBalance({ address: account.address });
    if (typeof preSenderEth !== 'bigint') {
      throw new Error('Non-integer balance returned from RPC');
    }
  } catch (err: any) {
    throw new Error(`Failed to capture pre-execution ETH balance before broadcast: ${err.message}`);
  }

  let preSenderUsdc: bigint | undefined;
  let preRecipientUsdc: bigint | undefined;
  const usdcAddress = unsignedTx.asset === 'USDC' ? getSepoliaUsdcAddress() : undefined;

  if (unsignedTx.asset === 'USDC') {
    try {
      preSenderUsdc = await publicClient.readContract({
        address: usdcAddress!,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      if (typeof preSenderUsdc !== 'bigint') {
        throw new Error('Non-integer sender USDC balance returned from RPC');
      }
    } catch (err: any) {
      throw new Error(`Failed to capture pre-execution sender USDC balance before broadcast: ${err.message}`);
    }

    try {
      preRecipientUsdc = await publicClient.readContract({
        address: usdcAddress!,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [resolvedAddress as `0x${string}`],
      });
      if (typeof preRecipientUsdc !== 'bigint') {
        throw new Error('Non-integer recipient USDC balance returned from RPC');
      }
    } catch (err: any) {
      throw new Error(`Failed to capture pre-execution recipient USDC balance before broadcast: ${err.message}`);
    }
  }

  // Broadcast transaction
  const hash = await walletClient.sendTransaction({
    account,
    to: unsignedTx.to,
    data: unsignedTx.data,
    value: unsignedTx.value,
    chain: sepolia
  });

  let receipt: any;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash });
  } catch (receiptErr: any) {
    // Preserve clear handling of actual on-chain reverts if thrown by client during wait
    if (
      receiptErr.name === 'TransactionRevertedError' ||
      receiptErr.message?.toLowerCase().includes('revert')
    ) {
      throw new Error('Transaction reverted on-chain');
    }

    // Receipt wait timed out or failed to retrieve receipt after successful broadcast.
    // Do NOT retry or rebroadcast; return pending confirmation without premature verification.
    const pendingChecklist: VerificationChecklistItem[] = [
      {
        id: 'hash',
        label: 'Transaction hash available',
        status: 'passed',
        description: `Broadcast hash: ${hash}`
      },
      {
        id: 'receipt',
        label: 'Transaction receipt confirmed',
        status: 'pending',
        description: 'Waiting for on-chain block confirmation'
      },
      {
        id: 'recipient',
        label: 'Recipient or token contract matches',
        status: 'pending',
        description: 'Verification pending receipt confirmation'
      },
      {
        id: 'intent',
        label: 'Asset and amount match the validated intent',
        status: 'pending',
        description: 'Verification pending receipt confirmation'
      },
      {
        id: 'balance',
        label: 'Expected sender/recipient balance changes verified',
        status: 'pending',
        description: 'Balance verification pending receipt confirmation'
      }
    ];

    const pendingBalanceDetails: BalanceVerificationDetails = {
      status: 'pending',
      asset: unsignedTx.asset || 'ETH',
      preSenderEth: preSenderEth.toString(),
      preSenderUsdc: preSenderUsdc !== undefined ? preSenderUsdc.toString() : undefined,
      preRecipientUsdc: preRecipientUsdc !== undefined ? preRecipientUsdc.toString() : undefined,
      expectedTransferUnits: (unsignedTx.tokenAmountUnits ?? unsignedTx.value).toString(),
      details: 'Transaction broadcast; receipt and balance verification pending.'
    };

    return {
      hash,
      status: 'pending',
      message: `Transaction broadcasted (${hash}) but confirmation timed out. Transaction broadcast; receipt and balance verification pending.`,
      checklist: pendingChecklist,
      balanceVerification: pendingBalanceDetails
    };
  }

  if (receipt.status !== 'success') {
    throw new Error('Transaction reverted on-chain');
  }

  // 2. Receipt confirmed: verify broadcasted fields
  const broadcastedTx = await publicClient.getTransaction({ hash });

  if (unsignedTx.asset === 'ETH') {
    if (broadcastedTx.to?.toLowerCase() !== resolvedAddress.toLowerCase()) {
      throw new Error(`CRITICAL: Broadcasted recipient ${broadcastedTx.to} does not match intended ${resolvedAddress}`);
    }
    if (broadcastedTx.value !== unsignedTx.value) {
      throw new Error(`CRITICAL: Broadcasted amount ${broadcastedTx.value} does not match intended ${unsignedTx.value}`);
    }
  } else if (unsignedTx.asset === 'USDC') {
    if (broadcastedTx.to?.toLowerCase() !== usdcAddress!.toLowerCase()) {
      throw new Error(`CRITICAL: Broadcasted target contract ${broadcastedTx.to} does not match USDC address ${usdcAddress}`);
    }
    if (broadcastedTx.input !== unsignedTx.data) {
      throw new Error(`CRITICAL: Broadcasted call data does not match intended USDC transfer`);
    }
  }

  // 3. Post-execution balance queries
  // Fail-safe: RPC failures reading post-balances MUST report as inconclusive, NOT throw as revert
  let postSenderEth: bigint | undefined;
  let postSenderUsdc: bigint | undefined;
  let postRecipientUsdc: bigint | undefined;
  let postBalanceReadError: string | null = null;

  try {
    postSenderEth = await publicClient.getBalance({ address: account.address });
    if (typeof postSenderEth !== 'bigint') {
      throw new Error('Non-integer balance returned from RPC');
    }
  } catch (err: any) {
    postBalanceReadError = `Failed to query post-execution ETH balance: ${err.message}`;
  }

  if (unsignedTx.asset === 'USDC' && !postBalanceReadError) {
    try {
      postSenderUsdc = await publicClient.readContract({
        address: usdcAddress!,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [account.address],
      });
      if (typeof postSenderUsdc !== 'bigint') {
        throw new Error('Non-integer sender USDC balance returned from RPC');
      }
    } catch (err: any) {
      postBalanceReadError = `Failed to query post-execution sender USDC balance: ${err.message}`;
    }

    if (!postBalanceReadError) {
      try {
        postRecipientUsdc = await publicClient.readContract({
          address: usdcAddress!,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [resolvedAddress as `0x${string}`],
        });
        if (typeof postRecipientUsdc !== 'bigint') {
          throw new Error('Non-integer recipient USDC balance returned from RPC');
        }
      } catch (err: any) {
        postBalanceReadError = `Failed to query post-execution recipient USDC balance: ${err.message}`;
      }
    }
  }

  // 4. Calculate actual gas fees and balance deltas using exact integer arithmetic (bigint)
  const gasUsed = receipt.gasUsed !== undefined && receipt.gasUsed !== null ? BigInt(receipt.gasUsed) : 0n;
  const effectiveGasPrice = receipt.effectiveGasPrice !== undefined && receipt.effectiveGasPrice !== null
    ? BigInt(receipt.effectiveGasPrice)
    : receipt.gasPrice !== undefined && receipt.gasPrice !== null
      ? BigInt(receipt.gasPrice)
      : 0n;
  const actualGasFeeWei = gasUsed * effectiveGasPrice;
  const actualGasFeeEth = formatEther(actualGasFeeWei);

  let balanceStatus: 'passed' | 'mismatch' | 'inconclusive';
  let balanceDetails: string;
  let checklistBalanceStatus: VerificationStatus;

  let senderEthDelta: bigint | undefined;
  let senderUsdcDelta: bigint | undefined;
  let recipientUsdcDelta: bigint | undefined;

  if (postSenderEth !== undefined) {
    senderEthDelta = preSenderEth - postSenderEth;
  }
  if (preSenderUsdc !== undefined && postSenderUsdc !== undefined) {
    senderUsdcDelta = preSenderUsdc - postSenderUsdc;
  }
  if (preRecipientUsdc !== undefined && postRecipientUsdc !== undefined) {
    recipientUsdcDelta = postRecipientUsdc - preRecipientUsdc;
  }

  if (postBalanceReadError) {
    balanceStatus = 'inconclusive';
    checklistBalanceStatus = 'inconclusive';
    balanceDetails = `Post-execution balance verification inconclusive: ${postBalanceReadError}. Receipt is confirmed on-chain.`;
  } else if (unsignedTx.asset === 'ETH') {
    const expectedEthDecrease = unsignedTx.value + actualGasFeeWei;
    if (senderEthDelta === expectedEthDecrease) {
      balanceStatus = 'passed';
      checklistBalanceStatus = 'passed';
      balanceDetails = `Sender ETH balance decreased by exact transfer amount (${unsignedTx.value.toString()} wei) + gas fee (${actualGasFeeWei.toString()} wei).`;
    } else {
      balanceStatus = 'mismatch';
      checklistBalanceStatus = 'failed';
      balanceDetails = `ETH balance delta mismatch: Sender ETH delta (${senderEthDelta?.toString() ?? 'unknown'} wei) does not match expected total decrease (${expectedEthDecrease.toString()} wei: transfer ${unsignedTx.value.toString()} wei + gas ${actualGasFeeWei.toString()} wei).`;
    }
  } else {
    // USDC: verify sender's USDC decrease and recipient's USDC increase against the transfer amount
    const expectedTransferUnits = unsignedTx.tokenAmountUnits!;
    const usdcSenderMatched = senderUsdcDelta === expectedTransferUnits;
    const usdcRecipientMatched = recipientUsdcDelta === expectedTransferUnits;

    if (usdcSenderMatched && usdcRecipientMatched) {
      balanceStatus = 'passed';
      checklistBalanceStatus = 'passed';
      balanceDetails = `Sender USDC decreased by ${expectedTransferUnits.toString()} units and recipient USDC increased by ${expectedTransferUnits.toString()} units. Actual ETH gas fee paid: ${actualGasFeeEth} ETH (${actualGasFeeWei.toString()} wei).`;
    } else {
      balanceStatus = 'mismatch';
      checklistBalanceStatus = 'failed';
      const mismatchReasons: string[] = [];
      if (!usdcSenderMatched) {
        mismatchReasons.push(`Sender USDC decrease (${senderUsdcDelta?.toString() ?? 'unknown'} units) != expected (${expectedTransferUnits.toString()} units)`);
      }
      if (!usdcRecipientMatched) {
        mismatchReasons.push(`Recipient USDC increase (${recipientUsdcDelta?.toString() ?? 'unknown'} units) != expected (${expectedTransferUnits.toString()} units)`);
      }
      balanceDetails = `USDC balance delta mismatch: ${mismatchReasons.join('; ')}. Actual ETH gas fee paid: ${actualGasFeeEth} ETH.`;
    }
  }

  // 5. Build structured verification checklist
  const checklist: VerificationChecklistItem[] = [
    {
      id: 'receipt',
      label: 'Transaction receipt confirmed',
      status: 'passed',
      description: `Confirmed in block ${receipt.blockNumber !== undefined ? receipt.blockNumber.toString() : 'latest'}`
    },
    {
      id: 'recipient',
      label: 'Recipient or token contract matches',
      status: 'passed',
      description: unsignedTx.asset === 'ETH'
        ? `Recipient matches validated address ${resolvedAddress}`
        : `Token contract matches verified Sepolia USDC address ${usdcAddress}`
    },
    {
      id: 'intent',
      label: 'Asset and amount match the validated intent',
      status: 'passed',
      description: unsignedTx.asset === 'ETH'
        ? `Transfer value matches ${unsignedTx.tokenAmount ?? formatEther(unsignedTx.value)} ETH`
        : `Transfer amount matches ${unsignedTx.tokenAmount} USDC`
    },
    {
      id: 'balance',
      label: 'Expected sender/recipient balance changes verified',
      status: checklistBalanceStatus,
      description: balanceDetails
    },
    {
      id: 'hash',
      label: 'Transaction hash available',
      status: 'passed',
      description: `Transaction hash: ${hash}`
    }
  ];

  const balanceVerification: BalanceVerificationDetails = {
    status: balanceStatus,
    asset: unsignedTx.asset || 'ETH',
    preSenderEth: preSenderEth.toString(),
    postSenderEth: postSenderEth?.toString(),
    senderEthDelta: senderEthDelta?.toString(),
    actualGasFeeWei: actualGasFeeWei.toString(),
    actualGasFeeEth,
    preSenderUsdc: preSenderUsdc?.toString(),
    postSenderUsdc: postSenderUsdc?.toString(),
    senderUsdcDelta: senderUsdcDelta?.toString(),
    preRecipientUsdc: preRecipientUsdc?.toString(),
    postRecipientUsdc: postRecipientUsdc?.toString(),
    recipientUsdcDelta: recipientUsdcDelta?.toString(),
    expectedTransferUnits: (unsignedTx.tokenAmountUnits ?? unsignedTx.value).toString(),
    details: balanceDetails
  };

  return {
    hash,
    status: 'confirmed',
    receipt,
    message: balanceStatus === 'passed'
      ? 'Transaction successfully executed, confirmed, and verified on-chain.'
      : balanceStatus === 'inconclusive'
        ? 'Transaction receipt confirmed, but post-execution balance verification was inconclusive.'
        : 'Transaction receipt confirmed, but balance delta mismatch was detected.',
    checklist,
    balanceVerification
  };
}
