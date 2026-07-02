import express from 'express';

import { BridgeRequest } from '../models/bridge-request.js';
import { ACTIVE_BRIDGE_STATUSES } from '../models/bridgeRequest.js';

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

export default router;