# CiT 디자인 하네스 (공개 데모)

[![Harness preflight](https://github.com/continuingrace/cit-design-harness/actions/workflows/preflight.yml/badge.svg?branch=main)](https://github.com/continuingrace/cit-design-harness/actions/workflows/preflight.yml)

Figma 디자인 시스템을 지키기 위해 **Claude 하네스**와 **Codex 하네스**를 한 저장소에서 같은 기준 문서로 묶어 돌리는 구조를 보여주는 **공개 데모**다. 실제 CiT 업무 자료가 아니다 — 조직명(`팀 A`~`팀 D`), Figma 파일 키·노드 ID(`EXAMPLE...`), 서체·자간·마진 같은 디자인 수치는 전부 가상의 예시값이고, 승인 서명·공개키 파일(`codex-harness/config/approvers.json`)도 빈 템플릿이다.

## 구성

- `claude-inventory/` — 디자인 언어 SSOT(`design-language.md`)와 그 SSOT를 기계가 읽는 규칙(`spec.json`), Figma를 읽기 전용으로 스캔하는 `figma-inventory.mjs`. Figma 쓰기 도구 호출은 `block-figma-write.mjs`(PreToolUse 훅)가 기본 차단한다.
- `codex-harness/` — 같은 SSOT를 읽기 전용으로 참조한다. Figma 제작은 원본이 아닌 별도 staging 파일에만 쓰고, 쓰기 전 Ed25519 서명 승인(`work/<작업>/approval.json` + `verify-approval.mjs`)을 통과해야 한다.
- 두 하네스는 기준 파일(SSOT)은 공유하지만 쓰기 권한은 공유하지 않는다. 전체 구조는 [`docs/architecture.md`](docs/architecture.md), 설치·실행은 [`docs/getting-started.md`](docs/getting-started.md)에 정리했다.

## 설치와 preflight 실행

Node.js 18 이상이 필요하고, 별도 패키지 설치는 없다. 저장소 루트에서:

```powershell
npm run preflight
```

이 한 명령이 저장소 전체 비밀값·링크 검사, 두 하네스의 선언-실재 대조, Figma 쓰기 게이트 회귀 테스트(45건), Codex 승인 검증 로직 테스트를 순서대로 실행한다. 위 배지가 가리키는 GitHub Actions(`Harness preflight`)가 `main` push와 PR마다 동일한 검사를 돌린다.

개별 점검:

```powershell
cd claude-inventory
npm run check
npm run test:write-gate
```

```powershell
cd codex-harness
npm run validate
npm test
npm run check:ssot
```

## 실제 조직에 맞춰 쓰려면

`claude-inventory/files.json`·`design-language.md`·`spec.json`의 예시값을 실제 Figma 파일 키와 확정된 디자인 규칙으로 바꾸고, `codex-harness/config/approvers.json`에 본인의 Ed25519 공개키를 등록한다. 승인 키 설정은 [`docs/approval-key-setup.md`](docs/approval-key-setup.md), Figma 원본/staging 권한 분리 점검은 [`docs/figma-access-smoke-test.md`](docs/figma-access-smoke-test.md), GitHub 브랜치 보호 설정은 [`docs/github-approval-setup.md`](docs/github-approval-setup.md)를 따른다. **실제 조직 식별자나 승인 키를 채운 뒤에는 그 저장소를 비공개로 유지할 것을 권장한다.**

코드 근거와 자체 검토 내역은 [`REVIEW.md`](REVIEW.md)에 정리했다.
