import { config } from '../config.js';

async function walletRpc(method, params = {}) {
  const url = `http://${config.walletRpcHost}:${config.walletRpcPort}/json_rpc`;

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
      `Wallet RPC HTTP ${response.status}: ${response.statusText}`
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

export async function getTransferByTxId(txid) {
  return walletRpc('get_transfer_by_txid', {
    txid
  });
}

export async function verifyXckTransaction(request) {
  try {

    const result = await getTransferByTxId(request.tx_hash);

    if (!result || !result.transfer) {
      return {
        ok: false,
        permanent: false,
        reason: 'Transaction not found yet'
      };
    }

    const transfer = result.transfer;

    // Should be an incoming transfer.
    if (transfer.type !== 'in') {
      return {
        ok: false,
        permanent: true,
        reason: 'Transaction is not an incoming transfer'
      };
    }

    // Deposit must be unlocked before bridging.
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

    // Verify amount.
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