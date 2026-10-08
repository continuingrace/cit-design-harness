# 1인 운영 GitHub와 승인 키 설정

GitHub 동료가 없는 경우 Figma 작업 승인은 로컬 Ed25519 서명으로 처리한다. GitHub의 사용자명 문자열은 신원 증거로 간주하지 않는다. 서명이 유효하면 등록된 공개 키의 개인 키를 가진 사람이 해당 범위와 해시에 승인한 것이다.

## 승인 키 만들기

VS Code PowerShell 터미널에서 `codex-harness` 폴더로 이동한다. 아래 예시는 GitHub 로그인 ID를 승인자 식별자로 사용한다.

```powershell
Set-Location .\codex-harness
npm run setup:approver -- --approver your-github-id --key "$env:USERPROFILE\.cit-design-harness\approval-key.pem"
npm run validate
```

이 명령은 Ed25519 개인 키를 사용자 프로필의 `.cit-design-harness` 폴더에 만들고, 공개 키만 `config/approvers.json`에 등록한다. Windows에서는 개인 키 ACL을 현재 사용자로 제한한다. 개인 키 파일은 저장소에 복사하거나 공유하지 않는다.

키 설정을 GitHub에 보존한다. 공개 키 파일만 commit 대상인지 `git status --short`로 확인한다.

```powershell
git add config/approvers.json
git commit -m "Register local Figma approval key"
git push origin main
```

`npm run preflight`가 통과한 후 GitHub의 **Settings → Rules → Rulesets**에서 `main`에 `preflight` 필수 상태 검사를 설정할 수 있다. 동료 승인은 요구하지 않아도 된다. 이 CI 검사는 코드 품질을 확인하며 Figma 승인 서명을 대체하지 않는다.

개인 키를 잃으면 승인 서명을 만들 수 없다. 키를 암호화된 보안 저장소에 백업한다. 유출되면 `config/approvers.json`에서 기존 키를 비활성화하고 새 키를 등록한다.

## 작업 승인

1. `work/<task>/plan.md`에 목표와 정확한 별도 staging 파일/페이지/부모/노드/작업을 적는다.
2. `approval.json`의 범위를 계획과 동일하게 채운다. 상태는 `pending`으로 둔다.
3. 승인 명령을 실행한다. 이 명령 실행은 사용자의 서명 행위이며 대상, 계획, SSOT 해시와 승인 시각을 기록한다.
4. 서명한 plan과 approval 파일을 private 저장소에 commit/push해 작업 기록을 남긴다.
5. Figma 쓰기 직전에 `verify:approval`을 실행한다. 범위나 계획/SSOT/서명이 바뀌거나 24시간이 지나면 다시 승인해야 한다.

승인은 별도 staging 파일 쓰기만 허용한다. 원본 Figma 편집 권한은 이 CLI가 통제할 수 없으므로 Figma에서 분리한다. 자세한 절차는 [Figma 권한 로컬 점검](figma-access-smoke-test.md)을 따른다.
