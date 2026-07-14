import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import { connectDB, closeDB } from './db.js';
import { logger } from './utils/logger.js';
import bridgeRoutes from './routes/bridge.js';

import { BridgeRequest } from './models/bridge-request.js';
import { verifyXckTransaction, sendXckFromBridgeWallet, getBridgeWalletBalance } from './chains/xck.js';
import { verifyBurnTransaction, getWrappedSupply } from './chains/evm.js';

let shuttingDown = false;
let workerBusy = false;
let httpServer = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isBridgeRequestExpired(request) {
  return Date.now() - request.created_at.getTime() >
    config.requestTimeoutMinutes * 60 * 1000;
}

async function processXckToWxck(request) {
  const verification = await verifyXckTransaction(request);

  if (!verification.ok) {
    const expired = isBridgeRequestExpired(request);

    logger.info(
      `Bridge request ${request.tx_hash} not ready: ${verification.reason || 'unknown reason'}`
    );

    if (verification.permanent || expired) {
      await BridgeRequest.markFailed(
        request._id,
        expired
          ? `Bridge request expired: ${verification.reason || 'transaction was not verified in time'}`
          : verification.reason || 'XCK transaction verification failed'
      );
    }

    return;
  }

  await BridgeRequest.markConfirmed(request._id);
  await BridgeRequest.markReadyToClaim(request._id);
}

async function processWxckToXck(request) {
  logger.info(
    `Processing WXCK_TO_XCK burn ${request.evm_tx_hash} network=${request.network}`
  );

  const verification = await verifyBurnTransaction(request);

  if (!verification.ok) {
    const expired = isBridgeRequestExpired(request);

    logger.info(
      `Bridge request ${request.evm_tx_hash} not ready: ${verification.reason || 'unknown reason'
      }`
    );

    if (verification.permanent || expired) {
      await BridgeRequest.markFailed(
        request._id,
        expired
          ? `Bridge request expired: ${verification.reason ||
          'burn transaction was not verified in time'
          }`
          : verification.reason ||
          'wXCK burn verification failed'
      );
    }

    return;
  }

  await BridgeRequest.markConfirmed(request._id);

  const backing = await auditBridgeBacking(request.network);

  if (!backing.ok) {
    const message =
      `CRITICAL: Bridge backing audit failed for ${request.network}. ` +
      `Deficit: ${backing.deficit_atomic} atomic XCK`;
    logger.error(message);
    await BridgeRequest.markFailed(request._id, message);
    process.exit(1);
  }

  const payout = await sendXckFromBridgeWallet({
    network: request.network,
    address: request.xck_address,
    amount_atomic: request.amount_atomic
  });

  await BridgeRequest.markComplete(request._id, {
    tx_hash: payout.tx_hash
  });
}

export async function auditBridgeBacking(network) {
  const normalizedNetwork = String(network || '').toLowerCase();

  if (!['polygon', 'base'].includes(normalizedNetwork)) {
    throw new Error(`Unsupported bridge network: ${network}`);
  }

  const wxckSupplyAtomic = await getWrappedSupply(normalizedNetwork);
  const wallet = await getBridgeWalletBalance(normalizedNetwork);

  const ok = wallet.balance >= wxckSupplyAtomic;

  if (ok) {
    logger.info(
      `Bridge backing audit Succeeded: ` +
      `network=${normalizedNetwork} ` +
      `balance=${wallet.balance} ` +
      `required=${wxckSupplyAtomic} ` +
      `deficit=${wxckSupplyAtomic - wallet.balance}`
    );
  }

  if (!ok) {
    logger.error(
      `Bridge backing audit FAILED: ` +
      `network=${normalizedNetwork} ` +
      `balance=${wallet.balance} ` +
      `required=${wxckSupplyAtomic} ` +
      `deficit=${wxckSupplyAtomic - wallet.balance}`
    );
  }

  return {
    network: normalizedNetwork,
    ok,
    wxck_supply_atomic: wxckSupplyAtomic.toString(),
    xck_bridge_balance_atomic: wallet.balance.toString(),
    xck_unlocked_balance_atomic: wallet.unlocked_balance.toString(),
    deficit_atomic: ok
      ? '0'
      : (wxckSupplyAtomic - wallet.balance).toString()
  };
}

async function processBridgeRequest(request) {
  logger.info(`Processing bridge request ${request._id} direction=${request.direction}`);

  if (request.direction === 'XCK_TO_WXCK') {
    return processXckToWxck(request);
  }

  if (request.direction === 'WXCK_TO_XCK') {
    return processWxckToXck(request);
  }

  await BridgeRequest.markFailed(
    request._id,
    `Unknown bridge direction: ${request.direction}`
  );
}

async function bridgeWorkerLoop() {
  logger.info('Bridge worker started');

  while (!shuttingDown) {
    try {
      const xckToWxckCutoff = new Date(
        Date.now() - config.xckToWxckDelayMinutes * 60 * 1000
      );

      const wxckToXckCutoff = new Date(
        Date.now() - config.wxckToXckDelayMinutes * 60 * 1000
      );

      const request = await BridgeRequest.findNextReadyRequest({
        xckToWxckCutoff,
        wxckToXckCutoff
      });

      if (request) {
        workerBusy = true;

        try {
          await processBridgeRequest(request);
        } finally {
          workerBusy = false;
        }
      }
    } catch (err) {
      workerBusy = false;
      logger.error('Bridge worker error', err);
    }

    await sleep(config.workerIntervalMs);
  }

  logger.info('Bridge worker stopped');
}

async function gracefulShutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;

  logger.warn(`Received ${signal}, shutting down`);

  if (httpServer) {
    httpServer.close(() => {
      logger.info('HTTP server closed');
    });
  }

  while (workerBusy) {
    logger.info('Waiting for bridge worker to finish current job');
    await sleep(1000);
  }

  await closeDB();

  logger.info('Shutdown complete');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

const app = express();
app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '32kb' }));

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60
}));

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'xcash-bridge-server'
  });
});

app.use('/api/bridge', bridgeRoutes);

async function main() {
  await connectDB();

  bridgeWorkerLoop().catch(err => {
    logger.error('Bridge worker crashed', err);
    process.exit(1);
  });

  httpServer = app.listen(config.port, () => {
    logger.info(`XCash bridge server listening on port ${config.port}`);
  });
}

main().catch(err => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});