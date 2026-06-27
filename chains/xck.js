import { config } from '../config.js';

export async function verifyXckTransaction(request) {
  /*
    TODO:
    Later this should call xcash-wallet-rpc or xcashd.

    Required checks:
    1. tx_hash exists on XCK chain
    2. tx was sent to config.bridgeXckAddress
    3. amount matches request.amount_atomic
    4. transaction is public
    5. sender matches request.xck_address, if available
    6. confirmations >= config.minConfirmations
  */

  return {
    ok: false,
    confirmations: 0,
    reason: 'XCK transaction verification not implemented yet',
    bridge_address: config.bridgeXckAddress
  };
}