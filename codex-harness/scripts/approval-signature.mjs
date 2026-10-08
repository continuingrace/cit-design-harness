import { createPublicKey, verify } from 'node:crypto';

export function approvalPayload(approval) {
  const scope = approval?.scope ?? {};
  const payload = {
    schemaVersion: approval?.schemaVersion,
    status: approval?.status,
    approvedBy: approval?.approvedBy,
    approvedAt: approval?.approvedAt,
    scope: {
      mode: scope.mode,
      fileKey: scope.fileKey,
      page: scope.page,
      parentNodeId: scope.parentNodeId,
      operations: Array.isArray(scope.operations) ? [...scope.operations].sort() : scope.operations,
      nodeIds: Array.isArray(scope.nodeIds) ? [...scope.nodeIds].sort() : scope.nodeIds,
    },
    planSha256: approval?.planSha256,
    ssotSha256: approval?.ssotSha256,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8');
}

export function verifyApprovalSignature(approval, registry) {
  try {
    if (approval?.schemaVersion !== 3 || typeof approval?.signature !== 'string' || !approval.signature) return false;
    const entry = registry?.approvers?.[approval.approvedBy];
    if (!entry?.enabled || typeof entry.publicKey !== 'string') return false;
    const key = createPublicKey(entry.publicKey);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    const signature = Buffer.from(approval.signature, 'base64');
    if (!signature.length || signature.toString('base64') !== approval.signature) return false;
    return verify(null, approvalPayload(approval), key, signature);
  } catch {
    return false;
  }
}
