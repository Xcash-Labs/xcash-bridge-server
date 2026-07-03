import { ethers } from 'ethers';
import { config } from '../config.js';

const WXCK_ABI = [
  'function mint(address to, uint256 amount) external returns (bool)'
];

function getEvmConfig(network) {
  if (network === 'polygon') {
    return {
      rpcUrl: config.polygonRpcUrl,
      contractAddress: config.polygonWxckAddress
    };
  }

  if (network === 'base') {
    return {
      rpcUrl: config.baseRpcUrl,
      contractAddress: config.baseWxckAddress
    };
  }

  throw new Error(`Unsupported EVM network: ${network}`);
}

export async function mintOnEvm(request) {
  try {
    const { rpcUrl, contractAddress } = getEvmConfig(request.network);

    if (!rpcUrl) {
      throw new Error(`Missing RPC URL for network: ${request.network}`);
    }

    if (!contractAddress) {
      throw new Error(`Missing WXCK contract address for network: ${request.network}`);
    }

    if (!config.bridgePrivateKey) {
      throw new Error('Missing bridge wallet private key');
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(config.bridgePrivateKey, provider);

    const contract = new ethers.Contract(
      contractAddress,
      WXCK_ABI,
      wallet
    );

    const tx = await contract.mint(
      request.evm_address,
      BigInt(request.amount_atomic)
    );

    const receipt = await tx.wait();

    if (!receipt || receipt.status !== 1) {
      return {
        ok: false,
        evm_tx_hash: tx.hash,
        reason: 'EVM mint transaction failed'
      };
    }

    return {
      ok: true,
      evm_tx_hash: tx.hash,
      reason: null
    };
  } catch (err) {
    return {
      ok: false,
      evm_tx_hash: null,
      reason: err.message || 'EVM minting failed'
    };
  }
}