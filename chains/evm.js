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

    const digest = ethers.keccak256(
      ethers.AbiCoder.defaultAbiCoder().encode(
        [
          'uint256',
          'address',
          'bytes32',
          'address',
          'uint256',
          'uint256'
        ],
        [
          BigInt(chainId),
          contractAddress,
          bridgeId,
          request.evm_address,
          amount,
          deadline
        ]
      )
    );

    const signature = await signerWallet.signMessage(
      ethers.getBytes(digest)
    );

    return {
      ok: true,
      evm_tx_hash: null,
      claim: {
        bridgeId,
        amount: amount.toString(),
        deadline,
        expires_in: config.claimExpirationSeconds,
        signature,
        contractAddress,
        chainId
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