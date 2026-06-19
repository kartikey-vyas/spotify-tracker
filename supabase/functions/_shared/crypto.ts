const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function sha256Hex(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(value));
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', textEncoder.encode(secret));
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptString(
  plainText: string,
  secret: string
): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret);
  const encrypted = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: nonce
    },
    key,
    textEncoder.encode(plainText)
  );

  return {
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    nonce: bytesToBase64(nonce)
  };
}

export async function decryptString(ciphertext: string, nonce: string, secret: string): Promise<string> {
  const key = await aesKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64ToBytes(nonce)
    },
    key,
    base64ToBytes(ciphertext)
  );

  return textDecoder.decode(decrypted);
}

export function randomToken(bytes = 32): string {
  const token = crypto.getRandomValues(new Uint8Array(bytes));
  return bytesToBase64(token).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

