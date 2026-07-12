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
  polygonBridgeXckAddress: required('POLYGON_BRIDGE_XCK_ADDRESS'),
  baseBridgeXckAddress: required('BASE_BRIDGE_XCK_ADDRESS'),
  workerIntervalMs: numberEnv('WORKER_INTERVAL_MS', 60000),
  walletRpcHost: process.env.WALLET_RPC_HOST || '127.0.0.1',
  walletRpcPortPolygon: numberEnv('WALLET_RPC_PORT_POLYGON', 18289),
  walletRpcPortBase: numberEnv('WALLET_RPC_PORT_BASE', 18290),
  xckToWxckDelayMinutes: numberEnv('XCK_TO_WXCK_DELAY_MINUTES', 11),
  wxckToXckDelayMinutes: numberEnv('WXCK_TO_XCK_DELAY_MINUTES', 2),
  requestTimeoutMinutes: numberEnv('BRIDGE_REQUEST_TIMEOUT_MINUTES', 60),
  claimExpirationSeconds: numberEnv('CLAIM_EXPIRATION_SECONDS',604800),
  bridgePrivateKeyPolygon: required('POLYGON_BRIDGE_PRIVATE_KEY'),
  bridgePrivateKeyBase: required('BASE_BRIDGE_PRIVATE_KEY'),
  polygonChainId: numberEnv('POLYGON_CHAIN_ID'),
  polygonRpcUrl: required('POLYGON_RPC_URL'),
  polygonWxckContractAddress: required('POLYGON_WXCK_CONTRACT_ADDRESS'),
  baseChainId: numberEnv('BASE_CHAIN_ID'),
  baseRpcUrl: required('BASE_RPC_URL'),
  baseWxckContractAddress: required('BASE_WXCK_CONTRACT_ADDRESS')
};