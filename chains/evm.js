import { ethers } from 'ethers';
import { config } from '../config.js';
import { logger } from '../utils/logger.js' 

const WXCK_ABI = [
  'event BridgeBurned(bytes32 indexed bridgeId, address indexed sender, uint256 amount, string xckAddress)',
  'function totalSupply() view returns (uint256)'
];

const wxckInterface = new ethers.Interface(WXCK_ABI);

const contractCache = new Map();

function normalizeNetwork(network) {
  return String(network || '').trim().toLowerCase();
}

export function getEvmConfig(network) {
  const normalizedNetwork = normalizeNetwork(network);

  if (normalizedNetwork === 'polygon') {
    return {
      network: normalizedNetwork,
      chainId: config.polygonChainId,
      rpcUrl: config.polygonRpcUrl,
      contractAddress: config.polygonWxckContractAddress
    };
  }

  if (normalizedNetwork === 'base') {
    return {
      network: normalizedNetwork,
      chainId: config.baseChainId,
      rpcUrl: config.baseRpcUrl,
      contractAddress: config.baseWxckContractAddress
    };
  }

  throw new Error(`Unsupported EVM network: ${normalizedNetwork || network}`);
}

function getWxckContract(network) {
  const normalizedNetwork = normalizeNetwork(network);

  if (!contractCache.has(normalizedNetwork)) {
    const evm = getEvmConfig(normalizedNetwork);

    if (!evm.rpcUrl) {
      throw new Error(`Missing RPC URL for network: ${normalizedNetwork}`);
    }

    if (!evm.contractAddress) {
      throw new Error(
        `Missing wXCK contract address for network: ${normalizedNetwork}`
      );
    }

    const provider = new ethers.JsonRpcProvider(
      evm.rpcUrl,
      Number(evm.chainId)
    );

    const contract = new ethers.Contract(
      ethers.getAddress(evm.contractAddress),
      WXCK_ABI,
      provider
    );

    contractCache.set(normalizedNetwork, contract);
  }

  return contractCache.get(normalizedNetwork);
}

export async function createEvmClaim(request) {
  try {
    if (request.direction !== 'XCK_TO_WXCK') {
      throw new Error(`Claims are only supported for XCK_TO_WXCK requests`);
    }

    const network = normalizeNetwork(request.network);
    const { chainId, contractAddress } = getEvmConfig(network);

    if (!contractAddress) {
      throw new Error(`Missing wXCK contract address for network: ${network}`);
    }

    if (!request.evm_address) {
      throw new Error('Missing EVM claim recipient address');
    }

    let bridgePrivateKey;

    switch (network) {
      case 'polygon':
        bridgePrivateKey = config.bridgePrivateKeyPolygon;
        break;

      case 'base':
        bridgePrivateKey = config.bridgePrivateKeyBase;
        break;

      default:
        throw new Error(`Unsupported network: ${network}`);
    }

    if (!bridgePrivateKey) {
      throw new Error(
        `Missing claim signer private key for network: ${network}`
      );
    }

    if (!/^0x[a-fA-F0-9]{64}$/.test(bridgePrivateKey)) {
      throw new Error(
        `Invalid claim signer private key for network: ${network}`
      );
    }

    const signerWallet = new ethers.Wallet(bridgePrivateKey);

    const bridgeId = ethers.keccak256(
      ethers.toUtf8Bytes(String(request._id))
    );

    const amount = BigInt(request.amount_atomic);
    if (amount <= 0n) {
      throw new Error('Claim amount must be greater than zero');
    }
    const deadline = Math.floor(Date.now() / 1000) + config.claimExpirationSeconds;

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
    logger.error(
      `Claim authorization failed for network=${request?.network || 'unknown'}: ` + `${err?.code || err?.name || 'unknown error'}`
    );

    return {
      ok: false,
      evm_tx_hash: null,
      claim: null,
      reason: 'Claim authorization failed'
    };
  }
}

export async function verifyBurnTransaction(request) {
  if (!request.evm_tx_hash) {
    return {
      ok: false,
      permanent: true,
      reason: 'Missing EVM transaction hash'
    };
  }
  const network = normalizeNetwork(request.network);
  const evm = getEvmConfig(network);

  if (!evm.rpcUrl) {
    throw new Error(`Missing RPC URL for network: ${network}`);
  }

  if (!evm.contractAddress) {
    throw new Error(`Missing wXCK contract address for network: ${network}`);
  }

  const provider = new ethers.JsonRpcProvider(
    evm.rpcUrl,
    Number(evm.chainId)
  );

  const wxckContractAddress = ethers
    .getAddress(evm.contractAddress)
    .toLowerCase();

  let receipt;

  try {
    receipt = await provider.getTransactionReceipt(request.evm_tx_hash);
  } catch (err) {
    return {
      ok: false,
      permanent: false,
      reason: `Unable to fetch burn transaction receipt: ${err.message}`
    };
  }

  if (!receipt) {
    return {
      ok: false,
      permanent: false,
      reason: 'Burn transaction receipt not found yet'
    };
  }

  if (receipt.status !== 1) {
    return {
      ok: false,
      permanent: true,
      reason: `Burn transaction failed on ${network}`
    };
  }

  // Do not require receipt.to to equal the wXCK contract.
  // Base delegated transactions may route through DelegationManager.
  // The BridgeBurned event below verifies that the configured
  // wXCK contract actually processed the burn

  let burnedEvent = null;

  for (const log of receipt.logs) {
    if (!log.address || log.address.toLowerCase() !== wxckContractAddress) {
      continue;
    }

    try {
      const parsed = wxckInterface.parseLog(log);

      if (parsed?.name === 'BridgeBurned') {
        burnedEvent = parsed;
        break;
      }
    } catch {
      // Ignore logs that are not from this interface.
    }
  }

  if (!burnedEvent) {
    return {
      ok: false,
      permanent: true,
      reason: 'BridgeBurned event not found'
    };
  }

  const bridgeId = burnedEvent.args.bridgeId;
  const burner = burnedEvent.args.sender.toLowerCase();
  const amount = burnedEvent.args.amount.toString();
  const xckAddress = burnedEvent.args.xckAddress;

  const expectedBridgeId = ethers.keccak256(
    ethers.toUtf8Bytes(request._id.toString())
  );

  if (bridgeId.toLowerCase() !== expectedBridgeId.toLowerCase()) {
    return {
      ok: false,
      permanent: true,
      reason: 'Burn bridgeId does not match bridge request'
    };
  }

  if (burner !== request.evm_address.toLowerCase()) {
    return {
      ok: false,
      permanent: true,
      reason: 'Burn sender does not match bridge request'
    };
  }

  if (amount !== request.amount_atomic.toString()) {
    return {
      ok: false,
      permanent: true,
      reason: 'Burn amount does not match bridge request'
    };
  }

  if (xckAddress !== request.xck_address) {
    return {
      ok: false,
      permanent: true,
      reason: 'Burn XCK address does not match bridge request'
    };
  }

  return {
    ok: true,
    permanent: false,
    reason: null
  };
}

export async function getWrappedSupply(network = 'polygon') {
  const normalizedNetwork = normalizeNetwork(network);
  const contract = getWxckContract(normalizedNetwork);

  return await contract.totalSupply();
}