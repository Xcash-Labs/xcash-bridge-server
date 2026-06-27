import { getDB } from '../db.js';

const COLLECTION = 'bridge_requests';

function collection() {
  return getDB().collection(COLLECTION);
}

export const BridgeRequest = {
  async create({
    tx_hash,
    xck_address,
    evm_address,
    network,
    amount_atomic
  }) {
    const now = new Date();

    const doc = {
      tx_hash,
      xck_address,
      evm_address,
      network,
      amount_atomic,

      status: 'pending',

      confirmations: 0,
      verified: false,

      evm_tx_hash: null,
      error: null,

      locked_at: null,
      locked_until: null,

      created_at: now,
      updated_at: now
    };

    await collection().insertOne(doc);

    return doc;
  },

  async findByTxHash(tx_hash) {
    return collection().findOne(
      { tx_hash },
      {
        projection: {
          _id: 0,
          tx_hash: 1,
          xck_address: 1,
          evm_address: 1,
          network: 1,
          amount_atomic: 1,
          status: 1,
          confirmations: 1,
          verified: 1,
          evm_tx_hash: 1,
          error: 1,
          created_at: 1,
          updated_at: 1
        }
      }
    );
  },

  async lockNextPending(lockMs = 60000) {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + lockMs);

    return collection().findOneAndUpdate(
      {
        status: 'pending',
        $or: [
          { locked_until: null },
          { locked_until: { $lte: now } }
        ]
      },
      {
        $set: {
          status: 'verifying',
          locked_at: now,
          locked_until: lockedUntil,
          updated_at: now
        }
      },
      {
        sort: { created_at: 1 },
        returnDocument: 'after'
      }
    );
  },

  async markPending(_id, confirmations = 0, error = null) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: 'pending',
          confirmations,
          error,
          locked_at: null,
          locked_until: null,
          updated_at: now
        }
      }
    );
  },

  async markMinting(_id, confirmations) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: 'minting',
          confirmations,
          verified: true,
          xck_verified_at: now,
          updated_at: now
        }
      }
    );
  },

  async markCompleted(_id, evm_tx_hash) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: 'completed',
          evm_tx_hash,
          error: null,
          locked_at: null,
          locked_until: null,
          updated_at: now
        }
      }
    );
  },

  async markFailed(_id, error) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: 'failed',
          error: error || 'Unknown error',
          locked_at: null,
          locked_until: null,
          updated_at: now
        }
      }
    );
  }
};
