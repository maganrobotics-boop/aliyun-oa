export type DocumentIdCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (array: Uint8Array) => Uint8Array;
};

/** The optional source enables isolated tests without changing global crypto. */
export function createLocalDocumentId(cryptoSource?: DocumentIdCrypto | null): string;
