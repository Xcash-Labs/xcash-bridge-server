import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { config } from './config.js';
import { connectDB, closeDB } from './db.js';
import { logger } from './utils/logger.js';
import bridgeRoutes from './routes/bridge.js';

import { BridgeRequest } from './models/bridge-request.js';
import { verifyXckTransaction } from './chains/xck.js';
import { mintOnEvm } from './chains/evm.js';

let shuttingDown = false;
let workerBusy = false;
let httpServer = null;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processBridgeRequest(request) {
  logger.info(`Processing bridge request ${request.tx_hash}`);

  const verification = await verifyXckTransaction(request);

  if (!verification.ok) {
    await BridgeRequest.markPending(
      request._id,
      verification.confirmations || 0,
      verification.reason || null
    );

    return;
  }

  if (verification.confirmations < config.minConfirmations) {
    await BridgeRequest.markPending(
      request._id,
      verification.confirmations,
      null
    );

    return;
  }

  await BridgeRequest.markMinting(request._id, verification.confirmations);

  const mint = await mintOnEvm(request);

  if (!mint.ok) {
    await BridgeRequest.markFailed(
      request._id,
      mint.reason || 'EVM minting failed'
    );

    return;
  }

  await BridgeRequest.markCompleted(request._id, mint.evm_tx_hash);
}

async function bridgeWorkerLoop() {
    logger.info('Bridge worker started');

    while (!shuttingDown) {
        try {
            const request = await BridgeRequest.lockNextPending();

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

  bridgeWorkerLoop();

  httpServer = app.listen(config.port, () => {
    logger.info(`XCash bridge server listening on port ${config.port}`);
  });
}

main().catch(err => {
  logger.error("Fatal startup error", err);
  process.exit(1);
});