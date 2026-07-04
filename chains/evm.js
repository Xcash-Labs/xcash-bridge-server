import { ethers } from 'ethers';
import { config } from '../config.js';

function getEvmConfig(network) {
  if (network === 'polygon') {
    return {
      chainId: 80002,
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

export async function mintOnEvm(request) {
  try {
    const { chainId, contractAddress } = getEvmConfig(request.network);

    if (!contractAddress) {
      throw new Error(`Missing wXCK contract address for network: ${request.network}`);
    }

    if (!config.bridgePrivateKey) {
      throw new Error('Missing claim signer private key');
    }

    const signerWallet = new ethers.Wallet(config.bridgePrivateKey);

    const bridgeId = ethers.keccak256(
      ethers.toUtf8Bytes(String(request._id))
    );

    const amount = BigInt(request.amount_atomic);

    const deadline = Math.floor(Date.now() / 1000) + 60 * 60; // 1 hour

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
          chainId,
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