export function isValidTxHash(txHash) {
  return (
    typeof txHash === 'string' &&
    /^[a-fA-F0-9]{64}$/.test(txHash)
  );
}

export function isValidEvmAddress(address) {
  return (
    typeof address === 'string' &&
    /^0x[a-fA-F0-9]{40}$/.test(address)
  );
}

export function isValidNetwork(network) {
  return [
    'base',
    'polygon'
  ].includes(String(network).toLowerCase());
}

export function isValidAtomicAmount(amount) {
  return (
    Number.isSafeInteger(amount) &&
    amount > 0
  );
}

export function isValidXckAddress(address) {
  return (
    typeof address === 'string' &&
    address.length >= 95 &&
    address.length <= 110
  );
}

export function normalizeTxHash(txHash) {
  return String(txHash).trim().toLowerCase();
}

export function normalizeEvmAddress(address) {
  return String(address).trim().toLowerCase();
}

export function normalizeNetwork(network) {
  return String(network).trim().toLowerCase();
}