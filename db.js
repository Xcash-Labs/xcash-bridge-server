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

  await bridgeRequests.createIndex(
    { tx_hash: 1 },
    { unique: true }
  );

  await bridgeRequests.createIndex({
    status: 1,
    created_at: 1
  });

  await bridgeRequests.createIndex({
    status: 1,
    locked_until: 1
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