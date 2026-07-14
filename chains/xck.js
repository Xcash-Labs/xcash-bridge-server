import { config } from '../config.js';

function getWalletRpcConfig(network) {
  switch (String(network || '').toLowerCase()) {
    case 'polygon':
      return {
        host: config.walletRpcHost,
        port: config.walletRpcPortPolygon
      };

    case 'base':
      return {
        host: config.walletRpcHost,
        port: config.walletRpcPortBase
      };

    default:
      throw new Error(`Unsupported network: ${network}`);
  }
}

async function walletRpc(network, method, params = {}) {
  const rpc = getWalletRpcConfig(network);

  const url = `http://${rpc.host}:${rpc.port}/json_rpc`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: '0',
      method,
      params
    })
  });

  if (!response.ok) {
    throw new Error(
      `Wallet RPC ${network} on port ${rpc.port} returned HTTP ` +
      `${response.status}: ${response.statusText}`
    );
  }

  const json = await response.json();

  if (json.error) {
    const err = new Error(json.error.message);
    err.code = json.error.code;
    throw err;
  }

  return json.result;
}

export async function getTransferByTxId(network, txid) {
  return walletRpc(network, 'get_transfer_by_txid', {
    txid
  });
}

export async function verifyXckTransaction(request) {
  try {
    const result = await getTransferByTxId(
      request.network,
      request.tx_hash
    );

    if (!result || !result.transfer) {
      return {
        ok: false,
        permanent: false,
        reason: 'Transaction not found yet'
      };
    }

    const transfer = result.transfer;

    if (transfer.type !== 'in') {
      return {
        ok: false,
        permanent: true,
        reason: 'Transaction is not an incoming transfer'
      };
    }

    if (transfer.locked) {
      return {
        ok: false,
        permanent: false,
        reason: 'Transaction is still locked'
      };
    }

    if (transfer.double_spend_seen) {
      return {
        ok: false,
        permanent: true,
        reason: 'Double spend detected'
      };
    }

    if (BigInt(transfer.amount) !== BigInt(request.amount_atomic)) {
      return {
        ok: false,
        permanent: true,
        reason: 'Deposit amount does not match bridge request'
      };
    }

    return {
      ok: true
    };

  } catch (err) {
    return {
      ok: false,
      permanent: false,
      reason: err.message
    };
  }
}

export async function sendXckFromBridgeWallet({
  network,
  address,
  amount_atomic
}) {
  const amount = BigInt(amount_atomic);

  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error('Invalid or unsupported XCK payout amount');
  }

  const result = await walletRpc(network, 'transfer_split', {
    destinations: [
      {
        address,
        amount: Number(amount)
      }
    ],
    account_index: 0,
    subaddr_indices: [],
    subtract_fee_from_outputs: [0],
    priority: 0,
    tx_privacy_settings: 'private',
    unlock_time: 0,
    get_tx_key: true,
    do_not_relay: false,
    get_tx_hex: false,
    get_tx_metadata: false
  });

  return {
    tx_hash: Array.isArray(result.tx_hash_list)
      ? result.tx_hash_list[0]
      : result.tx_hash,
    tx_hash_list: result.tx_hash_list || [],
    tx_key_list: result.tx_key_list || []
  };
}

export async function getBridgeWalletBalance(network) {
  try {
    const result = await walletRpc(network, 'get_balance', {
      account_index: 0
    });

    if (
      result.balance === undefined ||
      result.unlocked_balance === undefined
    ) {
      throw new Error('Wallet RPC returned an invalid balance response');
    }

    return {
      balance: BigInt(result.balance),
      unlocked_balance: BigInt(result.unlocked_balance)
    };
  } catch (err) {
    throw new Error(
      `Unable to get ${network} bridge wallet balance: ${err.message}`
    );
  }
}