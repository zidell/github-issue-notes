const LOCK_PREFIX = '🔒';
const FORMAT_VERSION = 1;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const HEADER_BYTES = 1 + SALT_BYTES + IV_BYTES;
const KDF_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function normalizeLockPin(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 6);
  return /^\d{6}$/.test(digits) ? digits : '';
}

export function isLockedTitle(title = '') {
  return String(title).startsWith(LOCK_PREFIX);
}

export function addLockToTitle(title = '') {
  const plainTitle = removeLockFromTitle(title);
  return `${LOCK_PREFIX} ${plainTitle}`.trimEnd().slice(0, 256);
}

export function removeLockFromTitle(title = '') {
  return String(title).replace(/^🔒\s*/, '');
}

export async function encryptLockedBody(body, pin) {
  const normalizedPin = requirePin(pin);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(normalizedPin, salt, ['encrypt']);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(String(body ?? ''))
  ));
  const packed = new Uint8Array(HEADER_BYTES + encrypted.length);
  packed[0] = FORMAT_VERSION;
  packed.set(salt, 1);
  packed.set(iv, 1 + SALT_BYTES);
  packed.set(encrypted, HEADER_BYTES);
  return toBase64(packed);
}

export async function decryptLockedBody(body, pin) {
  const normalizedPin = requirePin(pin);
  let packed;
  try {
    packed = fromBase64(String(body ?? ''));
  } catch {
    throw new Error('잠금 데이터 형식을 읽을 수 없습니다.');
  }
  if (packed[0] !== FORMAT_VERSION || packed.length <= HEADER_BYTES) {
    throw new Error('지원하지 않는 잠금 데이터입니다.');
  }
  try {
    const salt = packed.slice(1, 1 + SALT_BYTES);
    const iv = packed.slice(1 + SALT_BYTES, HEADER_BYTES);
    const ciphertext = packed.slice(HEADER_BYTES);
    const key = await deriveKey(normalizedPin, salt, ['decrypt']);
    const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return decoder.decode(decrypted);
  } catch {
    throw new Error('6자리 숫자가 맞지 않습니다.');
  }
}

function requirePin(pin) {
  const normalized = normalizeLockPin(pin);
  if (!normalized) throw new Error('6자리 숫자를 입력해 주세요.');
  return normalized;
}

async function deriveKey(pin, salt, usages) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: KDF_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages
  );
}

function toBase64(bytes) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
