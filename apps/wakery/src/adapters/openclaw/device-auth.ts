import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export interface GatewayDeviceIdentity {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
}

export interface GatewayDeviceAuthParams {
  nonce: string;
  token: string;
  clientId: string;
  clientMode: string;
  role: 'operator' | 'node';
  scopes: string[];
  platform: string;
  deviceFamily?: string;
}

export interface GatewayDeviceAuth {
  id: string;
  publicKey: string;
  signature: string;
  signedAt: number;
  nonce: string;
}

export class FileGatewayDeviceIdentityStore {
  constructor(private readonly dir: string) {}

  loadOrCreate(): GatewayDeviceIdentity {
    mkdirSync(this.dir, { recursive: true });
    const path = join(this.dir, 'device-identity.json');
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
        version?: number;
        deviceId?: string;
        publicKeyPem?: string;
        privateKeyPem?: string;
      };
      if (parsed.version === 1 && typeof parsed.deviceId === 'string' && typeof parsed.publicKeyPem === 'string' && typeof parsed.privateKeyPem === 'string') {
        const derivedId = fingerprintPublicKey(parsed.publicKeyPem);
        if (derivedId !== parsed.deviceId) {
          const updated = { ...parsed, deviceId: derivedId };
          writeSecureJson(path, updated);
          return { deviceId: derivedId, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem };
        }
        return { deviceId: parsed.deviceId, publicKeyPem: parsed.publicKeyPem, privateKeyPem: parsed.privateKeyPem };
      }
    }

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const identity: GatewayDeviceIdentity = {
      deviceId: fingerprintPublicKey(publicKeyPem),
      publicKeyPem,
      privateKeyPem
    };

    writeSecureJson(path, {
      version: 1,
      deviceId: identity.deviceId,
      publicKeyPem: identity.publicKeyPem,
      privateKeyPem: identity.privateKeyPem,
      createdAtMs: Date.now()
    });
    return identity;
  }
}

export function createGatewayDeviceAuth(identity: GatewayDeviceIdentity, params: GatewayDeviceAuthParams): GatewayDeviceAuth {
  const signedAt = Date.now();
  const payload = buildDeviceAuthPayloadV3(identity, params, signedAt);
  const signature = sign(null, Buffer.from(payload, 'utf8'), createPrivateKey(identity.privateKeyPem));

  return {
    id: identity.deviceId,
    publicKey: publicKeyRawBase64UrlFromPem(identity.publicKeyPem),
    signature: base64UrlEncode(signature),
    signedAt,
    nonce: params.nonce
  };
}

function buildDeviceAuthPayloadV3(identity: GatewayDeviceIdentity, params: GatewayDeviceAuthParams, signedAtMs: number) {
  const scopes = params.scopes.join(',');
  const token = params.token ?? '';
  const platform = normalizeDeviceMetadataForAuth(params.platform);
  const deviceFamily = normalizeDeviceMetadataForAuth(params.deviceFamily);

  return [
    'v3',
    identity.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopes,
    String(signedAtMs),
    token,
    params.nonce,
    platform,
    deviceFamily
  ].join('|');
}

function normalizeDeviceMetadataForAuth(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed) return '';
  return trimmed.toLowerCase();
}

function fingerprintPublicKey(publicKeyPem: string) {
  return createHash('sha256').update(derivePublicKeyRaw(publicKeyPem)).digest('hex');
}

function derivePublicKeyRaw(publicKeyPem: string) {
  const spki = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' }) as Buffer;
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

function publicKeyRawBase64UrlFromPem(publicKeyPem: string) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

function base64UrlEncode(buffer: Uint8Array) {
  return Buffer.from(buffer).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

function writeSecureJson(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(path, 0o600);
  } catch {}
}
