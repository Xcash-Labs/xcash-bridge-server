import express from 'express';
import { BridgeRequest, ACTIVE_BRIDGE_STATUSES, BRIDGE_STATUSES } from '../models/bridge-request.js';
import { createEvmClaim } from '../chains/evm.js';
import { ObjectId } from 'mongodb';
import {
  isValidTxHash,
  isValidEvmAddress,
  isValidNetwork,
  isValidAtomicAmount,
  isValidXckAddress,
  normalizeTxHash,
  normalizeEvmAddress,
  normalizeXckAddress,
  normalizeNetwork
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
    const tx_hash = normalizeTxHash(req.body.tx_hash);
    const xck_address = String(req.body.xck_address || '').trim();

    if (!ObjectId.isValid(bridge_id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid bridge_id'
      });
    }

    if (!isValidTxHash(tx_hash)) {
      return res.status(400).json({ ok: false, error: 'Invalid tx_hash' });
    }

    if (!isValidXckAddress(xck_address)) {
      return res.status(400).json({ ok: false, error: 'Invalid xck_address' });
    }

    const request = await BridgeRequest.attachTxHash({
      bridge_id,
      tx_hash,
      xck_address
    });

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
    return res.status(500).json({ ok: false, error: 'Internal server error' });
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

router.post('/request/:bridge_id/complete', async (req, res) => {
  try {
    const bridge_id = req.params.bridge_id;
    const evm_tx_hash = normalizeTxHash(req.body.evm_tx_hash);

    if (!ObjectId.isValid(bridge_id)) {
      return res.status(400).json({
        ok: false,
        error: 'Invalid bridge_id'
      });
    }

    const evm_tx_hash = normalizeEvmTxHash(req.body.evm_tx_hash);

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

    await BridgeRequest.markComplete(request._id, evm_tx_hash);

    return res.json({
      ok: true,
      status: BRIDGE_STATUSES.COMPLETE,
      evm_tx_hash
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({
      ok: false,
      error: 'Internal server error'
    });
  }
});

export default router;