import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileGatewayDeviceIdentityStore, createGatewayDeviceAuth } from '../src/adapters/openclaw/device-auth.js';
import { createTempDir } from './helpers.js';

describe('Gateway device auth', () => {
  test('loadOrCreate persists a stable device identity on disk', () => {
    const dir = createTempDir('wakery-device-');
    const store = new FileGatewayDeviceIdentityStore(dir);

    const first = store.loadOrCreate();
    const second = store.loadOrCreate();

    expect(second).toEqual(first);
    expect(first.deviceId).toMatch(/^[a-f0-9]{64}$/);
    expect(first.publicKeyPem).toContain('BEGIN PUBLIC KEY');

    const persisted = JSON.parse(readFileSync(join(dir, 'device-identity.json'), 'utf8'));
    expect(persisted.version).toBe(1);
    expect(persisted.deviceId).toBe(first.deviceId);
    expect(persisted.publicKeyPem).toBe(first.publicKeyPem);
    expect(persisted.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  test('createGatewayDeviceAuth binds nonce and returns a signed device block', () => {
    const dir = createTempDir('wakery-device-');
    const store = new FileGatewayDeviceIdentityStore(dir);
    const identity = store.loadOrCreate();

    const authA = createGatewayDeviceAuth(identity, {
      nonce: 'nonce-a',
      token: 'token-123',
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      platform: 'darwin',
      deviceFamily: 'wakery'
    });
    const authB = createGatewayDeviceAuth(identity, {
      nonce: 'nonce-b',
      token: 'token-123',
      clientId: 'gateway-client',
      clientMode: 'backend',
      role: 'operator',
      scopes: ['operator.read', 'operator.write'],
      platform: 'darwin',
      deviceFamily: 'wakery'
    });

    expect(authA).toMatchObject({
      id: identity.deviceId,
      nonce: 'nonce-a'
    });
    expect(authA.publicKey).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(authA.signature).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(authA.signedAt).toBeTypeOf('number');
    expect(authB.signature).not.toBe(authA.signature);
  });
});
