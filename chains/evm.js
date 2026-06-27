export async function mintOnEvm(request) {
  /*
    TODO:
    Later this should use ethers.js.

    Required steps:
    1. Select RPC URL based on request.network
    2. Load bridge wallet private key from .env
    3. Load wrapped XCK contract address
    4. Call mint/release function on the contract
    5. Wait for confirmation
    6. Return EVM transaction hash
  */

  return {
    ok: false,
    evm_tx_hash: null,
    reason: 'EVM minting not implemented yet'
  };
}