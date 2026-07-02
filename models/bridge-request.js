import { getDB } from '../db.js';

const COLLECTION = 'bridge_requests';

function collection() {
  return getDB().collection(COLLECTION);
}

export const BRIDGE_STATUSES = {
  REQUEST: 'request',
  WAITING: 'waiting',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

export const ACTIVE_BRIDGE_STATUSES = [
  BRIDGE_STATUSES.REQUEST,
  BRIDGE_STATUSES.WAITING
];

export const BridgeRequest = {
  async create({
    xck_address,
    evm_address,
    network,
    direction,
    amount_atomic
  }) {
    const now = new Date();

    const doc = {
      tx_hash: null,
      xck_address,
      evm_address,
      network,
      direction,
      amount_atomic,
      status: BRIDGE_STATUSES.REQUEST,
      evm_tx_hash: null,
      error: null,
      created_at: now,
      updated_at: now
    };

    const result = await collection().insertOne(doc);
    doc._id = result.insertedId;

    return doc;
  },

  async attachTxHash({
    bridge_id,
    tx_hash,
    xck_address
  }) {
    const now = new Date();
    const { ObjectId } = await import('mongodb');

    return collection().findOneAndUpdate(
      {
        _id: new ObjectId(bridge_id),
        status: BRIDGE_STATUSES.REQUEST,
        tx_hash: null
      },
      {
        $set: {
          tx_hash,
          xck_address,
          status: BRIDGE_STATUSES.WAITING,
          updated_at: now
        }
      },
      {
        returnDocument: 'after'
      }
    );
  },

  async findActiveByXckAddress(
    xck_address,
    activeStatuses = ACTIVE_BRIDGE_STATUSES
  ) {
    return collection().findOne(
      {
        xck_address,
        status: { $in: activeStatuses }
      },
      {
        sort: { created_at: -1 }
      }
    );
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
          direction: 1,
          amount_atomic: 1,
          status: 1,
          evm_tx_hash: 1,
          error: 1,
          created_at: 1,
          updated_at: 1
        }
      }
    );
  },

  async findNextReadyRequest(cutoff) {
    return collection().findOne(
      {
        status: BRIDGE_STATUSES.WAITING,
        tx_hash: { $ne: null },
        created_at: { $lte: cutoff }
      },
      {
        sort: { created_at: 1 }
      }
    );
  },

  async markWaiting(_id, error = null) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: BRIDGE_STATUSES.WAITING,
          error,
          updated_at: now
        }
      }
    );
  },

  async markComplete(_id, evm_tx_hash) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: BRIDGE_STATUSES.COMPLETE,
          evm_tx_hash,
          error: null,
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
          status: BRIDGE_STATUSES.FAILED,
          error: error || 'Unknown error',
          updated_at: now
        }
      }
    );
  },

  async markCancelled(_id, error = null) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: BRIDGE_STATUSES.CANCELLED,
          error,
          updated_at: now
        }
      }
    );
  }
};