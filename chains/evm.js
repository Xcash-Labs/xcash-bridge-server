import { ethers } from 'ethers';
import { config } from '../config.js';

const WXCK_ABI = [
  'event BridgeBurned(bytes32 indexed bridgeId, address indexed sender, uint256 amount, string xckAddress)',
  'function totalSupply() view returns (uint256)'
];

const wxckInterface = new ethers.Interface(WXCK_ABI);

const contractCache = new Map();

function getEvmConfig(network) {
  if (network === 'polygon') {
    return {
      chainId: config.polygonChainId,
      rpcUrl: config.polygonRpcUrl,
      contractAddress: config.polygonWxckContractAddress,
    };
  }

  if (network === 'base') {
    return {
      chainId: config.baseChainId,
      rpcUrl: config.baseRpcUrl,
      contractAddress: config.baseWxckContractAddress
    };
  }

  throw new Error(`Unsupported EVM network: ${network}`);
}

function getWxckContract(network) {
  if (!contractCache.has(network)) {
    const evm = getEvmConfig(network);

    const provider = new ethers.JsonRpcProvider(evm.rpcUrl);

    const contract = new ethers.Contract(
      evm.contractAddress,
      WXCK_ABI,
      provider
    );

    contractCache.set(network, contract);
  }

  return contractCache.get(network);
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
    return {
      ok: false,
      evm_tx_hash: null,
      claim: null,
      reason: err.message || 'Claim authorization failed'
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

  const network = String(request.network || '').toLowerCase();
  const evm = getEvmConfig(network);
  const provider = new ethers.JsonRpcProvider(evm.rpcUrl);
  const wxckContractAddress = evm.contractAddress.toLowerCase();

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

  if (!receipt.to || receipt.to.toLowerCase() !== wxckContractAddress) {
    return {
      ok: false,
      permanent: true,
      reason: 'Burn transaction was not sent to the wXCK contract'
    };
  }

  let burnedEvent = null;

  for (const log of receipt.logs) {
    if (!log.address || log.address.toLowerCase() !== wxckContractAddress) {
      continue;
    }

    try {
      const parsed = wxckInterface.parseLog(log);

      if (parsed.name === 'BridgeBurned') {
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
  const contract = getWxckContract(network);
  return await contract.totalSupply();
}