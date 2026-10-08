# GitHub 보호 설정 — 1인 운영

이 하네스는 동료 PR 승인을 요구하지 않는다. Figma staging 쓰기 승인은 로컬 Ed25519 서명(`codex-harness/config/approvers.json` + `work/<작업>/approval.json`)으로 처리하며, 그 설정은 [1인 운영 승인 키 설정](approval-key-setup.md)을 따른다. 이 문서는 혼자 운영하는 저장소에서 `main` 브랜치를 보호하는 GitHub 설정만 다룬다.

## 왜 동료 리뷰어 절차가 없는가

이전에는 Codex 작업 PR에 동료 리뷰어 승인을 요구하는 흐름이 있었다. 1인 운영에는 리뷰어가 없어 이 요구는 항상 실패하거나 우회가 필요했다. [검토 보고서](../REVIEW.md)에 따라 이 요구를 제거하고, 작업 승인의 증거를 PR 리뷰 대신 서명된 `approval.json`으로 옮겼다.

## `main` 보호 규칙

GitHub 저장소의 **Settings → Rules → Rulesets**에서 `main`에 적용할 규칙을 만든다.

1. 직접 push를 제한하고 pull request를 거치게 한다. (1인 운영에서도 변경 이력을 PR 단위로 남기려는 경우에만. 혼자 커밋해도 괜찮다면 이 항목은 생략할 수 있다.)
2. **`Harness preflight / preflight`** 상태 검사를 필수로 지정한다. `.github/workflows/preflight.yml`이 이 이름으로 실행된다.
3. 동료 승인(required approving review)은 설정하지 않는다 — 리뷰어가 없는 1인 운영에서는 항상 실패하는 조건이다.
4. 관리자 우회를 허용할지는 운영자가 정한다. 혼자 운영할 때는 제한해도 영향이 없다.

`.github/CODEOWNERS`는 비워 둔다. 두 번째 운영자가 생기면 경로별 소유자를 추가하고 그때 동료 승인 규칙을 다시 고려한다.

## Figma 작업 승인은 여기서 하지 않는다

이 문서의 범위는 GitHub 저장소 설정뿐이다. 실제 Figma staging 쓰기를 승인하는 절차는:

- `work/<작업>/plan.md`: 목적, 별도 staging 파일, 페이지·부모·노드, 작업 범위, 완료 기준
- `work/<작업>/approval.json`: 정확한 Figma 범위, 계획 SHA-256, 현재 SSOT SHA-256, Ed25519 서명

위 두 파일은 [1인 운영 승인 키 설정](approval-key-setup.md)에 따라 로컬에서 서명하고, `npm run verify:approval`로 쓰기 직전에 검증한다. 서명된 `approval.json`은 작업 이력이므로 commit 대상이다 — `.gitignore`는 승인 기록을 제외하지 않는다. 실제 Figma 식별자가 들어간 운영 환경에서는 이 저장소를 비공개로 유지하는 것을 권장한다.

이 GitHub 상태 검사는 하네스 코드(정책 스키마, 안전 설정, 비밀값 패턴)를 검사할 뿐, 작업별 Figma 승인을 대신하지 않는다.
