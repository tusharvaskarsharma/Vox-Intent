# VoxIntent

> **A voice-first, zero-trust interface for safe Ethereum Sepolia transactions.**
>
> Speak an intent. Review the plan. Approve once. Verify what actually happened on-chain.

<div align="center">

![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=111827)
![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=node.js&logoColor=white)
![Network](https://img.shields.io/badge/Network-Ethereum%20Sepolia-627EEA?logo=ethereum&logoColor=white)
![Tests](https://img.shields.io/badge/tests-164%20passing-16A34A)
![License](https://img.shields.io/badge/status-prototype-F59E0B)

</div>

---

## Contents

- [What is VoxIntent?](#what-is-voxintent)
- [Why the architecture is different](#why-the-architecture-is-different)
- [System architecture](#system-architecture)
- [End-to-end workflow](#end-to-end-workflow)
- [API reference](#api-reference)
- [Execution state machine](#execution-state-machine)
- [Security model](#security-model)
- [Project structure](#project-structure)
- [Local setup](#local-setup)
- [Testing](#testing)
- [Production hardening](#production-hardening)
- [Technical notes](#technical-notes)

---

## What is VoxIntent?

VoxIntent turns natural-language requests such as:

```text
Send 0.05 ETH to Rahul
Send 25 USDC to Alice
Check my balance
```

into a controlled transaction workflow for **Ethereum Sepolia**.

The LLM is used only at the **interpretation boundary**. It never signs, constructs, or broadcasts a transaction. Every executable request must pass through deterministic schema validation, address-book resolution, transaction simulation, firewall checks, explicit confirmation, approval-token validation, and post-execution verification.

### Supported actions

| Spoken intent | Backend action | Can broadcast? |
|---|---|---:|
| Check wallet balance | `balance` | No — read-only |
| Send native Ether | `send_eth` | Yes, after all gates pass |
| Send Circle USDC | `send_usdc` | Yes, after all gates pass |

### Core principles

- **LLM is untrusted.** It proposes structured data; deterministic code decides what is valid.
- **Address-book only.** Users name contacts; arbitrary wallet addresses are not accepted by the fallback parser.
- **Preview before approval.** The UI shows confirmed facts separately from estimated runtime values.
- **One-time authorization.** Approval tokens are short-lived, parameter-bound, and deleted before execution awaits.
- **Fail closed.** Unknown recipients, bad simulation, insufficient funds, changed parameters, stale previews, WARN, and BLOCK states cannot execute.
- **Verify reality.** A successful receipt is not the end: balance deltas and a typed checklist explain what was confirmed.

---

## Why the architecture is different

Most voice-to-transaction demos connect speech directly to a wallet action. VoxIntent deliberately inserts a **deterministic safety corridor** between language and execution:

```text
Natural language  →  Structured intent  →  Validated preview  →  Explicit approval  →  Verified result
       LLM                 Zod/schema             Firewall              Single-use token          On-chain checks
```

The design keeps the convenient conversational interface while ensuring the final transaction is derived from validated backend state—not from raw model output or frontend state.

---

## System architecture

```mermaid
flowchart LR
    U[User voice or text] --> FE[React + Vite frontend]
    FE -->|POST /api/process| API[Express API]

    API --> EXT[Intent extractor]
    EXT --> GEM[Google Gemini]
    EXT --> FALL[Deterministic regex fallback]

    API --> VAL[Strict intent validation]
    VAL --> DB[(MongoDB address book)]
    VAL --> CHAIN[Sepolia blockchain core]

    CHAIN --> BUILD[Build unsigned ETH / USDC tx]
    BUILD --> SIM[EVM simulation + gas estimate]
    SIM --> FW[Intent Firewall]
    FW --> TOKEN[Short-lived approval token]

    TOKEN -->|POST /api/execute + confirmed=true| REVAL[Revalidate everything]
    REVAL --> SIGN[Server wallet signs and broadcasts]
    SIGN --> RPC[Ethereum Sepolia RPC]
    RPC --> VERIFY[Receipt + tx fields + balance deltas]
    VERIFY --> FE

    style U fill:#eef2ff,stroke:#6366f1,color:#111827
    style FE fill:#ecfeff,stroke:#0891b2,color:#111827
    style API fill:#eff6ff,stroke:#2563eb,color:#111827
    style FW fill:#fff7ed,stroke:#ea580c,color:#111827
    style TOKEN fill:#fefce8,stroke:#ca8a04,color:#111827
    style VERIFY fill:#f0fdf4,stroke:#16a34a,color:#111827
```

### Component responsibilities

| Component | Responsibility | Trust level |
|---|---|---|
| React frontend | Voice/text input, plan card, comparison panel, confirmation UI, verification display | Untrusted presentation layer |
| Express API | Input validation, orchestration, rate limiting, CORS, security headers | Trusted control plane |
| Gemini extractor | Converts natural language into a candidate intent | Untrusted interpreter |
| Regex fallback | Deterministic recovery for unambiguous supported phrases | Constrained parser |
| Intent validator | Strict action, amount, confidence, and recipient validation | Deterministic gate |
| MongoDB address book | Maps contact names to wallet addresses | Source of recipient truth |
| Intent Firewall | Balance, simulation, gas, recipient, amount, and policy decisions | Deterministic policy engine |
| Approval-token store | Single-use, short-lived authorization binding | In-memory prototype store |
| viem blockchain core | Sepolia chain checks, transaction construction, signing, receipt verification | Execution boundary |

### Repository graph at a glance

The repository graph contains the following major communities and hubs:

- **Blockchain Backend Core:** `constructUnsignedTransaction()`, `simulateAndPreviewTransaction()`, `executeAndVerifyTransaction()`, `publicClient`, `walletClient`, `evaluateRisk()`
- **Frontend React App:** `App()`, typed API response models, plan card, comparison UI, checklist UI
- **Database & Startup:** `connectDB()`, `getContactsCollection()`, `validateIntent()`, `startServer()`
- **Backend Dependencies and Scripts:** Express, viem, MongoDB, Gemini, TypeScript, test tooling
- **No import cycles detected** in the generated repository graph.

### Visual system architecture

![VoxIntent System Architecture](https://private-us-east-1.manuscdn.com/sessionFile/aHYYwSdIWt2N8Cg6yqKAQQ/sandbox/GGjjXbj8XJWdnh14dxHczw-images_1791643778801_na1fn_L2hvbWUvdWJ1bnR1L3ZveC1pbnRlbnQtYXVkaXQvZG9jcy92b3hpbnRlbnQtc3lzdGVtLWFyY2hpdGVjdHVyZQ.webp?Policy=eyJTdGF0ZW1lbnQiOlt7IlJlc291cmNlIjoiaHR0cHM6Ly9wcml2YXRlLXVzLWVhc3QtMS5tYW51c2Nkbi5jb20vc2Vzc2lvbkZpbGUvYUhZWXdTZElXdDJOOENnNnlxS0FRUS9zYW5kYm94L0dHampYYmo4WEpXZG5oMTRkeEhjenctaW1hZ2VzXzE3OTE2NDM3Nzg4MDFfbmExZm5fTDJodmJXVXZkV0oxYm5SMUwzWnZlQzFwYm5SbGJuUXRZWFZrYVhRdlpHOWpjeTkyYjNocGJuUmxiblF0YzNsemRHVnRMV0Z5WTJocGRHVmpkSFZ5WlEud2VicCIsIkNvbmRpdGlvbiI6eyJEYXRlTGVzc1RoYW4iOnsiQVdTOkVwb2NoVGltZSI6MTc5MzQ5MTIwMH19fV19&Key-Pair-Id=K2QY5QTL8JSY6C&Signature=MEYCIQDVolhxzz-MhBJ2m5OInVXw5Bcz5CMkeli1f5ECowdw7wIhAJ~kcQeg4f3iRU4bHt2pCuYyXor0ZBWnMarQ83FI~OlM)

---

## End-to-end workflow

### 1. Process and preview workflow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI
    participant API as POST /api/process
    participant LLM as Gemini
    participant Fallback as Regex fallback
    participant DB as Address book
    participant RPC as Sepolia RPC
    participant FW as Intent Firewall

    User->>UI: Speak or type request
    UI->>API: { text }
    API->>LLM: Extract candidate JSON intent
    alt Gemini timeout, error, or unusable output
        API->>Fallback: Parse supported unambiguous phrase
        Fallback-->>API: Candidate intent or fail closed
    else Gemini returns valid candidate
        LLM-->>API: Candidate intent
    end
    API->>DB: Resolve contact name
    DB-->>API: Canonical recipient address
    API->>RPC: Check Sepolia chain + wallet balances
    API->>RPC: Construct and simulate unsigned transaction
    RPC-->>API: Gas estimate, simulation result, preview
    API->>FW: Evaluate confidence, recipient, amount, balance, gas
    FW-->>API: PASS, WARN, or BLOCK
    API-->>UI: Intent + preview + risk + optional approval token
    UI-->>User: Plan card and “What you said vs. what executes”
```

### 2. Execute and verify workflow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant UI as React UI
    participant API as POST /api/execute
    participant Store as Approval token Map
    participant RPC as Sepolia RPC
    participant Wallet as Server wallet

    User->>UI: Click Confirm and Send
    UI->>API: Send intent and approval token
    API->>Store: Claim and delete token synchronously
    API->>API: Validate intent and compare token bindings
    API->>RPC: Re-check chain, balances, simulation, firewall, gas cap
    API->>RPC: Capture pre-execution balances
    API->>Wallet: Sign and broadcast exact transaction
    Wallet-->>API: Transaction hash

    alt Receipt times out
        API-->>UI: Return pending status and hash
        UI-->>User: Do not resubmit
    else Receipt confirms
        API->>RPC: Fetch receipt and broadcast transaction
        API->>RPC: Capture post-execution balances
        API->>API: Compute exact bigint deltas
        API-->>UI: Return checklist and balance verification
        UI-->>User: Show verified or inconclusive result
    end
```

### 3. What is actually verified?

```mermaid
flowchart TD
    A[Receipt confirmed] --> B{Broadcast fields match?}
    B -- No --> X[Fail execution result]
    B -- Yes --> C[Read post-execution balances]
    C -- RPC error --> I[INCONCLUSIVE\nReceipt is still confirmed]
    C -- Success --> D{Expected deltas match?}
    D -- No --> M[MISMATCH\nReceipt is still confirmed]
    D -- Yes --> P[PASSED\nTransaction and balances verified]

    style X fill:#fee2e2,stroke:#dc2626,color:#111827
    style I fill:#fef3c7,stroke:#d97706,color:#111827
    style M fill:#fee2e2,stroke:#dc2626,color:#111827
    style P fill:#dcfce7,stroke:#16a34a,color:#111827
```

---

## API reference

Base URL during local development: `http://localhost:3000`

### `GET /health`

Lightweight backend health check.

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "message": "Backend is running"
}
```

---

### `POST /api/process`

Extracts, validates, resolves, simulates, evaluates, and previews an intent.

#### Request

The body must contain exactly one field: `text`. Maximum length: **500 characters**.

```bash
curl -X POST http://localhost:3000/api/process \
  -H 'Content-Type: application/json' \
  -d '{"text":"Send 25 USDC to Alice"}'
```

#### Successful transfer response shape

```json
{
  "intent": {
    "action": "send_usdc",
    "amount": "25",
    "recipient": "Alice",
    "confidence": 0.97
  },
  "resolvedAddress": "0x...",
  "preview": {
    "network": "sepolia",
    "asset": "USDC",
    "contractAddress": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    "sender": "0x...",
    "recipient": "0x...",
    "amount": "25",
    "amountRaw": "25000000",
    "amountEth": "0",
    "estimatedGas": "65000",
    "gasCostEth": "0.00013",
    "totalCostEth": "0.00013",
    "simulationStatus": "success"
  },
  "risk": {
    "verdict": "PASS",
    "reasons": []
  },
  "approvalToken": "uuid-v4-token"
}
```

#### Balance request

```bash
curl -X POST http://localhost:3000/api/process \
  -H 'Content-Type: application/json' \
  -d '{"text":"Check my balance"}'
```

A balance request returns `intent`, `balance`, and `risk`, but **never** returns a transaction preview or approval token.

#### Important error cases

| Status | Example reason |
|---:|---|
| `400` | Invalid body, empty text, unsupported intent, malformed amount, unknown contact |
| `403` | Firewall `WARN` or `BLOCK` during execution-related validation |
| `429` | Rate limit exceeded |
| `500` | RPC or backend failure |

---

### `POST /api/execute`

Revalidates and executes a previously previewed transaction.

#### Request

```json
{
  "intent": {
    "action": "send_eth",
    "amount": "0.05",
    "recipient": "Rahul",
    "confidence": 0.97
  },
  "confirmed": true,
  "approvalToken": "uuid-v4-token"
}
```

The backend requires:

- `confirmed === true`.
- A valid UUID v4 approval token.
- A token that has not expired or been used.
- Exact match for sender, recipient, asset, amount, contract, network, gas limit, and maximum cost.
- A fresh successful simulation and a second firewall PASS.

#### Confirmed response

```json
{
  "success": true,
  "pending": false,
  "hash": "0x...",
  "message": "Transaction successfully executed, confirmed, and verified on-chain.",
  "checklist": [
    { "id": "receipt", "status": "passed" },
    { "id": "recipient", "status": "passed" },
    { "id": "intent", "status": "passed" },
    { "id": "balance", "status": "passed" },
    { "id": "hash", "status": "passed" }
  ],
  "balanceVerification": {
    "status": "passed",
    "asset": "ETH",
    "preSenderEth": "10000000000000000000",
    "postSenderEth": "9949958000000000000",
    "senderEthDelta": "50042000000000000",
    "actualGasFeeWei": "42000000000000",
    "expectedTransferUnits": "50000000000000000"
  }
}
```

#### Pending response

A broadcast can succeed even when receipt confirmation times out. In this case the backend returns HTTP `200` with `pending: true`:

```json
{
  "success": false,
  "pending": true,
  "hash": "0x...",
  "message": "Transaction broadcast; receipt and balance verification pending.",
  "checklist": [
    { "id": "hash", "status": "passed" },
    { "id": "receipt", "status": "pending" },
    { "id": "recipient", "status": "pending" },
    { "id": "intent", "status": "pending" },
    { "id": "balance", "status": "pending" }
  ],
  "balanceVerification": {
    "status": "pending",
    "asset": "ETH"
  }
}
```

> **Never resubmit a pending transaction.** Use the transaction hash to monitor Sepolia confirmation.

---

## Execution state machine

```mermaid
stateDiagram-v2
    [*] --> Idle
    Idle --> Processing: Submit text / voice
    Processing --> PreviewReady: Valid intent + simulation success + PASS
    Processing --> ReadOnlyBalance: action = balance
    Processing --> Blocked: Invalid / WARN / BLOCK / simulation failure

    PreviewReady --> Stale: User edits request
    Stale --> Processing: Reprocess revised request
    PreviewReady --> AwaitingConfirmation: User reviews plan
    AwaitingConfirmation --> Broadcasting: Confirm + valid token
    AwaitingConfirmation --> Stale: Modify plan

    Broadcasting --> Pending: Receipt timeout
    Broadcasting --> ReceiptConfirmed: Receipt success
    Broadcasting --> Reverted: Receipt reverted

    ReceiptConfirmed --> Verified: Balance deltas match
    ReceiptConfirmed --> Inconclusive: Post-balance RPC failure
    ReceiptConfirmed --> Mismatch: Balance deltas differ

    Verified --> [*]
    Inconclusive --> [*]
    Mismatch --> [*]
    Pending --> [*]
    Reverted --> [*]
    Blocked --> [*]
    ReadOnlyBalance --> [*]
```

---

## Security model

### Trust boundaries

```mermaid
flowchart TB
    subgraph Untrusted[Untrusted inputs]
        Speech[Speech transcription]
        Text[Typed text]
        Model[Gemini output]
        Browser[Frontend state]
    end

    subgraph Deterministic[Deterministic backend gates]
        Schema[Strict schema validation]
        Contact[Address-book resolution]
        Tx[Unsigned transaction construction]
        Sim[Simulation + gas checks]
        Firewall[Intent Firewall]
        Approval[Bound approval token]
        Revalidation[Execution-time revalidation]
    end

    subgraph Protected[Protected execution]
        Key[Server private key]
        Sepolia[Ethereum Sepolia RPC]
        Verify[Receipt + balance verification]
    end

    Speech --> Schema
    Text --> Schema
    Model --> Schema
    Browser --> Revalidation
    Schema --> Contact --> Tx --> Sim --> Firewall --> Approval --> Revalidation
    Revalidation --> Key --> Sepolia --> Verify

    style Untrusted fill:#fef2f2,stroke:#ef4444,color:#111827
    style Deterministic fill:#eff6ff,stroke:#2563eb,color:#111827
    style Protected fill:#f0fdf4,stroke:#16a34a,color:#111827
```

### Security invariants

1. **Sepolia-only:** chain ID must be `11155111` during startup, simulation, and execution.
2. **Official USDC only:** configured contract must match Circle’s Ethereum Sepolia USDC contract:
   `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
3. **No arbitrary recipients:** contacts resolve through MongoDB address-book records.
4. **No client-controlled transaction payload:** the backend reconstructs the unsigned transaction from validated intent.
5. **No approval on unsafe preview:** only successful simulation plus firewall `PASS` produces a token.
6. **Token binding:** token fields include sender, recipient, asset, amount, raw amount, contract, network, gas estimate, and cost cap.
7. **Single use:** token is deleted before async execution work begins.
8. **Fresh execution checks:** the backend revalidates intent, chain, balance, simulation, gas, and firewall state immediately before broadcast.
9. **No false success:** `pending`, `inconclusive`, and `mismatch` states are represented separately from verified success.
10. **Local-only binding:** the prototype binds to `127.0.0.1`, not `0.0.0.0`.

> **Prototype limitation:** approval tokens currently live in an in-memory `Map`. A horizontally scaled deployment must use a shared atomic store such as Redis with TTL and `GETDEL`/Lua semantics.

---

## Project structure

```text
Vox-Intent/
├── backend/
│   ├── src/
│   │   ├── index.ts                    # Express app and API routes
│   │   ├── extractor.ts                # Gemini + fallback extraction
│   │   ├── fallback.ts                 # Deterministic regex parser
│   │   ├── intent.ts                   # Strict intent validation + contact resolution
│   │   ├── firewall.ts                  # Deterministic risk engine
│   │   ├── blockchain.ts               # Sepolia tx, simulation, execution, verification
│   │   ├── db.ts                       # MongoDB address book
│   │   ├── intent-comparison.ts        # Shared comparison/checklist types
│   │   ├── test-setup.ts               # Isolated test configuration
│   │   ├── phase-b.test.ts             # Phase B regression tests
│   │   └── phase-c.test.ts             # Balance verification tests
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # Main product workflow and UI
│   │   ├── App.css                    # Component styling
│   │   ├── index.css                  # Global styling and theme
│   │   └── intent-comparison.ts       # Frontend comparison/checklist types
│   └── package.json
├── .env.example
└── README.md
```

---

## Local setup

### Prerequisites

- Node.js **20+**
- npm
- Google Gemini API key
- Sepolia RPC URL
- A dedicated wallet private key funded only with testnet ETH and, if needed, Sepolia USDC

### 1. Install dependencies

```bash
git clone https://github.com/tusharvaskarsharma/Vox-Intent.git
cd Vox-Intent

cd backend
npm install

cd ../frontend
npm install
```

### 2. Configure environment

Create a root `.env` file from the example:

```bash
cd ..
cp .env.example .env
```

```env
PORT=3000
FRONTEND_URL=http://localhost:5173

GEMINI_API_KEY=your_gemini_api_key_here

SEPOLIA_RPC_URL=https://rpc2.sepolia.org
SEPOLIA_PRIVATE_KEY=0x_your_testnet_private_key_here
SEPOLIA_USDC_CONTRACT_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238

ADDRESS_BOOK={"Rahul":"0x...","Alice":"0x..."}
```

**Never commit `.env` or a real private key.** Use a dedicated Sepolia-only wallet.

### 3. Run the backend

```bash
cd backend
npm run dev
```

Backend: `http://localhost:3000`

### 4. Run the frontend

In a second terminal:

```bash
cd frontend
npm run dev
```

Frontend: `http://localhost:5173`

### 5. Verify the backend

```bash
curl http://localhost:3000/health
```

---

## Testing

The backend suite is self-contained and does not require a funded wallet or live user secrets.

```bash
cd backend
npm test
```

The suite covers:

- LLM extraction and malformed-output handling.
- Deterministic regex fallback parsing.
- Strict intent and amount validation.
- Address-book recipient resolution.
- ETH and USDC transaction construction.
- Sepolia chain and Circle USDC contract enforcement.
- Simulation and gas failure handling.
- Firewall PASS/WARN/BLOCK decisions.
- Approval-token replay and concurrency protection.
- Stale request and revised-intent handling.
- Plan-card and mismatch data.
- Read-only balance behavior.
- Pre-execution balance fail-closed behavior.
- Post-execution ETH/USDC balance deltas.
- Pending, reverted, mismatch, and inconclusive outcomes.
- Five-item verification checklist consistency.

Current verified baseline: **164 tests passed**.

### Production builds

```bash
# Backend
cd backend
npm run build

# Frontend
cd ../frontend
npm run build
```

---

## Production hardening

This repository is a security-focused **Sepolia prototype**, not a production custody system. Before public or multi-user deployment:

- Replace the in-memory approval-token `Map` with a distributed atomic store and TTL.
- Add authentication and session-bound approval tokens.
- Use HTTPS/TLS and a hardened reverse proxy.
- Move signing to a dedicated wallet service, HSM, or custody provider.
- Never expose a private key through frontend code or browser storage.
- Add structured audit logs without logging secrets or private transaction data unnecessarily.
- Add nonce management, replacement-transaction policy, and RPC failover.
- Validate receipt gas metadata strictly; missing fee fields should produce an inconclusive verification state rather than assuming zero.
- Reject or explicitly model same-address USDC transfers.
- Run live Sepolia tests only with a dedicated, low-value test wallet.
- Add monitoring for failed simulations, rejected approvals, RPC errors, and pending receipts.

---

## Technical notes

### Exact amount handling

Amounts are accepted as validated decimal strings and converted to integer base units:

- ETH: wei via `parseEther()`.
- USDC: 6-decimal micro-units via `parseUnits(amount, 6)`.
- Balance deltas and gas costs are compared with `bigint`, avoiding floating-point rounding.

### Verification statuses

| Status | Meaning |
|---|---|
| `passed` | The expected condition was confirmed. |
| `failed` | The condition was checked and did not match. |
| `pending` | The transaction has been broadcast, but receipt confirmation is not complete. |
| `inconclusive` | The receipt may be confirmed, but a required verification read failed. |

### Network scope

- Chain: **Ethereum Sepolia**
- Chain ID: **11155111**
- USDC: Circle Ethereum Sepolia contract
- Explorer: [Sepolia Etherscan](https://sepolia.etherscan.io/)

---

## Final mental model

```text
The model can suggest.
The address book can resolve.
The simulator can estimate.
The firewall can approve.
Only the validated backend can execute.
The chain can confirm.
The balance delta can prove what happened.
```

---

<div align="center">

**VoxIntent — conversational UX with deterministic transaction safety.**

</div>
