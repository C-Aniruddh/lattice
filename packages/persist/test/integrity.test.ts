import { describe, expect, it } from 'vitest';
import { hashString } from '@lattice/core';
import { defaultChecksum, type Checksum } from '../src/integrity.js';

describe('defaultChecksum', () => {
  it('is eight lowercase hex digits for every input, including the ones that pad', () => {
    // The padding is the part that breaks silently: a digest that is sometimes seven
    // characters compares unequal to the same digest written by a build that padded it.
    let sawShortHash = false;
    for (let i = 0; i < 2000; i += 1) {
      const digest = defaultChecksum(`payload-${String(i)}`);
      expect(digest).toMatch(/^[0-9a-f]{8}$/);
      if (hashString(`payload-${String(i)}`) >>> 0 < 0x1000_0000) sawShortHash = true;
    }
    expect(sawShortHash, 'the corpus must contain a hash that needs padding').toBe(true);
  });

  it('is a pure function of the string', () => {
    expect(defaultChecksum('a')).toBe(defaultChecksum('a'));
    expect(defaultChecksum('a')).not.toBe(defaultChecksum('b'));
  });

  it('notices the damage a save actually suffers', () => {
    const payload = JSON.stringify({ wallet: { coin: 1234 }, buildings: [1, 2, 3] });
    const digest = defaultChecksum(payload);

    // truncation — the shape a quota-clipped write takes
    expect(defaultChecksum(payload.slice(0, payload.length - 1))).not.toBe(digest);
    // one flipped character — the shape a hand edit takes
    expect(defaultChecksum(payload.replace('1234', '9999'))).not.toBe(digest);
    // trailing whitespace — the shape a sync extension takes
    expect(defaultChecksum(`${payload} `)).not.toBe(digest);
  });

  it('digests the empty string rather than refusing it', () => {
    expect(defaultChecksum('')).toMatch(/^[0-9a-f]{8}$/);
  });

  it('separates NFC from NFD, which is correct for bytes and wrong for names', () => {
    // The whole portability note in one assertion. These two strings look identical and are
    // different bytes: as a *checksum* over a payload that is exactly right, because the
    // checksum's job is to notice that the bytes changed. As a *key* derived from a player's
    // typed name it is a bug, and the fix is `.normalize('NFC')` at the key, never here.
    const nfc = 'caf\u00e9';
    const nfd = 'cafe\u0301';
    expect(nfc.normalize('NFC')).toBe(nfd.normalize('NFC'));
    expect(defaultChecksum(nfc)).not.toBe(defaultChecksum(nfd));
    expect(defaultChecksum(nfc.normalize('NFC'))).toBe(defaultChecksum(nfd.normalize('NFC')));
  });

  it('is a type a game can substitute', () => {
    const constant: Checksum = () => 'deadbeef';
    expect(constant('anything')).toBe('deadbeef');
  });
});
