import express from 'express';
import dotenv from 'dotenv';
import path from 'path';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { validateIntent, SendIntent, CONFIDENCE_THRESHOLD } from './intent';
import { extractIntent } from './extractor';
import { constructUnsignedTransaction, simulateAndPreviewTransaction, publicClient, getSenderAccount, TransactionPreview } from './blockchain';
import { evaluateRisk, FirewallConfig } from './firewall';
import { formatEther } from 'viem';
import { connectDB, getContactsCollection } from './db';
import { MongoMemoryServer } from 'mongodb-memory-server';

export interface ApprovalTokenData {
  recipient: string;
  amount: number;
  network: string;
  estimatedGas: string;
  expiresAt: number;
}
export const approvalTokens = new Map<string, ApprovalTokenData>();


// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const app = express();
const port = process.env.PORT || 3000;
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

app.use(cors({
  origin: function (origin, callback) {
    if (!origin || origin === frontendUrl) {
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

const processLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
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

    let unsignedTx: any = null;
    let preview: TransactionPreview | null = null;
    
    // 2 & 3. Recipient Resolution & Transaction Review (Construct & Simulate)
    if (intent.action === 'send' && resolvedAddress) {
      try {
        unsignedTx = await constructUnsignedTransaction(intent as SendIntent, resolvedAddress);
        preview = await simulateAndPreviewTransaction(unsignedTx);
      } catch (err: any) {
        preview = {
          network: 'sepolia',
          sender: account.address,
          recipient: resolvedAddress,
          amountEth: (intent as SendIntent).amount.toString(),
          estimatedGas: '0',
          totalCostEth: '0',
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

    const risk = evaluateRisk(intent, resolvedAddress, preview || undefined, walletBalanceEth, firewallConfig);

    // 5. Display result (return to frontend)
    let approvalToken: string | undefined;
    if (intent.action === 'send' && preview && preview.simulationStatus === 'success' && risk.verdict === 'PASS') {
      approvalToken = crypto.randomUUID();
      approvalTokens.set(approvalToken, {
        recipient: resolvedAddress!.toLowerCase(),
        amount: (intent as SendIntent).amount,
        network: preview.network,
        estimatedGas: preview.estimatedGas,
        expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
      });
    }

    return res.json({
      intent,
      preview: preview || undefined,
      risk,
      approvalToken
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

const isTest = process.env.npm_lifecycle_event === 'test' || process.env.NODE_ENV === 'test' || process.argv.some(arg => arg.includes('--test'));

const executeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTest ? 100 : 5,
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

    const tokenData = approvalTokens.get(approvalToken);
    if (!tokenData) {
      return res.status(403).json({ error: 'Invalid or reused approval token.' });
    }

    if (Date.now() > tokenData.expiresAt) {
      approvalTokens.delete(approvalToken);
      return res.status(403).json({ error: 'Expired approval token.' });
    }

    const validationResult = await validateIntent(rawIntent);
    if (!validationResult.valid) {
      return res.status(400).json({ error: validationResult.error });
    }
    if (!validationResult.resolvedAddress) {
      return res.status(400).json({ error: 'Invalid intent or unresolved recipient' });
    }

    const intent = validationResult.intent as SendIntent;
    const resolvedAddress = validationResult.resolvedAddress;

    if (tokenData.recipient !== resolvedAddress.toLowerCase() || tokenData.amount !== intent.amount) {
      approvalTokens.delete(approvalToken);
      return res.status(403).json({ error: 'Mismatched approval token details.' });
    }

    // Re-run risk firewall to ensure it hasn't changed or become dangerous
    const account = getSenderAccount();
    const balanceWei = await publicClient.getBalance({ address: account.address });
    const walletBalanceEth = formatEther(balanceWei);
    
    let unsignedTx: any = null;
    let preview: TransactionPreview | null = null;
    
    try {
      unsignedTx = await constructUnsignedTransaction(intent, resolvedAddress);
      preview = await simulateAndPreviewTransaction(unsignedTx);
    } catch (err: any) {
      return res.status(403).json({ error: 'Failed to reconstruct/simulate transaction during execution phase.', details: err.message });
    }
    
    if (preview.network !== tokenData.network || preview.estimatedGas !== tokenData.estimatedGas || preview.amountEth !== tokenData.amount.toString()) {
      approvalTokens.delete(approvalToken);
      return res.status(403).json({ error: `Transaction preview changed since approval. Original gas estimate: ${tokenData.estimatedGas}, New gas estimate: ${preview.estimatedGas}` });
    }
    
    const firewallConfig: FirewallConfig = {
      confidenceThreshold: CONFIDENCE_THRESHOLD,
      maxBalancePercentageThreshold: 0.5
    };
    
    const risk = evaluateRisk(intent, resolvedAddress, preview, walletBalanceEth, firewallConfig);
    if (risk.verdict === 'BLOCK' || risk.verdict === 'WARN') {
       return res.status(403).json({ error: `Transaction rejected by firewall during revalidation (Verdict: ${risk.verdict}).`, reasons: risk.reasons });
    }

    approvalTokens.delete(approvalToken);

    // Execute and re-validate via network broadcast verification
    const hash = await require('./blockchain').executeAndVerifyTransaction(intent, resolvedAddress);
    
    res.json({ success: true, hash, message: 'Transaction successfully executed and verified on-chain.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
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

  app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}

export { app };
