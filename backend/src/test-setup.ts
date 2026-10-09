import { generatePrivateKey } from 'viem/accounts';

// 1. Force NODE_ENV to test before any runtime module imports
process.env.NODE_ENV = 'test';

// 2. Generate an ephemeral test private key if not already provided (never require real user .env or funded key)
if (!process.env.SEPOLIA_PRIVATE_KEY) {
  process.env.SEPOLIA_PRIVATE_KEY = generatePrivateKey();
}

// 3. Set verified official Circle Sepolia USDC contract address for testnet assertions
if (!process.env.SEPOLIA_USDC_CONTRACT_ADDRESS) {
  process.env.SEPOLIA_USDC_CONTRACT_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';
}

// 4. Default Sepolia RPC URL for test execution
if (!process.env.SEPOLIA_RPC_URL) {
  process.env.SEPOLIA_RPC_URL = 'https://rpc2.sepolia.org';
}
