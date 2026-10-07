export const MAX_WECOM_KNOWLEDGE_IMAGES: number;
export const MAX_WECOM_KNOWLEDGE_IMAGE_INPUT_BYTES: number;
export const MAX_WECOM_KNOWLEDGE_IMAGE_BYTES: number;
export const MAX_WECOM_KNOWLEDGE_IMAGES_BYTES: number;
export type WecomKnowledgeImageAsset = {
  id: string; itemId: string; revisionId: string; assetPath: string;
  mimeType: string; byteSize: number; storageKey: string;
  uploadState?: string; sha256?: string;
};
export type WecomKnowledgeImageObject = {
  size: number; httpMetadata?: { contentType?: string };
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  etag?: string; sha256?: string; customMetadata?: Record<string, string>;
};
export type PrepareWecomKnowledgeImagesOptions = {
  images: ReadonlyArray<{ url: string; mimeType: string; alt?: string }>;
  selected: ReadonlyArray<{ itemId: string; revisionId: string }>;
  authorize: () => boolean | Promise<boolean>;
  listAssets: (revisionId: string) => Promise<ReadonlyArray<WecomKnowledgeImageAsset>>;
  getObject: (storageKey: string) => Promise<WecomKnowledgeImageObject | null>;
  transform: (raw: Uint8Array, mimeType: string) => Uint8Array | Promise<Uint8Array>;
  signal?: AbortSignal;
};
export function prepareWecomKnowledgeImages(options: PrepareWecomKnowledgeImagesOptions): Promise<Array<{ base64: string; md5: string }>>;
export type WecomSharpPipeline = {
  metadata(): Promise<{ format?: string; width?: number; height?: number; pages?: number }>;
  rotate(): WecomSharpPipeline;
  resize(options: { width: number; height: number; fit: 'inside'; withoutEnlargement: true }): WecomSharpPipeline;
  flatten(options: { background: string }): WecomSharpPipeline;
  jpeg(options: { quality: number }): WecomSharpPipeline;
  toBuffer(): Promise<Uint8Array>;
};
export function transformWecomKnowledgeImage(bytes: Uint8Array, mimeType: string,
  sharpImpl: (bytes: Uint8Array, options: { limitInputPixels: number; sequentialRead: true; failOn: 'error' }) => WecomSharpPipeline): Promise<Uint8Array>;
