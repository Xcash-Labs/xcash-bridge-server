import { MongoClient } from 'mongodb';
import { config } from './config.js';
import { logger } from './utils/logger.js';

let client = null;
let db = null;

export async function connectDB() {
  if (db) return db;

  client = new MongoClient(config.mongoUri);

  await client.connect();

  db = client.db(config.mongoDb);

  await createIndexes();

  logger.info(`Connected to MongoDB database: ${config.mongoDb}`);

  return db;
}

async function createIndexes() {
  const bridgeRequests = db.collection('bridge_requests');
  const bridgeHistory = db.collection('bridge_requests_history');

  const uniqueStringIndexOptions = (name, field) => ({
    name,
    unique: true,
    partialFilterExpression: {
      [field]: { $type: 'string' }
    }
  });

  // Active requests: unique only when hash exists and is a string.
  // Allows many null/missing tx_hash / evm_tx_hash values.
  await bridgeRequests.createIndex(
    { tx_hash: 1 },
    uniqueStringIndexOptions('uniq_bridge_requests_tx_hash', 'tx_hash')
  );

  await bridgeRequests.createIndex(
    { evm_tx_hash: 1 },
    uniqueStringIndexOptions('uniq_bridge_requests_evm_tx_hash', 'evm_tx_hash')
  );

  // History: also enforce uniqueness after archiving completed/failed requests.
  await bridgeHistory.createIndex(
    { tx_hash: 1 },
    uniqueStringIndexOptions('uniq_bridge_history_tx_hash', 'tx_hash')
  );

  await bridgeHistory.createIndex(
    { evm_tx_hash: 1 },
    uniqueStringIndexOptions('uniq_bridge_history_evm_tx_hash', 'evm_tx_hash')
  );

  await bridgeRequests.createIndex(
    { status: 1, created_at: 1 }
  );

  await bridgeRequests.createIndex(
    { status: 1, locked_until: 1 }
  );

  await bridgeHistory.createIndex({
    xck_address: 1,
    created_at: -1
  });
}

export function getDB() {
  if (!db) {
    throw new Error('MongoDB is not connected');
  }

  return db;
}

export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;

    logger.info('MongoDB connection closed');
  }
}