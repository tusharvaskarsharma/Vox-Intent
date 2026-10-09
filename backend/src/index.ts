import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { validateIntent, SendIntent, CONFIDENCE_THRESHOLD } from './intent';
import { extractIntent } from './extractor';
import {
  constructUnsignedTransaction,
  simulateAndPreviewTransaction,
  publicClient,
  getSenderAccount,
  TransactionPreview,
  getSepoliaUsdcAddress,
  erc20Abi,
  assertSepoliaChainId,
  executeAndVerifyTransaction
} from './blockchain';
import { evaluateRisk, FirewallConfig } from './firewall';
import { formatEther, parseEther, formatUnits, parseUnits } from 'viem';
import { connectDB, getContactsCollection } from './db';
import { MongoMemoryServer } from 'mongodb-memory-server';

export interface ApprovalTokenData {
  asset?: 'ETH' | 'USDC';
  contractAddress?: string;
  sender?: string;
  recipient: string;
  amount: string;
  amountRaw?: string;
  network: string;
  estimatedGas: string;
  maxCostEth?: string;
  expiresAt: number;
}

/**
 * SINGLE-INSTANCE LIMITATION:
 * Approval tokens are stored in an in-memory Map. This guarantees single-use and
 * atomic deletion within a single Node.js process. In a horizontally scaled / clustered
 * multi-instance production environment, this must be replaced with a distributed,
 * atomic key-value store (e.g. Redis with atomic GETDEL or Lua scripts) with TTL.
 */
export const approvalTokens = new Map<string, ApprovalTokenData>();


// Only load .env file when NOT running tests, ensuring tests remain self-contained and clean
if (process.env.NODE_ENV !== 'test') {
  dotenv.config({ path: path.resolve(__dirname, '../../.env') });
}

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = '127.0.0.1';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin === frontendUrl || origin === 'http://127.0.0.1:5173' || origin === 'http://localhost:5173') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));
app.use(helmet());
app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Backend is running' });
});

// Only process.env.NODE_ENV === 'test' may activate test-only rate-limit bypasses
export const isTestMode = () => process.env.NODE_ENV === 'test';

const processLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () => (isTestMode() ? 1000 : 30),
  skip: () => isTestMode(),
  message: { error: 'Too many requests, please try again later.' }
});

app.post('/api/process', processLimiter, async (req, res) => {
  try {
    let payload = req.body;

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const bodyKeys = Object.keys(payload);
    if (bodyKeys.length !== 1 || bodyKeys[0] !== 'text') {
      return res.status(400).json({ error: 'Invalid request body. Only "text" field is allowed.' });
    }

    if (typeof payload.text !== 'string' || payload.text.trim() === '') {
      return res.status(400).json({ error: 'Text field must be a non-empty string.' });
    }

    if (payload.text.length > 500) {
      return res.status(400).json({ error: 'Text is too long. Maximum 500 characters allowed.' });
    }

    // 0. Natural Language Intent Extraction
    try {
      payload = await extractIntent(payload.text);
    } catch (err: any) {
      return res.status(400).json({ error: 'Failed to extract intent from natural language text', details: err.message });
    }

    // 1. Intent Validation
    const validationResult = await validateIntent(payload);
    if (!validationResult.valid) {
      return res.status(400).json({ error: validationResult.error });
    }

    const intent = validationResult.intent;
    const resolvedAddress = validationResult.resolvedAddress;

    const account = getSenderAccount();

    let balanceWei = 0n;
    try {
      balanceWei = await publicClient.getBalance({ address: account.address });
    } catch (e: any) {
      return res.status(500).json({ error: 'Failed to fetch wallet balance from RPC' });
    }
    const walletBalanceEth = formatEther(balanceWei);

    // Handle read-only balance query
    if (intent.action === 'balance') {
      const firewallConfig: FirewallConfig = {
        confidenceThreshold: CONFIDENCE_THRESHOLD,
        maxBalancePercentageThreshold: 0.5
      };
      const risk = evaluateRisk(intent, undefined, undefined, walletBalanceEth, firewallConfig);
      return res.json({
        intent,
        balance: {
          walletAddress: account.address,
          balanceEth: walletBalanceEth,
          network: 'sepolia'
        },
        risk
      });
    }

    let unsignedTx: any = null;
    let preview: TransactionPreview | null = null;
    const isSendAction = intent.action === 'send_eth' || intent.action === 'send_usdc';

    let walletBalanceUsdc: string | undefined = undefined;
    if (intent.action === 'send_usdc') {
      try {
        const usdcAddress = getSepoliaUsdcAddress();
        const usdcBalanceRaw = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        });
        walletBalanceUsdc = formatUnits(usdcBalanceRaw, 6);
      } catch (e: any) {
        // USDC balance query failure will be evaluated during simulation/risk
      }
    }

    // 2 & 3. Recipient Resolution & Transaction Review (Construct & Simulate)
    if (isSendAction && resolvedAddress) {
      try {
        unsignedTx = await constructUnsignedTransaction(intent as SendIntent, resolvedAddress);
        preview = await simulateAndPreviewTransaction(unsignedTx);
      } catch (err: any) {
        const asset = intent.action === 'send_usdc' ? 'USDC' : 'ETH';
        let contractAddress: string | undefined = undefined;
        if (asset === 'USDC') {
          try {
            contractAddress = getSepoliaUsdcAddress();
          } catch {}
        }
        preview = {
          network: 'sepolia',
          asset,
          contractAddress,
          sender: account.address,
          recipient: resolvedAddress,
          amount: (intent as SendIntent).amount,
          amountRaw: asset === 'ETH'
            ? (() => { try { return parseEther((intent as SendIntent).amount).toString(); } catch { return '0'; } })()
            : (() => { try { return parseUnits((intent as SendIntent).amount, 6).toString(); } catch { return '0'; } })(),
          amountEth: asset === 'ETH' ? (intent as SendIntent).amount : '0',
          estimatedGas: 'unknown',
          gasCostEth: 'unknown',
          totalCostEth: 'unknown',
          simulationStatus: 'failed',
          failureReason: err.message
        };
      }
    }

    // 4. Intent Firewall
    const firewallConfig: FirewallConfig = {
      confidenceThreshold: 0.9,
      maxBalancePercentageThreshold: 0.5
    };

    const risk = evaluateRisk(intent, resolvedAddress, preview || undefined, walletBalanceEth, firewallConfig, walletBalanceUsdc);

    // 5. Display result (return to frontend)
    let approvalToken: string | undefined;
    if (isSendAction && preview && preview.simulationStatus === 'success' && risk.verdict === 'PASS') {
      const asset = intent.action === 'send_usdc' ? 'USDC' : 'ETH';
      approvalToken = crypto.randomUUID();
      approvalTokens.set(approvalToken, {
        asset,
        contractAddress: preview.contractAddress,
        sender: account.address.toLowerCase(),
        recipient: resolvedAddress!.toLowerCase(),
        amount: (intent as SendIntent).amount,
        amountRaw: preview.amountRaw || (asset === 'ETH' ? parseEther((intent as SendIntent).amount).toString() : parseUnits((intent as SendIntent).amount, 6).toString()),
        network: preview.network,
        estimatedGas: preview.estimatedGas,
        maxCostEth: preview.totalCostEth,
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
      });
    }

    return res.json({
      intent,
      resolvedAddress: resolvedAddress || (preview ? preview.recipient : undefined),
      preview: preview || undefined,
      risk,
      approvalToken
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: () => (isTestMode() ? 1000 : 5),
  skip: () => isTestMode(),
  message: { error: 'Too many execution requests, please try again later.' }
});

app.post('/api/execute', executeLimiter, async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const bodyKeys = Object.keys(req.body);
    const allowedKeys = ['intent', 'confirmed', 'approvalToken'];
    if (bodyKeys.some(key => !allowedKeys.includes(key))) {
      return res.status(400).json({ error: 'Unexpected fields in execution request body.' });
    }

    const { intent: rawIntent, confirmed, approvalToken } = req.body;

    if (confirmed !== true) {
      return res.status(403).json({ error: 'Explicit confirmation is required to execute transaction.' });
    }

    if (!approvalToken) {
      return res.status(403).json({ error: 'Missing approval token.' });
    }

    if (typeof approvalToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(approvalToken)) {
      return res.status(400).json({ error: 'Invalid approval token format.' });
    }

    // Synchronously claim and delete token BEFORE any awaited operation to prevent concurrency race
    const tokenData = approvalTokens.get(approvalToken);
    if (!tokenData) {
      return res.status(403).json({ error: 'Invalid or reused approval token.' });
    }
    approvalTokens.delete(approvalToken);

    if (Date.now() > tokenData.expiresAt) {
      return res.status(403).json({ error: 'Expired approval token.' });
    }

    const validationResult = await validateIntent(rawIntent);
    if (!validationResult.valid) {
      return res.status(400).json({ error: validationResult.error });
    }
    if (validationResult.intent.action === 'balance') {
      return res.status(400).json({ error: 'Balance query cannot be executed as a transaction.' });
    }
    if (!validationResult.resolvedAddress) {
      return res.status(400).json({ error: 'Invalid intent or unresolved recipient' });
    }

    const intent = validationResult.intent as SendIntent;
    const resolvedAddress = validationResult.resolvedAddress;

    const tokenAsset = tokenData.asset || 'ETH';
    const expectedAsset = intent.action === 'send_usdc' ? 'USDC' : 'ETH';
    if (tokenAsset !== expectedAsset) {
      return res.status(403).json({ error: 'Mismatched approval token asset.' });
    }

    if (tokenData.recipient.toLowerCase() !== resolvedAddress.toLowerCase() || tokenData.amount.toString() !== intent.amount.toString()) {
      return res.status(403).json({ error: 'Mismatched approval token details.' });
    }

    const account = getSenderAccount();
    if (tokenData.sender && tokenData.sender.toLowerCase() !== account.address.toLowerCase()) {
      return res.status(403).json({ error: 'Mismatched approval token sender.' });
    }

    if (tokenAsset === 'USDC') {
      const verifiedUsdc = getSepoliaUsdcAddress();
      if (!tokenData.contractAddress || tokenData.contractAddress.toLowerCase() !== verifiedUsdc.toLowerCase()) {
        return res.status(403).json({ error: 'Mismatched approval token contract address.' });
      }
    }

    // Assert that the configured RPC actually reports Sepolia chain ID 11155111 before allowing execution
    try {
      await assertSepoliaChainId();
    } catch (err: any) {
      return res.status(403).json({ error: `Chain mismatch: ${err.message}` });
    }

    // Re-run risk firewall to ensure it hasn't changed or become dangerous
    const balanceWei = await publicClient.getBalance({ address: account.address });
    const walletBalanceEth = formatEther(balanceWei);

    let walletBalanceUsdc: string | undefined = undefined;
    if (intent.action === 'send_usdc') {
      try {
        const usdcAddress = getSepoliaUsdcAddress();
        const usdcBalanceRaw = await publicClient.readContract({
          address: usdcAddress,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [account.address],
        });
        walletBalanceUsdc = formatUnits(usdcBalanceRaw, 6);
      } catch (e: any) {
        return res.status(403).json({ error: 'Failed to verify USDC balance during execution revalidation.' });
      }
    }

    let unsignedTx: any = null;
    let preview: TransactionPreview | null = null;

    try {
      unsignedTx = await constructUnsignedTransaction(intent, resolvedAddress);
      preview = await simulateAndPreviewTransaction(unsignedTx);
    } catch (err: any) {
      return res.status(403).json({ error: 'Failed to reconstruct/simulate transaction during execution phase.', details: err.message });
    }

    if (preview.simulationStatus !== 'success') {
      return res.status(403).json({ error: 'Failed to reconstruct/simulate transaction during execution phase.', details: preview.failureReason });
    }

    if (preview.network !== tokenData.network || (preview.asset || 'ETH') !== tokenAsset) {
      return res.status(403).json({ error: `Transaction preview changed since approval.` });
    }

    const tokenAmountRaw = tokenData.amountRaw || (tokenAsset === 'ETH' ? parseEther(tokenData.amount).toString() : parseUnits(tokenData.amount, 6).toString());

    if (tokenAsset === 'ETH') {
      if (preview.amountEth !== tokenData.amount.toString()) {
        return res.status(403).json({ error: `Transaction preview changed since approval.` });
      }
    } else if (tokenAsset === 'USDC') {
      if (preview.amount !== tokenData.amount.toString() || preview.amountRaw !== tokenAmountRaw) {
        return res.status(403).json({ error: `Transaction preview changed since approval.` });
      }
      if (preview.contractAddress?.toLowerCase() !== tokenData.contractAddress?.toLowerCase()) {
        return res.status(403).json({ error: `Transaction preview contract address changed since approval.` });
      }
    }

    // Enforce approved gas limit: gas estimate cannot silently increase beyond approved limit
    if (BigInt(preview.estimatedGas) > BigInt(tokenData.estimatedGas)) {
      return res.status(403).json({ error: `Transaction gas estimate increased beyond approved limit. Original gas estimate: ${tokenData.estimatedGas}, New gas estimate: ${preview.estimatedGas}` });
    }

    // Enforce approved maximum cost policy if defined
    if (tokenData.maxCostEth && preview.totalCostEth !== 'unknown') {
      const maxCostWei = parseEther(tokenData.maxCostEth);
      const currentCostWei = parseEther(preview.totalCostEth);
      if (currentCostWei > maxCostWei) {
        return res.status(403).json({ error: `Total cost exceeds approved maximum cost constraint. Approved max: ${tokenData.maxCostEth} ETH, Current: ${preview.totalCostEth} ETH` });
      }
    }

    const firewallConfig: FirewallConfig = {
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      maxBalancePercentageThreshold: 0.5
    };

    const risk = evaluateRisk(intent, resolvedAddress, preview, walletBalanceEth, firewallConfig, walletBalanceUsdc);
    if (risk.verdict === 'BLOCK' || risk.verdict === 'WARN') {
      return res.status(403).json({ error: `Transaction rejected by firewall during revalidation (Verdict: ${risk.verdict}).`, reasons: risk.reasons });
    }

    // Execute and re-validate via network broadcast verification
    const execResult = await executeAndVerifyTransaction(intent, resolvedAddress);

    if (execResult.status === 'pending') {
      return res.status(200).json({
        success: false,
        pending: true,
        hash: execResult.hash,
        message: execResult.message
      });
    }

    res.json({
      success: true,
      pending: false,
      hash: execResult.hash,
      message: execResult.message
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  // Validate USDC configuration on startup
  try {
    const usdcAddr = getSepoliaUsdcAddress();
    console.log(`Validated Sepolia USDC contract address: ${usdcAddr}`);
  } catch (err: any) {
    console.error(`FATAL: USDC configuration validation failed: ${err.message}`);
    throw err;
  }

  let uri = process.env.MONGODB_URI;
  let mongod: MongoMemoryServer | null = null;
  if (!uri) {
    console.log('MONGODB_URI not found. Starting in-memory MongoDB server for development...');
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri();
  }
  await connectDB(uri);

  // Migrate from .env if empty
  const collection = getContactsCollection();
  const count = await collection.countDocuments();
  if (count === 0 && process.env.ADDRESS_BOOK) {
    const envBook = JSON.parse(process.env.ADDRESS_BOOK);
    const docs = Object.entries(envBook).map(([name, address]) => ({ name, walletAddress: address as string }));
    if (docs.length > 0) {
      await collection.insertMany(docs);
      console.log('Migrated address book from .env to MongoDB');
    }
  }

  /**
   * SECURITY ARCHITECTURE NOTICE:
   * The local prototype server explicitly binds to 127.0.0.1 (localhost) to prevent
   * unintended exposure across the local area network.
   * Remote/production deployment requires transport-layer security (HTTPS/TLS),
   * strict user authentication, and session-bound approval tokens.
   */
  app.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}

export { app };
