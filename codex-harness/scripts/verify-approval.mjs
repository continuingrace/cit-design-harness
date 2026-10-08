#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyApprovalSignature } from './approval-signature.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export function verifyApproval(approval, context, now = Date.now()) {
  const failures = [];
  const scope = approval?.scope ?? {};
  const policy = context.policy;
  if (approval?.schemaVersion !== 3) failures.push('지원하지 않는 승인 스키마입니다; 서명된 승인 템플릿을 사용하세요');
  if (approval?.status !== 'approved') failures.push('승인 기록이 서명·승인되지 않았습니다');
  if (!approval?.approvedBy) failures.push('승인자 식별자가 없습니다');
  if (!verifyApprovalSignature(approval, context.registry)) failures.push('승인자 서명이 없거나, 유효하지 않거나, 신뢰할 수 없습니다');
  if (context.mode !== 'staging') failures.push('Codex는 별도 staging 파일에만 쓸 수 있습니다');
  if (scope.mode !== 'staging') failures.push('승인 범위는 staging이어야 합니다');
  for (const key of ['fileKey', 'page', 'parentNodeId']) {
    if (!String(scope[key] ?? '').trim()) failures.push(`승인된 ${key}가 없습니다`);
    if (String(scope[key] ?? '') !== String(context[key] ?? '')) failures.push(`승인된 ${key}가 요청한 ${key}와 다릅니다`);
  }
  if (!Array.isArray(scope.operations) || !scope.operations.every((x) => typeof x === 'string') || !scope.operations.length) failures.push('승인된 작업은 비어 있지 않은 문자열 목록이어야 합니다');
  if (!Array.isArray(scope.nodeIds) || !scope.nodeIds.every((x) => typeof x === 'string')) failures.push('승인된 노드 ID는 문자열 목록이어야 합니다');
  const approvedOperations = Array.isArray(scope.operations) ? [...scope.operations].sort() : [];
  const requestedOperations = [...(context.operations ?? [])].sort();
  if (JSON.stringify(approvedOperations) !== JSON.stringify(requestedOperations)) failures.push('승인된 작업 범위가 요청과 일치하지 않습니다');
  const approvedNodes = Array.isArray(scope.nodeIds) ? [...scope.nodeIds].sort() : [];
  const requestedNodes = [...(context.nodeIds ?? [])].sort();
  if (JSON.stringify(approvedNodes) !== JSON.stringify(requestedNodes)) failures.push('승인된 노드 범위가 요청과 일치하지 않습니다');
  if (approval?.planSha256 !== context.planSha256) failures.push('승인된 계획 지문이 오래됐거나 일치하지 않습니다');
  if (approval?.ssotSha256 !== context.ssotSha256) failures.push('승인된 design SSOT 지문이 오래됐거나 일치하지 않습니다');

  const approvedAt = Date.parse(approval?.approvedAt ?? '');
  if (!Number.isFinite(approvedAt)) failures.push('서명된 승인의 시각 값이 유효하지 않습니다');
  if (!Number.isInteger(policy?.figma?.approvalMaxAgeHours) || policy.figma.approvalMaxAgeHours < 1) {
    failures.push('승인 유효기간 정책이 유효하지 않습니다');
  } else {
    const maxAgeMs = policy.figma.approvalMaxAgeHours * 60 * 60 * 1000;
    if (Number.isFinite(approvedAt) && (approvedAt > now || now - approvedAt > maxAgeMs)) failures.push('서명된 승인이 미래 시각이거나 만료됐습니다');
  }
  return { ok: failures.length === 0, failures };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!key.startsWith('--') || i + 1 >= argv.length) throw new Error(`잘못된 인자입니다: ${key}`);
    const name = key.slice(2);
    if (name === 'node' || name === 'operation') (args[name] ??= []).push(argv[++i]);
    else {
      if (Object.hasOwn(args, name)) throw new Error(`중복된 인자입니다: ${key}`);
      args[name] = argv[++i];
    }
  }
  for (const required of ['approval', 'plan', 'mode', 'file', 'page', 'parent']) {
    if (!args[required]) throw new Error(`필수 인자가 없습니다: --${required}`);
  }
  if (!args.operation?.length) throw new Error('필수 인자가 없습니다: --operation');
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const approvalPath = path.resolve(root, args.approval);
  const planPath = path.resolve(root, args.plan);
  const policy = JSON.parse(await readFile(path.join(root, 'config/harness-policy.json'), 'utf8'));
  const registry = JSON.parse(await readFile(path.resolve(root, policy.figma.approvalKeysFile), 'utf8'));
  const ssotPath = process.env[policy.authority.designSsot.pathEnv] || path.resolve(root, policy.authority.designSsot.path);
  const [approvalText, planBytes, ssotBytes] = await Promise.all([
    readFile(approvalPath, 'utf8'), readFile(planPath), readFile(ssotPath),
  ]);
  const approval = JSON.parse(approvalText);
  const planSha256 = sha256(planBytes);
  const ssotSha256 = sha256(ssotBytes);
  const result = verifyApproval(approval, {
    policy, registry,
    mode: args.mode,
    fileKey: args.file,
    page: args.page,
    parentNodeId: args.parent,
    operations: args.operation,
    nodeIds: args.node ?? [],
    planSha256,
    ssotSha256,
  });
  if (!result.ok) {
    for (const failure of result.failures) process.stderr.write(`BLOCK — ${failure}\n`);
    process.exitCode = 2;
    return;
  }
  process.stdout.write(`PASS — ${approval.approvedBy}의 서명 승인이 계획, SSOT, staging 범위와 일치합니다.\n`);
}

const invoked = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invoked) {
  try { await main(); }
  catch (error) { process.stderr.write(`BLOCK — ${error.message}\n`); process.exitCode = 2; }
}
