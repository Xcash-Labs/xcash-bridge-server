import { getDB } from '../db.js';

const COLLECTION = 'bridge_requests';
const HISTORY_COLLECTION = 'bridge_requests_history';

function collection() {
  return getDB().collection(COLLECTION);
}

function historyCollection() {
  return getDB().collection(HISTORY_COLLECTION);
}

async function archiveRequest(id, finalUpdates = {}) {
  const now = new Date();

  const request = await collection().findOne({ _id: id });

  if (!request) {
    return null;
  }

  const historyDoc = {
    ...request,
    ...finalUpdates,
    archived_at: now
  };

  await historyCollection().insertOne(historyDoc);

  await collection().deleteOne({ _id: id });

  return historyDoc;
}

export const BRIDGE_STATUSES = {
  REQUEST: 'request',
  WAITING: 'waiting',
  CONFIRMED: 'confirmed',
  READY_TO_CLAIM: 'ready_to_claim',
  COMPLETE: 'complete',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

export const ACTIVE_BRIDGE_STATUSES = [
  BRIDGE_STATUSES.REQUEST,
  BRIDGE_STATUSES.WAITING,
  BRIDGE_STATUSES.CONFIRMED,
  BRIDGE_STATUSES.READY_TO_CLAIM
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

  async attachEvmTxHash({
    bridge_id,
    evm_tx_hash,
    xck_address
  }) {
    const now = new Date();
    const { ObjectId } = await import('mongodb');

    return collection().findOneAndUpdate(
      {
        _id: new ObjectId(bridge_id),
        status: BRIDGE_STATUSES.REQUEST,
        evm_tx_hash: null
      },
      {
        $set: {
          evm_tx_hash,
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

  async findNextReadyRequest({ xckToWxckCutoff, wxckToXckCutoff }) {
    return collection().findOne(
      {
        status: BRIDGE_STATUSES.WAITING,
        $or: [
          {
            direction: 'XCK_TO_WXCK',
            tx_hash: { $ne: null },
            updated_at: { $lte: xckToWxckCutoff }
          },
          {
            direction: 'WXCK_TO_XCK',
            evm_tx_hash: { $ne: null },
            updated_at: { $lte: wxckToXckCutoff }
          }
        ]
      },
      {
        sort: { updated_at: 1 }
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

  async markConfirmed(_id, error = null) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: BRIDGE_STATUSES.CONFIRMED,
          error,
          updated_at: now
        }
      }
    );
  },

  async markReadyToClaim(_id, error = null) {
    const now = new Date();

    return collection().updateOne(
      { _id },
      {
        $set: {
          status: BRIDGE_STATUSES.READY_TO_CLAIM,
          error,
          updated_at: now
        }
      }
    );
  },

  async markComplete(id, evm_tx_hash) {
    const now = new Date();

    return archiveRequest(id, {
      status: BRIDGE_STATUSES.COMPLETE,
      evm_tx_hash,
      error: null,
      updated_at: now
    });
  },

  async markFailed(id, error) {
    const now = new Date();

    return archiveRequest(id, {
      status: BRIDGE_STATUSES.FAILED,
      error,
      updated_at: now
    });
  },

  async markCancelled(id, error = 'Bridge request was cancelled') {
    const now = new Date();

    return archiveRequest(id, {
      status: BRIDGE_STATUSES.CANCELLED,
      error,
      updated_at: now
    });
  },

  async findRequestsByXckAddress(xck_address, days = 30) {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    const projection = {
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
      updated_at: 1,
      archived_at: 1
    };

    const activeRequests = await collection()
      .find(
        {
          xck_address,
          created_at: { $gte: cutoff }
        },
        { projection }
      )
      .toArray();

    const historyRequests = await historyCollection()
      .find(
        {
          xck_address,
          created_at: { $gte: cutoff }
        },
        { projection }
      )
      .toArray();

    return [...activeRequests, ...historyRequests].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );
  },

  async findById(_id) {
    return collection().findOne({ _id });
  },

};
