export interface LocalDocumentCapabilities {
  binaryExtractionAvailable: boolean;
  formats: string[];
  pdfScansSupported: false;
  notice: string;
}
export const localDocumentAi: Readonly<{
  withExtractionSlot<T>(callback: () => Promise<T>): Promise<T>;
  getDocumentCapabilities(): Promise<LocalDocumentCapabilities>;
  extractValidatedDocument(upload: { mimeType: string }, bytes: Uint8Array): Promise<{ text: string; tokens: null; notice: string }>;
  toMarkdown(input: { blob: Blob }): Promise<{ format: 'text'; data: string }>;
}>;
