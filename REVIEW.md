# CiT 디자인 하네스 코드 검토

## 검토 범위

Claude CiT 인벤토리 하네스와 Codex Figma 하네스의 현재 파일, 안전 정책, 승인 코드, 문서와 자동 검사를 검토했다. 별도의 개인용 웹앱 하네스는 검토 범위에서 제외했다. 참고한 별도의 외부 운영 플레이북에서는 기계 판정, 작업별 승인 범위, 입력 변경 시 재승인 원칙만 가져왔다.

운영자가 혼자라는 조건을 반영해 동료의 GitHub PR 승인을 요구하던 흐름을 제거했다. Codex는 로컬 Ed25519 키로 본인이 승인한 범위에 서명하고 검증기가 공개 키, 범위, 계획/SSOT 지문과 유효기간을 확인한다. 이는 **본인 단독 승인 기록**이며 별도의 동료 검토나 외부 신원 인증을 제공하지 않는다.

## 점수: 90 / 100

이 점수는 현재 코드·문서와 아래 자동 검사를 기준으로 한다. Figma 실계정 권한 설정이나 실제 디자인 파일 변경은 이 환경에서 확인하지 않았다. 1인 운영에서는 PR 리뷰어 부재를 미설정 오류로 다루지 않고, 서명 검증으로 대체하되 독립 검토가 없다는 한계를 점수에 반영했다.

| 항목 | 점수 | 확인 근거 |
|---|---:|---|
| 기준 문서와 SSOT | 19 / 20 | Claude의 manifest/plugin/spec 검사와 저장소 간 기본 SSOT 경로 검사를 유지한다. 자연어 규칙과 기계 규칙이 의미상 완전히 같은지는 자동 증명하지 않는다. |
| Figma 쓰기 안전 | 21 / 25 | Codex 정책은 원본 보기 전용, 별도 staging, 작업 범위 서명과 사후 스크린샷을 요구한다. CLI를 건너뛴 Figma 도구 호출은 가로채지 못한다. |
| 승인 증거와 범위 검증 | 17 / 20 | Ed25519 서명이 승인 데이터, 정확한 범위, plan/SSOT SHA-256을 묶고 공개 키로 검증된다. 서명은 키 소유를 증명할 뿐, 실제 사람의 신원이나 별도 검토를 증명하지 않는다. |
| 회귀 검사 | 15 / 15 | Claude 쓰기 게이트 45개, Codex validator 안전 음성 사례 3개, Ed25519 승인 논리 14개가 기대한 결과를 냈다. 임시 복사본에서 키 생성→서명→검증 CLI 왕복도 성공했다. |
| 이식성과 키 관리 | 9 / 10 | Node.js 기본 모듈과 저장소 상대 경로를 사용한다. Windows ACL 설정은 구현했지만 실제 사용자 PC에서 실행되지는 않았다. 개인 키 백업과 보호는 운영자 책임이다. |
| 사용·운영 명료성 | 9 / 10 | 1인 키 등록, 작업 승인, 재검증 절차를 문서화했다. 실제 Figma 권한을 확인하기 전에는 쓰기 준비 완료로 간주할 수 없다. |
| **합계** | **90 / 100** | |

## 감점 이유 — 심각도 순

1. **−4점 — Figma 도구 호출 자체를 가로채지 못한다.** `codex-harness/scripts/verify-approval.mjs`는 명시적으로 실행할 때만 CLI 요청을 검사한다. 직접 플러그인 호출을 막는 Codex 호스트 훅은 이 구성에서 확인되지 않았다. 따라서 원본 Figma 파일을 Codex 계정에 보기 전용으로 설정하는 것이 실제 강제 경계다.
2. **−2점 — 원본/스테이징 Figma 권한은 실계정에서 미시험이다.** `docs/figma-access-smoke-test.md`에 실행 절차는 있지만 이 환경에서는 Figma 계정으로 허용/거부를 확인하지 않았다. 같은 Figma 계정에 원본 편집 권한을 주면 직접 호출 위험이 남는다.
3. **−2점 — 전자서명은 독립 검토나 회사 신원 확인이 아니다.** Ed25519 검증은 등록 공개 키에 맞는 개인 키로 서명했는지 확인한다. 승인자는 운영자 본인이며, 키 접근 가능자나 계정 주체를 회사 ID 시스템으로 확인하지 않는다. 동료가 없는 현재 조건에서는 이를 명시적인 자기 승인으로 취급한다.
4. **−1점 — 실제 Figma 쓰기/차단 결과 미확인.** 승인 CLI의 왕복 검증은 합성 테스트 파일을 대상으로 했다. 실제 staging 파일에서 화면을 만들고 원본 쓰기를 거부하는 동작은 시험하지 않았다.
5. **−1점 — 키 보호는 로컬 환경에 의존한다.** setup 스크립트는 Windows ACL을 제한하지만 키를 하드웨어 보안 장치에 보관하거나 암호로 잠그지는 않는다. 키 분실·유출 대응은 운영자가 백업, 비활성화, 교체해야 한다.

## 이번 보완

- 혼자 운영할 수 없는 필수 PR 리뷰어와 GitHub CLI 의존을 제거했다. 공개 키 registry는 `codex-harness/config/approvers.json`에 두며, 개인 키는 저장소 밖에 생성한다.
- 승인 데이터 스키마를 v3으로 정리했다. 승인 서명은 승인자 ID, 시각, 파일/페이지/부모/작업/노드 범위, 계획 SHA-256, 현재 SSOT SHA-256에 결합된다.
- `setup-approver.mjs`, `sign-approval.mjs`, `approval-signature.mjs`, `verify-approval.mjs`를 추가/교체했다. 비활성/미등록 키, 서명 위조, 승인 범위·해시 불일치, 원본 편집 모드, 미래/만료 시각을 거부한다.
- 루트와 하네스 문서에서 이전 PR 리뷰 승인 절차를 로컬 서명 안내로 통일했다. 하네스 패키지 버전을 `0.4.0`으로 올렸다.
- 직접 Figma 호출은 CLI 서명으로 막히지 않는다는 한계를 문서화하고, 원본 보기 전용 권한을 보호 경계로 유지했다.

## 2차 보완 (2026-10-07)

- **승인 기록과 `.gitignore`의 불일치를 고쳤다.** `codex-harness/.gitignore`의 `work/**/approval.json`이 문서가 "비공개 저장소에 commit한다"고 말하는 서명 기록을 실제로는 Git에서 제외하고 있었다. 그 줄만 제거했다 — `work/*.json`(최상위 파일만 대상)과 `!work/APPROVAL_TEMPLATE.json` 예외는 그대로 둬서 템플릿은 계속 추적된다. 기존 미추적 작업 폴더 2개(`figma-staging-smoke-test/`, `hye-ryeon-staging-write-test/`)는 손대지 않았다 — 추적 여부는 사용자가 직접 `git add`로 정한다.
- **`check-ssot.mjs`의 경로 해석을 하네스 루트 기준으로 고쳤다.** 저장소 루트에서 실행하면 `process.cwd()` 기준 상대경로가 풀려 `ENOENT`가 났다. `verify-approval.mjs`·`sign-approval.mjs`와 같은 방식(하네스 루트 기준 `path.resolve`)으로 통일했다. SSOT 내용은 바꾸지 않아 SHA-256은 이전과 동일하다(`a73bf928...`) — 기존 서명 승인 2건은 그대로 유효하다.
- **폐기된 동료 PR 승인 문서를 1인 운영 기준으로 다시 썼다.** `docs/github-approval-setup.md`가 존재하지 않는 정책 키(`githubRepository`, `requiredGithubReviewers`)를 지시하고 있었다. GitHub 저장소 보호(필수 상태 검사 `preflight`)만 다루는 문서로 교체하고 README에서 링크했다. `codex-harness/docs/claude-comparison.md`의 "GitHub-reviewed staging PR" 표현도 현재의 로컬 서명 승인 절차로 정정했다.
- **참고 플레이북 원칙 중 비어 있던 두 가지를 기계로 판정 가능한 형태로 넣었다.** "실패 시 복귀·반복 제한"(같은 게이트 2회째 실패 시 중단)과 "중단 후 재개"(재개 전 기존 기록 확인, 만료된 승인은 재서명)를 `write-gates.md`·`cit-figma-design/SKILL.md`·`AGENTS.md`·`work/WORK_ORDER.md`에 절차로 적었다. Codex `cit-design-audit`에는 Claude `preflight`에 있던 "셀 수 있는 GO/보류 판정 + 도구 출력 그대로 인용" 규칙을 추가해 두 하네스의 검수 판정 형식을 맞췄다.
- **선언-실재 대조를 저장소 루트로 넓혔다.** `scripts/check-repo.mjs`에 저장소 필수 문서 목록 검사와 마크다운 상대 링크 끊김 검사를 추가했다. `codex-harness/scripts/validate-harness.mjs`의 필수 파일 목록에도 `write-gates.md`·`docs/claude-comparison.md`·테스트 스크립트 자신을 추가해 이 파일들이 삭제되어도 통과하던 빈틈을 막았다.
- **GitHub에 공개될 문서·지침·오류 메시지를 한국어로 맞췄다.** PR 템플릿, CODEOWNERS, `codex-harness/AGENTS.md`, `claude-comparison.md`, Codex 스킬 2개와 `write-gates.md`, 감사자 TOML 지침, `.codex/config.toml` 주석, 두 `openai.yaml`의 `default_prompt`, 그리고 Codex 스크립트들의 사용자 대상 오류 메시지를 한국어로 옮겼다. 명령 플래그(`--approval` 등), 스킬 `name:` 식별자, `PASS`/`FAIL`/`BLOCK` 토큰, 워크플로 이름 `Harness preflight`(필수 상태 검사 이름으로 문서에서 참조됨)는 동작이 깨지므로 그대로 뒀다.
- `claude-inventory/design-language.md`는 서명 해시가 걸려 있어 이번에도 수정하지 않았다. 그 문서 §13에 남아 있던 옛 로컬 경로와 토큰 예시 표기는 현재 저장소 구조·보안 지침과 어긋나 있어 보고만 한다 — 수정 권한은 디자인 담당자에게 있다. (이 공개본에서는 §13 자체를 가상 예시값으로 대체했다.)
- 하네스 패키지 버전을 `0.5.0`으로 올렸다.

## 검증 결과

저장소 루트에서 `npm run preflight`를 실행했다 (2026-10-07 최종 실행 기준).

| 검사 | 결과 |
|---|---|
| 저장소 일관성·secret 패턴·필수 파일·마크다운 링크 검사 | 통과 |
| Claude 하네스 점검 | 통과 |
| Claude Figma 쓰기 게이트 | 통과 — 45/45 |
| Codex 정책 및 문서 검증 | 통과 |
| Codex SSOT 지문 확인 | 통과 — SHA-256 `a73bf928...` (design-language.md 미변경 확인) |
| Codex validator | 통과 — 기본 및 안전 음성 사례 3개 |
| Ed25519 승인 단위 사례 | 통과 — 14/14 |
| 키 생성→서명→승인 CLI 검증 (한국어 메시지 교체 후 재검증) | 통과 — 스크래치패드의 임시 사본과 합성 계획 사용, sign/verify/fingerprint/setup-approver 왕복 전부 확인 |
| 실제 Figma 원본/스테이징 권한 | 미실행 — CiT Figma 로그인 필요 (이번 작업에서도 Figma 연결·쓰기 테스트는 하지 않음) |
| 실제 사용자 Windows 키 ACL | 미실행 — 사용자 PC에서 설정할 때 확인 필요 |

## GitHub에 올리기 전 남은 일

최신 ZIP을 기존 로컬 저장소에 덮어쓴 뒤 `npm run preflight`를 실행하고, `git status --short`에서 개인 키나 Figma 토큰이 없는지 확인한다. `config/approvers.json`에는 공개 키만 들어가야 한다. 서명 개인 키는 ZIP, Git, 메신저로 옮기지 않는다. 변경분은 사용자가 기존 private GitHub 저장소에 commit/push할 수 있다. 동료 PR 승인은 설정할 필요가 없다.

Figma 작업을 시작하기 전에 [Figma 로컬 점검](docs/figma-access-smoke-test.md)에 따라 Codex 계정의 원본 보기 전용과 staging 편집 허용을 실제 화면에서 확인해야 한다. 실제 테스트 전까지 이 권한 경계는 문서화된 요구사항이지 확인된 결과가 아니다.
