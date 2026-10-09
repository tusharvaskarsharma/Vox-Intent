# VoiceIntent

VoiceIntent is a natural language interface for blockchain execution. It empowers users to dispatch on-chain transactions using simple conversational prompts (e.g., *"Send 0.0001 ETH to Rahul"*). 

To ensure safety in a zero-trust environment, VoiceIntent operates behind a deterministic **Intent Firewall**. The system uses LLMs (Google Gemini) for unstructured intent extraction but strictly relies on classical cryptography and strict safety rules to simulate, validate, and execute the transactions. 

## Key Features
- 🧠 **Natural Language Extraction:** Uses Google Gemini to translate conversational text into structured transaction intents.
- 🛡️ **Intent Firewall:** A deterministic risk engine that simulates transactions and evaluates risk before allowing execution. It enforces rules like balance checks, recipient matching, and confidence thresholds.
- 🔐 **Cryptographic Approvals:** Uses a secure, stateful, single-use approval token system bound to exact transaction parameters to prevent replay attacks and arbitrary payload injection.
- ⚡ **Seamless EVM Integration:** Built with `viem` to instantly interact with the Sepolia Testnet.

## Architecture & Tech Stack
- **Frontend:** React, Vite, TypeScript, GSAP/Tailwind (UI logic).
- **Backend:** Node.js, Express, TypeScript.
- **Blockchain:** `viem` for interacting with Ethereum RPCs.
- **AI Model:** `@google/genai` (Gemini Flash 3) for deterministic JSON output.
- **Data:** `mongodb-memory-server` for a lightweight local address book mapping.

## Prerequisites
Before running the project, you will need:
1. Node.js (v20+ recommended)
2. A [Google Gemini API Key](https://aistudio.google.com/app/apikey)
3. An Ethereum Wallet Private Key funded with **Sepolia Testnet ETH**.
4. A Sepolia RPC URL (e.g., via Alchemy, Infura, or public RPCs).

## Setup Instructions

### 1. Installation
Clone the repository and install dependencies in both the `frontend` and `backend` directories.

```bash
# Install backend dependencies
cd backend
npm install

# Install frontend dependencies
cd ../frontend
npm install
```

### 2. Environment Configuration
Copy the sample environment file and configure your API keys.

```bash
# In the root directory
cp .env.example .env
```
Edit `.env` to include your configuration:
```env
# Server Binding
PORT=3000
FRONTEND_URL=http://localhost:5173

# AI Extraction (Google Gemini)
GEMINI_API_KEY=your_gemini_api_key_here

# Blockchain Interaction (Ethereum Sepolia Testnet Only)
SEPOLIA_RPC_URL=https://rpc2.sepolia.org
SEPOLIA_PRIVATE_KEY=0x_your_private_key_here

# Official Circle Ethereum Sepolia USDC Contract Address
SEPOLIA_USDC_CONTRACT_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238

# Address Book Seeds (JSON Map of Contact Name -> Ethereum Address)
ADDRESS_BOOK={"Rahul":"0x1D9f6830b29773733411736db3883cBA9a5f93AC","Alice":"0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"}
```

### 3. Running the App Locally

Start the backend server:
```bash
cd backend
npm run dev
```

Start the frontend application:
```bash
cd frontend
npm run dev
```

Open your browser to [http://localhost:5173](http://localhost:5173).

## Testing
The backend is fortified by a robust suite of 156+ unit and integration tests verifying LLM extraction, deterministic fallback parsing, firewall rules, token concurrency, simulation, plan card data, mismatch detection, and execution paths.

The test suite is **fully self-contained**: it automatically uses ephemeral test keys and mocks, never requiring a real funded wallet or reading live user secrets from `.env`.

To run the test suite:
```bash
cd backend
npm test
```

## Security & Architecture Specifications

### 1. Testnet-Only Scope & Startup Assertions
- **Chain ID Assertion:** On startup and before every transaction simulation and execution, the backend queries the RPC and asserts that the chain ID is strictly `11155111` (Ethereum Sepolia). It fails closed immediately if connected to any other chain.
- **USDC Contract Verification:** The backend strictly asserts that `SEPOLIA_USDC_CONTRACT_ADDRESS` matches Circle's verified official Sepolia contract address: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`. If missing, malformed, or mismatched, backend startup fails closed.

### 2. Safe Local Server Binding
- **127.0.0.1 Local Binding:** The local prototype server explicitly binds to `127.0.0.1` (localhost) rather than `0.0.0.0` to prevent exposure across the local network interface. The port remains configurable via `PORT`.
- **Remote Deployment Requirements:** Any remote, multi-user, or public deployment requires transport layer security (HTTPS/TLS), an authentication layer, and session-bound approval tokens to prevent unauthorized transaction execution.

### 3. Approval Token Lifecycle & Single-Process Scope
- **Cryptographic Binding:** Approval tokens are cryptographically random UUIDs generated only after simulation succeeds and the firewall issues a `PASS` verdict. Tokens strictly bind `sender`, `recipient`, `asset`, `contractAddress`, `amount`, `amountRaw`, `network`, `estimatedGas` limit, and `maxCostEth`.
- **Single-Use & Race-Safe:** Tokens expire in 5 minutes and are synchronously claimed and deleted prior to any awaited async operations during `/api/execute`, preventing concurrency double-spend attacks.
- **Single-Instance Limitation:** In this prototype, approval tokens are stored in an in-memory `Map`. In a horizontally scaled production cluster with multiple server instances, tokens must be backed by a distributed, atomic key-value store (such as Redis with atomic `GETDEL` or Lua scripts) with TTL.

### 4. Zero-Trust LLM Boundary
- The LLM (Google Gemini) is untrusted and cannot sign or broadcast transactions.
- All extracted intents are structurally validated into strict schemas (`ExtractedIntent`) before downstream processing.
- A deterministic regex fallback parser runs if Gemini extraction times out (10s), throws, or returns unusable output, supporting only unambiguous `balance`, `send_eth`, and `send_usdc` actions.
- The **Intent Firewall** revalidates balance limits, gas limits, and recipient addresses before and during execution, permanently rejecting `WARN` and `BLOCK` verdicts.

### 5. UI Review & Execution Plan Architecture (Phase B)
- **Plan Card:** Distinctly separates **Confirmed Execution Facts** (Action, Asset, Amount, Contact, Resolved On-chain Address, Network) from **Estimated Runtime Parameters** (Estimated Gas Units, Gas Cost ETH, Maximum Total Cost Cap, EVM Simulation Status). For balance queries, presents a read-only wallet view with no confirmation button.
- **What You Said vs. What Executes Panel:** Displays the verbatim voice-transcribed phrase beside the validated execution parameters, clearly flagging potential verbal asset, amount, or recipient discrepancies. The backend's validated intent remains authoritative at all times.
- **Voice Modification & Invalidation:** Any revision made by voice dictation or typing immediately invalidates the previous preview and approval token, requiring full reprocessing through the backend before authorization can be unlocked. Stale previews or previous tokens can never be executed.
