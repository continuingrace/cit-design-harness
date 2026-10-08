import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { approvalPayload } from './approval-signature.mjs';
import { verifyApproval } from './verify-approval.mjs';

const now = Date.parse('2026-10-01T12:00:00Z');
const planSha256 = createHash('sha256').update('approved-plan-v3').digest('hex');
const ssotSha256 = createHash('sha256').update('design-ssot-v1.5').digest('hex');
const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const registry = { schemaVersion: 1, approvers: { cit_owner: { enabled: true, publicKey } } };
const policy = { figma: { approvalMaxAgeHours: 24 } };
const scope = {
  mode: 'staging', fileKey: 'ABC123', page: 'AI_CODEX__Q4', parentNodeId: '9000:1',
  operations: ['use_figma'], nodeIds: ['9000:1'],
};

function signedApproval(overrides = {}) {
  const approval = {
    schemaVersion: 3, status: 'approved', approvedBy: 'cit_owner', approvedAt: '2026-10-01T11:00:00Z',
    scope, planSha256, ssotSha256, signature: '', ...overrides,
  };
  approval.signature = sign(null, approvalPayload(approval), privateKey).toString('base64');
  return approval;
}

const base = signedApproval();
const context = {
  policy, registry, mode: 'staging', ...scope, planSha256, ssotSha256,
};
const cases = [
  ['유효한 Ed25519 승인은 통과한다', base, context, true],
  ['pending 상태 승인은 차단한다', signedApproval({ status: 'pending' }), context, false],
  ['대상이 바뀌면 차단한다', base, { ...context, fileKey: 'OTHER999' }, false],
  ['작업 범위가 바뀌면 차단한다', base, { ...context, operations: ['delete_node'] }, false],
  ['계획 지문이 바뀌면 차단한다', base, { ...context, planSha256: '0'.repeat(64) }, false],
  ['design SSOT 지문이 바뀌면 차단한다', base, { ...context, ssotSha256: '1'.repeat(64) }, false],
  ['만료된 서명 승인은 차단한다', signedApproval({ approvedAt: '2026-09-29T10:00:00Z' }), context, false],
  ['노드 범위가 바뀌면 차단한다', base, { ...context, nodeIds: ['1:2'] }, false],
  ['원본 편집 모드는 차단한다', base, { ...context, mode: 'edit' }, false],
  ['등록되지 않은 서명자는 차단한다', signedApproval({ approvedBy: 'other_user' }), context, false],
  ['위조된 서명은 차단한다', { ...base, signature: Buffer.from('tampered').toString('base64') }, context, false],
  ['서명된 범위를 바꾸면 차단한다', { ...base, scope: { ...scope, fileKey: 'OTHER999' } }, context, false],
  ['형식이 잘못된 서명은 차단한다', { ...base, signature: 'not-base64!' }, context, false],
  ['유효기간 정책이 잘못되면 차단한다', base, { ...context, policy: { figma: { approvalMaxAgeHours: 0 } } }, false],
];

const failures = [];
for (const [name, approval, request, expected] of cases) {
  const actual = verifyApproval(approval, request, now).ok;
  const passed = actual === expected;
  process.stdout.write(`${passed ? 'PASS' : 'FAIL'} — ${name}\n`);
  if (!passed) failures.push(name);
}
if (failures.length) process.exitCode = 1;
