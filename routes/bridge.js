import express from 'express';

import { BridgeRequest } from '../models/bridge-request.js';
import {
  isValidTxHash,
  isValidEvmAddress,
  isValidNetwork,
  isValidAtomicAmount,
  isValidXckAddress,
  normalizeTxHash,
  normalizeEvmAddress,
  normalizeNetwork
} from '../utils/validation.js';

const router = express.Router();

router.post('/request', async (req, res) => {
  try {
    const tx_hash = normalizeTxHash(req.body.tx_hash);
    const evm_address = normalizeEvmAddress(req.body.evm_address);
    const network = normalizeNetwork(req.body.network);
    const xck_address = String(req.body.xck_address || '').trim();
    const amount_atomic = Number(req.body.amount_atomic);

    if (!isValidTxHash(tx_hash)) {
      return res.status(400).json({ ok: false, error: 'Invalid tx_hash' });
    }

    if (!isValidXckAddress(xck_address)) {
      return res.status(400).json({ ok: false, error: 'Invalid xck_address' });
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

    const request = await BridgeRequest.create({
      tx_hash,
      xck_address,
      evm_address,
      network,
      amount_atomic
    });

    return res.json({
      ok: true,
      status: request.status,
      tx_hash: request.tx_hash
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
      error: 'Internal server error'
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

export default router;