import { createPublicClient, http, parseEther, isAddress, formatEther, createWalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { sepolia } from 'viem/chains';
import { SendIntent } from './intent';
// Load env vars (handled by index.ts in production, but needed for tests if run independently)

const rpcUrl = process.env.SEPOLIA_RPC_URL;

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

export function getSenderAccount() {
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY as `0x${string}`;
  if (!privateKey || !privateKey.startsWith('0x')) {
    throw new Error('Valid SEPOLIA_PRIVATE_KEY environment variable is required and must start with 0x');
  }
  return privateKeyToAccount(privateKey);
}

export async function constructUnsignedTransaction(
  intent: SendIntent,
  resolvedAddress: string
) {
  // Validate Ethereum recipient address
  if (!isAddress(resolvedAddress)) {
    throw new Error('Invalid Ethereum recipient address');
  }

  // Validate positive amount
  if (intent.amount <= 0) {
    throw new Error('Amount must be strictly positive');
  }

  // Known recipient is checked via resolution presence
  if (!resolvedAddress) {
    throw new Error('Recipient address is required');
  }

  const account = getSenderAccount();
  const balance = await publicClient.getBalance({ address: account.address });
  const amountInWei = parseEther(intent.amount.toString());

  // Validate sufficient wallet balance
  if (balance < amountInWei) {
    throw new Error(`Insufficient wallet balance. Have ${formatEther(balance)} ETH, need ${intent.amount} ETH.`);
  }

  // Keep it isolated, do not send.
  // Return the unsigned transaction object for future inspection and signature.
  const unsignedTx = {
    to: resolvedAddress as `0x${string}`,
    value: amountInWei,
    from: account.address,
    chainId: sepolia.id,
  };

  return unsignedTx;
}

export interface TransactionPreview {
  network: string;
  sender: string;
  recipient: string;
  amountEth: string;
  estimatedGas: string;
  totalCostEth: string;
  simulationStatus: 'success' | 'failed';
  failureReason?: string;
}

export async function simulateAndPreviewTransaction(
  unsignedTx: { to: `0x${string}`; value: bigint; from: `0x${string}`; chainId: number }
): Promise<TransactionPreview> {
  let estimatedGas: bigint = 0n;
  let simulationStatus: 'success' | 'failed' = 'success';
  let failureReason: string | undefined;

  try {
    // estimateGas simulates the transaction execution locally on the node
    estimatedGas = await publicClient.estimateGas({
      account: unsignedTx.from,
      to: unsignedTx.to,
      value: unsignedTx.value,
    });
  } catch (error: any) {
    simulationStatus = 'failed';
    failureReason = error.message || 'Simulation failed';
  }

  let gasPrice = 0n;
  try {
    gasPrice = await publicClient.getGasPrice();
  } catch (e) {
    // Fallback if gas price lookup fails so we can still return a status
  }

  const gasCostWei = estimatedGas * gasPrice;
  const totalCostWei = gasCostWei + unsignedTx.value;

  return {
    network: 'sepolia',
    sender: unsignedTx.from,
    recipient: unsignedTx.to,
    amountEth: formatEther(unsignedTx.value),
    estimatedGas: estimatedGas.toString(),
    totalCostEth: formatEther(totalCostWei),
    simulationStatus,
    failureReason,
  };
}

export const walletClient = createWalletClient({
  chain: sepolia,
  transport: http(rpcUrl),
});

export async function executeAndVerifyTransaction(intent: SendIntent, resolvedAddress: string) {
  const unsignedTx = await constructUnsignedTransaction(intent, resolvedAddress);
  const account = getSenderAccount();
  
  const hash = await walletClient.sendTransaction({
    account,
    to: unsignedTx.to,
    value: unsignedTx.value,
    chain: sepolia
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== 'success') {
    throw new Error('Transaction reverted on-chain');
  }
  const broadcastedTx = await publicClient.getTransaction({ hash });
  
  if (broadcastedTx.to?.toLowerCase() !== resolvedAddress.toLowerCase()) {
    throw new Error(`CRITICAL: Broadcasted recipient ${broadcastedTx.to} does not match intended ${resolvedAddress}`);
  }
  if (broadcastedTx.value !== unsignedTx.value) {
    throw new Error(`CRITICAL: Broadcasted amount ${broadcastedTx.value} does not match intended ${unsignedTx.value}`);
  }

  return hash;
}
