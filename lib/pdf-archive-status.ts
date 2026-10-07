type StoredPdfArchive = {
  status: string;
  fileName: string;
  errorCode: string | null;
  updatedAt: string;
};

export function approvalPdfArchiveStatus(stored: StoredPdfArchive | undefined, enabled: string | undefined) {
  // Existing uploads remain available even when future automatic uploads are disabled.
  if (stored?.status === "uploaded") return stored;
  if (enabled?.trim().toLowerCase() !== "true") return { status: "disabled" as const };
  return stored || { status: "pending" as const };
}
