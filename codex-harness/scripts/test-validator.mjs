#!/usr/bin/env node
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHarness } from './validate-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '..');
const temp = await mkdtemp(path.join(os.tmpdir(), 'cit-harness-test-'));

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

try {
  const baseline = path.join(temp, 'baseline');
  await cp(source, baseline, { recursive: true });
  expect((await validateHarness(baseline)).ok, '기준 하네스는 통과해야 한다');

  const copiedSsot = path.join(temp, 'copied-ssot');
  await cp(source, copiedSsot, { recursive: true });
  await writeFile(path.join(copiedSsot, 'design-language.md'), 'duplicate');
  expect(!(await validateHarness(copiedSsot)).ok, 'SSOT를 복사해 두면 실패해야 한다');

  const unsafeApproval = path.join(temp, 'unsafe-approval');
  await cp(source, unsafeApproval, { recursive: true });
  const policyPath = path.join(unsafeApproval, 'config', 'harness-policy.json');
  const policy = JSON.parse(await readFile(policyPath, 'utf8'));
  policy.figma.codexMayWriteOriginals = true;
  await writeFile(policyPath, JSON.stringify(policy, null, 2));
  expect(!(await validateHarness(unsafeApproval)).ok, '승인 없이 원본 쓰기를 허용하면 실패해야 한다');

  const leakedSecret = path.join(temp, 'leaked-secret');
  await cp(source, leakedSecret, { recursive: true });
  await mkdir(path.join(leakedSecret, 'work'), { recursive: true });
  const fakeToken = ['figd', '1234567890abcdef12345678'].join('_');
  await writeFile(path.join(leakedSecret, 'work', 'leak.txt'), fakeToken);
  expect(!(await validateHarness(leakedSecret)).ok, '자격증명 형태의 토큰이 있으면 실패해야 한다');

  process.stdout.write('PASS — 기준 하네스와 안전 음성 사례 3건이 기대한 대로 동작했다.\n');
} finally {
  await rm(temp, { recursive: true, force: true });
}
