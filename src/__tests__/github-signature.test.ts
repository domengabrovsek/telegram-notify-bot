import { createHmac } from 'node:crypto';
import { isValidGitHubSignature } from '@/auth/github-signature';

const secret = 'test-secret';
const body = Buffer.from('{"zen":"Keep it logically awesome."}', 'utf-8');
const sign = (payload: Buffer, key = secret) => `sha256=${createHmac('sha256', key).update(payload).digest('hex')}`;

describe('isValidGitHubSignature', () => {
  it('accepts a signature computed over the raw body with the secret', () => {
    expect(isValidGitHubSignature(body, sign(body), secret)).toBe(true);
  });

  it('rejects a signature made with a different secret', () => {
    expect(isValidGitHubSignature(body, sign(body, 'other-secret'), secret)).toBe(false);
  });

  it('rejects a signature over a different body', () => {
    expect(isValidGitHubSignature(Buffer.from('{"zen":"tampered"}'), sign(body), secret)).toBe(false);
  });

  it('rejects a missing header', () => {
    expect(isValidGitHubSignature(body, undefined, secret)).toBe(false);
  });

  it('rejects a header without the sha256= prefix', () => {
    expect(isValidGitHubSignature(body, sign(body).replace('sha256=', 'sha1='), secret)).toBe(false);
  });

  it('rejects a truncated signature without throwing', () => {
    expect(isValidGitHubSignature(body, sign(body).slice(0, 20), secret)).toBe(false);
  });

  it('rejects everything when the secret is empty', () => {
    expect(isValidGitHubSignature(body, sign(body, ''), '')).toBe(false);
  });
});
