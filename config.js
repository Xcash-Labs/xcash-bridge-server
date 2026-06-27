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

  minConfirmations: numberEnv('MIN_CONFIRMATIONS', 10),
  workerIntervalMs: numberEnv('WORKER_INTERVAL_MS', 5000)
};