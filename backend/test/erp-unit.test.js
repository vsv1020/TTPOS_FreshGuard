const { encryptSecret, decryptSecret, validateKey } = require('../src/lib/erp-crypto');
const { mapItemToProduct } = require('../src/services/erp-sync');

const VALID_KEY = 'a'.repeat(64); // 64 hex chars = 32 bytes
const OTHER_KEY = 'b'.repeat(64);

const CONNECTION = {
  defaultLabelLanguage: 'single',
  defaultPrimaryLanguage: 'th',
  defaultSecondaryLanguage: 'en'
};

describe('erp-crypto round-trip', () => {
  test('encrypt then decrypt returns the original plaintext', () => {
    const secret = 'super-secret-api-token-12345';
    const blob = encryptSecret(secret, VALID_KEY);
    expect(blob).not.toContain(secret); // ciphertext does not leak plaintext
    expect(blob.split(':')).toHaveLength(3); // iv:tag:ciphertext
    expect(decryptSecret(blob, VALID_KEY)).toBe(secret);
  });

  test('decrypting with the wrong key fails (GCM auth tag mismatch)', () => {
    const blob = encryptSecret('hello', VALID_KEY);
    expect(() => decryptSecret(blob, OTHER_KEY)).toThrow();
  });

  test('short / malformed key is rejected by validateKey, encrypt, and decrypt', () => {
    expect(() => validateKey('abc')).toThrow(/64 hex/);
    expect(() => validateKey('z'.repeat(64))).toThrow(/64 hex/); // non-hex chars
    expect(() => encryptSecret('x', 'abc')).toThrow(/64 hex/);
    expect(() => decryptSecret('a:b:c', 'abc')).toThrow(/64 hex/);
  });

  test('tampered blob fails authentication', () => {
    const blob = encryptSecret('payload', VALID_KEY);
    const [iv, tag, ct] = blob.split(':');
    const flipped = ct.slice(0, -1) + (ct.slice(-1) === '0' ? '1' : '0');
    expect(() => decryptSecret(`${iv}:${tag}:${flipped}`, VALID_KEY)).toThrow();
  });
});

describe('mapItemToProduct', () => {
  test('empty / missing item_code throws', () => {
    expect(() => mapItemToProduct({ item_code: '', shelf_life_in_days: 5 }, CONNECTION))
      .toThrow(/item_code is required/);
    expect(() => mapItemToProduct({ shelf_life_in_days: 5 }, CONNECTION))
      .toThrow(/item_code is required/);
    expect(() => mapItemToProduct({ item_code: '   ', shelf_life_in_days: 5 }, CONNECTION))
      .toThrow(/item_code is required/);
  });

  test('null / 0 / negative shelf_life throws', () => {
    expect(() => mapItemToProduct({ item_code: 'A', shelf_life_in_days: null }, CONNECTION))
      .toThrow(/shelf_life_in_days/);
    expect(() => mapItemToProduct({ item_code: 'A', shelf_life_in_days: 0 }, CONNECTION))
      .toThrow(/shelf_life_in_days/);
    expect(() => mapItemToProduct({ item_code: 'A', shelf_life_in_days: -3 }, CONNECTION))
      .toThrow(/shelf_life_in_days/);
    expect(() => mapItemToProduct({ item_code: 'A', shelf_life_in_days: '' }, CONNECTION))
      .toThrow(/shelf_life_in_days/);
  });

  test('valid item maps externalRef, sku, name, shelfLife, languages, disabled', () => {
    const mapped = mapItemToProduct(
      { item_code: 'SKU1', item_name: 'Milk', shelf_life_in_days: 7, valuation_rate: 12.5, disabled: 0 },
      CONNECTION
    );
    expect(mapped.externalRef).toBe('SKU1');
    expect(mapped.sku).toBe('SKU1');
    expect(mapped.name).toBe('Milk');
    expect(mapped.shelfLifeDays).toBe(7);
    expect(mapped.costPrice).toBe(12.5);
    expect(mapped.labelLanguage).toBe('single');
    expect(mapped.primaryLanguage).toBe('th');
    expect(mapped.secondaryLanguage).toBe('en');
    expect(mapped.disabled).toBe(0);
  });

  test('costPrice present in mapping; insert path passes it (mapped.costPrice)', () => {
    const withCost = mapItemToProduct(
      { item_code: 'C', item_name: 'C', shelf_life_in_days: 3, valuation_rate: 99 },
      CONNECTION
    );
    expect(withCost.costPrice).toBe(99);
    // missing valuation_rate => null cost (insert seeds NULL, not 0)
    const noCost = mapItemToProduct(
      { item_code: 'D', item_name: 'D', shelf_life_in_days: 3 },
      CONNECTION
    );
    expect(noCost.costPrice).toBeNull();
  });

  test('disabled flag is normalized to 0/1', () => {
    expect(mapItemToProduct({ item_code: 'E', shelf_life_in_days: 1, disabled: 1 }, CONNECTION).disabled).toBe(1);
    expect(mapItemToProduct({ item_code: 'F', shelf_life_in_days: 1, disabled: 0 }, CONNECTION).disabled).toBe(0);
  });

  // The update PATCH built in runSync intentionally OMITS costPrice, sku,
  // allergens, storageConditions, openedShelfLifeHours, colorCode. mapItemToProduct
  // does not produce allergens/colorCode at all, so an update patch derived from it
  // cannot carry them. Assert the mapped shape has no such keys to lock that in.
  test('mapped shape carries no allergens/colorCode/storageConditions keys (cannot leak into update patch)', () => {
    const mapped = mapItemToProduct(
      { item_code: 'G', item_name: 'G', shelf_life_in_days: 2 },
      CONNECTION
    );
    expect(mapped).not.toHaveProperty('allergens');
    expect(mapped).not.toHaveProperty('colorCode');
    expect(mapped).not.toHaveProperty('storageConditions');
    expect(mapped).not.toHaveProperty('openedShelfLifeHours');
  });
});
