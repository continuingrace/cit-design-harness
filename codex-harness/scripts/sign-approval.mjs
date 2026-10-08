#!/usr/bin/env node
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { approvalPayload } from './approval-signature.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`잘못된 인자입니다: ${key}`);
    const name = key.slice(2);
    if (Object.hasOwn(args, name)) throw new Error(`중복된 인자입니다: ${key}`);
    args[name] = argv[++i];
  }
  for (const key of ['approval', 'plan', 'approver', 'key']) if (!args[key]) throw new Error(`필수 인자가 없습니다: --${key}`);
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const approvalPath = path.resolve(root, args.approval);
  const planPath = path.resolve(root, args.plan);
  const keyPath = path.resolve(args.key);
  const [policy, registry, approval, planBytes, keyText] = await Promise.all([
    readFile(path.join(root, 'config/harness-policy.json'), 'utf8').then(JSON.parse),
    readFile(path.join(root, 'config/approvers.json'), 'utf8').then(JSON.parse),
    readFile(approvalPath, 'utf8').then(JSON.parse),
    readFile(planPath),
    readFile(keyPath, 'utf8'),
  ]);
  if (approval?.status !== 'pending') throw new Error('승인 기록은 서명 전까지 pending 상태여야 합니다');
  const signer = registry.approvers?.[args.approver];
  if (!signer?.enabled) throw new Error(`${args.approver}에 등록된 활성 공개 키가 없습니다`);
  if (approval.scope?.mode !== 'staging') throw new Error('별도 staging 파일 승인만 서명할 수 있습니다');
  for (const field of ['fileKey', 'page', 'parentNodeId']) if (!String(approval.scope?.[field] ?? '').trim()) throw new Error(`승인 범위에 ${field}가 없습니다`);
  if (!Array.isArray(approval.scope?.operations) || approval.scope.operations.length === 0) throw new Error('승인 범위에는 최소 1개의 작업이 있어야 합니다');
  if (!Array.isArray(approval.scope?.nodeIds)) throw new Error('승인 nodeIds는 목록이어야 합니다');

  const privateKey = createPrivateKey(keyText);
  const registeredPublic = createPublicKey(signer.publicKey).export({ type: 'spki', format: 'der' });
  const actualPublic = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  if (!registeredPublic.equals(actualPublic)) throw new Error('개인 키가 approvers.json에 등록된 이 승인자 ID의 키와 일치하지 않습니다');

  const ssotPath = process.env[policy.authority.designSsot.pathEnv] || path.resolve(root, policy.authority.designSsot.path);
  const ssotBytes = await readFile(ssotPath);
  const signed = {
    ...approval,
    schemaVersion: 3,
    status: 'approved',
    approvedBy: args.approver,
    approvedAt: new Date().toISOString(),
    planSha256: sha256(planBytes),
    ssotSha256: sha256(ssotBytes),
    signature: '',
  };
  signed.signature = sign(null, approvalPayload(signed), privateKey).toString('base64');
  await writeFile(approvalPath, `${JSON.stringify(signed, null, 2)}\n`, 'utf8');
  process.stdout.write(`PASS — ${args.approver}이(가) 승인에 서명했습니다; 계획과 현재 SSOT 지문을 기록했습니다. 개인 키는 Git 밖에 보관하세요.\n`);
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  try { await main(); }
  catch (error) { process.stderr.write(`FAIL — ${error.message}\n`); process.exitCode = 1; }
}
