import { ethers } from 'ethers';
import { config } from '../config.js';

function getEvmConfig(network) {
  if (network === 'polygon') {
    return {
      chainId: config.polygonChainId,
      contractAddress: config.polygonWxckContractAddress
    };
  }

  if (network === 'base') {
    return {
      chainId: config.baseChainId,
      contractAddress: config.baseWxckContractAddress
    };
  }

  throw new Error(`Unsupported EVM network: ${network}`);
}

export async function createEvmClaim(request) {
  try {
    if (request.direction !== 'XCK_TO_WXCK') {
      throw new Error(`Claims are only supported for XCK_TO_WXCK requests`);
    }

    const network = String(request.network || '').toLowerCase();
    const { chainId, contractAddress } = getEvmConfig(network);

    if (!contractAddress) {
      throw new Error(`Missing wXCK contract address for network: ${network}`);
    }

    if (!config.bridgePrivateKey) {
      throw new Error('Missing claim signer private key');
    }

    if (!request.evm_address) {
      throw new Error('Missing EVM claim recipient address');
    }

    const signerWallet = new ethers.Wallet(config.bridgePrivateKey);

    const bridgeId = ethers.keccak256(
      ethers.toUtf8Bytes(String(request._id))
    );

    const amount = BigInt(request.amount_atomic);
    if (amount <= 0n) {
      throw new Error('Claim amount must be greater than zero');
    }
    const deadline = Math.floor(Date.now() / 1000) + config.claimExpirationSeconds;

    console.log('Creating EVM claim with fields:', {
      chainId: BigInt(chainId).toString(),
      contractAddress,
      bridgeId,
      recipient: request.evm_address,
      amount: amount.toString(),
      deadline,
      now: Math.floor(Date.now() / 1000),
      signerAddress: signerWallet.address
    });

    const chainIdBN = BigInt(chainId);
    const contract = ethers.getAddress(contractAddress);
    const recipient = ethers.getAddress(request.evm_address);
    const amountBN = BigInt(amount);
    const deadlineBN = BigInt(deadline);

    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        ['uint256', 'address', 'bytes32', 'address', 'uint256', 'uint256'],
        [
          chainIdBN,
          contract,
          bridgeId,
          recipient,
          amountBN,
          deadlineBN
        ]
      )
    );

    const signature = await signerWallet.signMessage(ethers.getBytes(digest));

console.log('Claim signature check:', {
  signerWallet: signerWallet.address,
  recovered,
  matches: recovered.toLowerCase() === signerWallet.address.toLowerCase(),
  digest,
  signature
});

    return {
      ok: true,
      evm_tx_hash: null,
      claim: {
        bridgeId,
        recipient,
        amount: amount.toString(),
        deadline: deadline.toString(),
        expires_in: config.claimExpirationSeconds,
        signature,
        contractAddress: contract,
        chainId: chainId.toString()
      },
      reason: null
    };
  } catch (err) {
    return {
      ok: false,
      evm_tx_hash: null,
      claim: null,
      reason: err.message || 'Claim authorization failed'
    };
  }
}