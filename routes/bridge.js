import express from 'express';
import { BridgeRequest, ACTIVE_BRIDGE_STATUSES, BRIDGE_STATUSES } from '../models/bridge-request.js';
import { createEvmClaim, getEvmConfig } from '../chains/evm.js';
import { ObjectId } from 'mongodb';
import { ethers } from 'ethers';
import { logger } from '../util/logger.js';
import {
  isValidTxHash,
  isValidEvmAddress,
  isValidNetwork,
  isValidAtomicAmount,
  isValidXckAddress,
  normalizeTxHash,
  normalizeEvmAddress,
  normalizeXckAddress,
  normalizeNetwork,
  normalizeEvmTxHash,
  isValidEvmTxHash
} from '../utils/validation.js';

const router = express.Router();

router.get('/active', async (req, res) => {
  try {
    const xck_address = normalizeXckAddress(req.query.xck_address);

    if (!isValidXckAddress(xck_address)) {
      return res.status(400).json({
        ok: false,
        error: 'Only XCK primary addresses are supported'
      });
    }

    const request = await BridgeRequest.findActiveByXckAddress(xck_address);

    return res.json({
      ok: true,
      has_active_request: !!request,
      request
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

router.post('/request', async (req, res) => {
  try {
    const xck_address = normalizeXckAddress(req.body.xck_address);
    const evm_address = normalizeEvmAddress(req.body.evm_address);
    const network = normalizeNetwork(req.body.network);
    const amount_atomic = String(req.body.amount_atomic || '').trim();
    const direction = String(req.body.direction || '').trim();

    if (!isValidXckAddress(xck_address)) {
      return res.status(400).json({ ok: false, error: 'Only XCK primary addresses are supported' });
    }

    if (!isValidEvmAddress(evm_address)) {
      return res.status(400).json({ ok: false, error: 'Invalid evm_address' });
    }

    if (!isValidNetwork(network)) {
      return res.status(400).json({ ok: false, error: 'Unsupported network' });
    }

    if (!isValidAtomicAmount(amount_atomic)) {
      return res.status(400).json({ ok: false, error: 'Invalid amount_atomic' });
    }

    const activeRequest = await BridgeRequest.findActiveByXckAddress(
      xck_address,
      ACTIVE_BRIDGE_STATUSES
    );

    if (activeRequest) {
      return res.status(409).json({
        ok: false,
        error: 'You already have a bridge request in progress',
        request: activeRequest
      });
    }

    const request = await BridgeRequest.create({
      xck_address,
      evm_address,
      network,
      direction,
      amount_atomic
    });

    return res.json({
      ok: true,
      bridge_id: request._id,
      status: request.status
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});

router.post('/request/:bridge_id/tx', async (req, res) => {
  try {
    const bridge_id = req.params.bridge_id;
    const raw_tx_hash = String(req.body.tx_hash || '').trim();
    const xck_address = String(req.body.xck_address || '').trim();

    if (!ObjectId.isValid(bridge_id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid bridge_id'
      });
    }

    if (!isValidXckAddress(xck_address)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid xck_address'
      });
    }

    const existingRequest = await BridgeRequest.findById(
      new ObjectId(bridge_id)
    );

    if (!existingRequest) {
      return res.status(404).json({
        ok: false,
        error: 'Bridge request not found'
      });
    }

    let tx_hash;
    let request;

    if (existingRequest.direction === 'WXCK_TO_XCK') {
      tx_hash = normalizeEvmTxHash(raw_tx_hash);

      if (!isValidEvmTxHash(tx_hash)) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid EVM tx_hash'
        });
      }

      request = await BridgeRequest.attachEvmTxHash({
        bridge_id,
        evm_tx_hash: tx_hash,
        xck_address
      });

    } else {
      tx_hash = normalizeTxHash(raw_tx_hash);

      if (!isValidTxHash(tx_hash)) {
        return res.status(400).json({
          ok: false,
          error: 'Invalid XCK tx_hash'
        });
      }

      request = await BridgeRequest.attachTxHash({
        bridge_id,
        tx_hash,
        xck_address
      });
    }

    return res.json({
      ok: true,
      bridge_id: request._id
    });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        ok: false,
        error: 'Bridge request already exists for this transaction'
      });
    }

    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Internal server error'
    });
  }
});

router.get('/status/:tx_hash', async (req, res) => {
  try {
    const tx_hash = normalizeTxHash(req.params.tx_hash);

    if (!isValidTxHash(tx_hash)) {
      return res.status(400).json({ ok: false, error: 'Invalid tx_hash' });
    }

    const request = await BridgeRequest.findByTxHash(tx_hash);

    if (!request) {
      return res.status(404).json({
        ok: false,
        error: 'Bridge request not found'
      });
    }

    return res.json({
      ok: true,
      request
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

router.get('/requests', async (req, res) => {
  try {
    const xck_address = normalizeXckAddress(req.query.xck_address);

    if (!isValidXckAddress(xck_address)) {
      return res.status(400).json({
        ok: false,
        error: 'Only XCK primary addresses are supported'
      });
    }

    const days = Number(req.query.days || 30);

    const requests = await BridgeRequest.findRequestsByXckAddress(
      xck_address,
      days
    );

    return res.json({
      ok: true,
      requests
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

router.post('/request/:bridge_id/claim', async (req, res) => {
  try {
    const bridge_id = req.params.bridge_id;

    if (!ObjectId.isValid(bridge_id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid bridge_id'
      });
    }

    const request = await BridgeRequest.findById(new ObjectId(bridge_id));

    if (!request) {
      return res.status(404).json({
        ok: false,
        error: 'Bridge request not found'
      });
    }

    if (request.status !== BRIDGE_STATUSES.READY_TO_CLAIM) {
      return res.status(409).json({
        ok: false,
        error: 'Bridge request is not ready to claim'
      });
    }

    const result = await createEvmClaim(request);

    if (!result.ok) {
      return res.status(500).json({
        ok: false,
        error: result.reason || 'Unable to create claim'
      });
    }

    return res.json({
      ok: true,
      claim: result.claim
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

async function verifyClaimTransaction(request, evm_tx_hash) {
  const network = normalizeNetwork(request.network);

  const {
    chainId,
    rpcUrl,
    contractAddress
  } = getEvmConfig(network);

  if (!rpcUrl) {
    throw new Error(`Missing RPC URL for ${network}`);
  }

  if (!contractAddress) {
    throw new Error(
      `Missing wXCK contract address for ${network}`
    );
  }

  const provider = new ethers.JsonRpcProvider(
    rpcUrl,
    Number(chainId)
  );

//  const receipt = await provider.getTransactionReceipt(
//    evm_tx_hash
//  );

//  if (!receipt) {
//    throw new Error('Claim transaction not found');
//  }




if (!/^0x[a-fA-F0-9]{64}$/.test(evm_tx_hash)) {
  throw new Error('Invalid claim transaction hash');
}

logger.info(
  `Waiting for claim transaction: ` +
  `network=${network} ` +
  `tx_hash=${evm_tx_hash}`
);

const receipt = await provider.waitForTransaction(
  evm_tx_hash,
  1,       // Wait for 1 confirmation
  30000    // Wait up to 30 seconds
);

if (!receipt) {
  throw new Error(
    'Claim transaction receipt was not available within 30 seconds'
  );
}





  if (receipt.status !== 1) {
    throw new Error('Claim transaction failed');
  }

  /*
   * Do not require receipt.to to equal the wXCK contract.
   *
   * MetaMask delegated-account transactions may send the
   * top-level transaction to DelegationManager, which then
   * calls the wXCK contract internally.
   *
   * Instead, verify that the configured wXCK contract emitted
   * the expected BridgeClaimed event.
   */
  const expectedContractAddress =
    contractAddress.toLowerCase();

  const iface = new ethers.Interface([
    'event BridgeClaimed(bytes32 indexed bridgeId, address indexed recipient, uint256 amount, uint256 deadline)'
  ]);

  let claimEvent = null;

  for (const log of receipt.logs) {
    if (
      !log.address ||
      log.address.toLowerCase() !== expectedContractAddress
    ) {
      continue;
    }

    try {
      const parsed = iface.parseLog(log);

      if (parsed?.name === 'BridgeClaimed') {
        claimEvent = parsed.args;
        break;
      }
    } catch {
      // Ignore unrelated logs emitted by the wXCK contract.
    }
  }

  if (!claimEvent) {
    throw new Error(
      'BridgeClaimed event from the configured wXCK contract was not found'
    );
  }

  const expectedBridgeId = ethers.keccak256(
    ethers.toUtf8Bytes(String(request._id))
  );

  if (
    claimEvent.bridgeId.toLowerCase() !==
    expectedBridgeId.toLowerCase()
  ) {
    throw new Error(
      'Claim bridgeId does not match bridge request'
    );
  }

  if (
    claimEvent.recipient.toLowerCase() !==
    request.evm_address.toLowerCase()
  ) {
    throw new Error(
      'Claim recipient does not match bridge request'
    );
  }

  if (
    claimEvent.amount.toString() !==
    String(request.amount_atomic)
  ) {
    throw new Error(
      'Claim amount does not match bridge request'
    );
  }

  return {
    bridgeId: claimEvent.bridgeId,
    recipient: claimEvent.recipient,
    amount: claimEvent.amount.toString(),
    deadline: claimEvent.deadline.toString()
  };
}

router.post('/request/:bridge_id/complete', async (req, res) => {
  try {
    const bridge_id = req.params.bridge_id;
    const evm_tx_hash = normalizeEvmTxHash(req.body.evm_tx_hash);

    if (!ObjectId.isValid(bridge_id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid bridge_id'
      });
    }

    if (!isValidEvmTxHash(evm_tx_hash)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid evm_tx_hash'
      });
    }

    const request = await BridgeRequest.findById(new ObjectId(bridge_id));

    if (!request) {
      return res.status(404).json({
        ok: false,
        error: 'Bridge request not found'
      });
    }

    if (request.status !== BRIDGE_STATUSES.READY_TO_CLAIM) {
      return res.status(409).json({
        ok: false,
        error: 'Bridge request is not ready to complete'
      });
    }

    const verifiedClaim = await verifyClaimTransaction(request, evm_tx_hash);

    await BridgeRequest.markComplete(request._id, { evm_tx_hash });

    return res.json({
      ok: true,
      status: BRIDGE_STATUSES.COMPLETE,
      evm_tx_hash,
      claim: verifiedClaim
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Internal server error'
    });
  }
});

router.post('/request/:bridge_id/cancel', async (req, res) => {
  try {
    const bridge_id = req.params.bridge_id;

    if (!ObjectId.isValid(bridge_id)) {
      return res.status(400).json({ ok: false, error: 'Invalid bridge_id' });
    }

    const request = await BridgeRequest.findById(new ObjectId(bridge_id));

    if (!request) {
      return res.status(404).json({ ok: false, error: 'Bridge request not found' });
    }

    await BridgeRequest.markCancelled(
      request._id,
      req.body.error || 'Bridge request was cancelled'
    );

    return res.json({
      ok: true,
      status: BRIDGE_STATUSES.CANCELLED
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Internal server error'
    });
  }
});

router.post('/request/:bridge_id/failed', async (req, res) => {
  try {
    const bridge_id = req.params.bridge_id;

    if (!ObjectId.isValid(bridge_id)) {
      return res.status(400).json({ ok: false, error: 'Invalid bridge_id' });
    }

    const request = await BridgeRequest.findById(new ObjectId(bridge_id));

    if (!request) {
      return res.status(404).json({ ok: false, error: 'Bridge request not found' });
    }

    await BridgeRequest.markFailed(
      request._id,
      req.body.error || 'Bridge request failed'
    );

    return res.json({
      ok: true,
      status: BRIDGE_STATUSES.FAILED
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: err.message || 'Internal server error'
    });
  }
});

export default router;