import { extractMessageText, parseAndValidateBody } from '@/validators/message-validator';

describe('parseAndValidateBody', () => {
  it('parses valid JSON body', () => {
    const body = JSON.stringify({ message: { text: 'hello' }, chat_id: '123' });
    const result = parseAndValidateBody(body);

    expect(result.message.text).toBe('hello');
    expect(result.chat_id).toBe('123');
  });

  it('throws on empty body', () => {
    expect(() => parseAndValidateBody('')).toThrow('Invalid message body');
  });

  it('throws on non-string body', () => {
    expect(() => parseAndValidateBody(null as never)).toThrow('Invalid message body');
  });

  it('throws on body exceeding max length', () => {
    const body = JSON.stringify({ message: { text: 'x'.repeat(10_000) } });
    expect(() => parseAndValidateBody(body)).toThrow('too large');
  });

  it('throws on invalid JSON', () => {
    expect(() => parseAndValidateBody('not json')).toThrow('Invalid JSON');
  });

  it('throws when message field is missing', () => {
    expect(() => parseAndValidateBody(JSON.stringify({ chat_id: '123' }))).toThrow('missing "message" field');
  });

  it('throws when message is null', () => {
    expect(() => parseAndValidateBody(JSON.stringify({ message: null }))).toThrow('missing "message" field');
  });
});

describe('extractMessageText', () => {
  it('extracts trimmed text', () => {
    const result = extractMessageText({ message: { text: '  hello  ' } } as never);
    expect(result).toBe('hello');
  });

  it('returns null for empty text', () => {
    const result = extractMessageText({ message: { text: '   ' } } as never);
    expect(result).toBeNull();
  });

  it('returns null when text is missing', () => {
    const result = extractMessageText({ message: {} } as never);
    expect(result).toBeNull();
  });

  it('returns null when text is not a string', () => {
    const result = extractMessageText({ message: { text: 123 } } as never);
    expect(result).toBeNull();
  });
});
