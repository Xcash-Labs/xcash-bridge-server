import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];

  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function numberEnv(name, fallback) {
  const value = process.env[name];

  if (!value) return fallback;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid number for environment variable: ${name}`);
  }

  return parsed;
}

export const config = {
  port: numberEnv('PORT', 3000),
  mongoUri: required('MONGO_URI'),
  mongoDb: process.env.MONGO_DB || 'xcash_bridge',
  allowedOrigin: process.env.ALLOWED_ORIGIN || '*',
  bridgeXckAddress: required('BRIDGE_XCK_ADDRESS'),
  workerIntervalMs: numberEnv('WORKER_INTERVAL_MS', 60000),
  walletRpcHost: process.env.WALLET_RPC_HOST || '127.0.0.1',
  walletRpcPort: numberEnv('WALLET_RPC_PORT', 18289),
  bridgeDelayMinutes: numberEnv('BRIDGE_DELAY_MINUTES', 11),
  requestTimeoutMinutes: numberEnv('BRIDGE_REQUEST_TIMEOUT_MINUTES', 60),
  claimExpirationSeconds: numberEnv('CLAIM_EXPIRATION_SECONDS',604800),
  bridgePrivateKey: requireEnv('BRIDGE_PRIVATE_KEY'),
  polygonRpcUrl: requireEnv('POLYGON_RPC_URL'),
  polygonWxckAddress: requireEnv('POLYGON_WXCK_CONTRACT_ADDRESS')
};