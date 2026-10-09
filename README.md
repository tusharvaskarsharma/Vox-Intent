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
Edit `.env` to include your real keys:
```env
# Server
PORT=3000
FRONTEND_URL=http://localhost:5173

# AI Extraction
GEMINI_API_KEY=your_gemini_api_key_here

# Blockchain Interaction
SEPOLIA_RPC_URL=https://rpc2.sepolia.org
SEPOLIA_PRIVATE_KEY=0x_your_private_key_here

# Address Book Seeds (JSON Map of Name -> Address)
ADDRESS_BOOK={"Rahul":"0x1D9f6830b29773733411736db3883cBA9a5f93AC"}
```

### 3. Running the App locally

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
The backend is fortified by a robust suite of unit and integration tests verifying the LLM extraction, firewall security, simulation, and execution paths.

To run the test suite:
```bash
cd backend
npm test
```

## Security & Risk Model
This system assumes the LLM could hallucinate or be subjected to prompt injection. As such, the LLM **cannot** sign transactions.
1. The user provides a text prompt.
2. The LLM returns a structured JSON payload representing the intent.
3. The Backend constructs an unsigned transaction and simulates it against a live EVM node.
4. The **Intent Firewall** assesses the simulation output against the user's initial intent.
5. A single-use approval token is generated and handed back to the Frontend.
6. The user manually verifies the simulated preview in the UI and clicks "Confirm".
7. The Execution API validates the approval token, reconstructs the transaction from scratch, and signs it locally using `viem`.
