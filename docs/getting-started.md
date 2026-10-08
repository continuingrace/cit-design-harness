# Windows에서 시작하기

VS Code PowerShell 터미널에서 저장소 루트 기준으로 명령을 실행한다. Node.js 18 이상과 Git이 필요하며 npm 패키지를 설치하지 않는다.

## 1. 전체 사전 점검

```powershell
npm run preflight
```

SSOT 버전과 경로, 비밀값 패턴, Claude 매니페스트와 쓰기 게이트 45개, Codex 정책과 승인 검사를 확인한다. 실패하면 커밋 전에 원인을 수정한다.

## 2. Claude로 Figma 읽기 전용 인벤토리 실행

토큰은 `File content: Read` 권한만 주고, 회사 정책에 맞는 만료일을 설정한다. 토큰을 명령 인수나 파일에 직접 입력하지 않는다.

```powershell
Set-Location .\claude-inventory
$secureToken = Read-Host "Figma 읽기 전용 토큰" -AsSecureString
$env:FIGMA_TOKEN = [System.Net.NetworkCredential]::new("", $secureToken).Password
node .\figma-inventory.mjs
Remove-Item Env:FIGMA_TOKEN
```

스캔 대상 파일 목록은 `claude-inventory/files.json`에 둔다. 원본 응답 캐시와 생성 리포트는 Git 제외 대상이다. 요청한 파일 중 하나라도 실패하면 부분 결과를 완성된 인벤토리로 저장하지 않는다.

## 3. 혼자 쓰는 승인 키 등록

앞 단계에서 현재 폴더가 `claude-inventory`이면 아래 첫 명령으로 저장소 안의 `codex-harness` 폴더로 이동한다.

```powershell
Set-Location ..\codex-harness
npm run validate
npm test
npm run check:ssot
```

첫 사용 전에 본인 전자서명 키를 한 번 만든다. 승인자 ID는 본인의 GitHub 로그인으로 지정할 수 있다. 공개 키만 저장소에 추가된다.

```powershell
npm run setup:approver -- --approver your-github-id --key "$env:USERPROFILE\.cit-design-harness\approval-key.pem"
npm run validate
```

개인 키는 사용자 프로필 바깥 저장소에 보관되며 Git에 추가하지 않는다. 생성된 `config/approvers.json`은 공개 키라 private 저장소에 commit한다. 이어서 Codex가 쓸 별도 staging 파일을 준비한다. 원본 파일은 Codex 계정에서 보기 전용이어야 한다.

```powershell
$task = "poster-refresh"
New-Item -ItemType Directory -Force ".\work\$task" | Out-Null
Copy-Item .\work\APPROVAL_TEMPLATE.json ".\work\$task\approval.json"
npm run fingerprint -- ".\work\$task\plan.md"
npm run check:ssot
```

`plan.md`에 목적과 Figma 범위를 적고 `approval.json`에도 동일한 staging 파일, 페이지, 부모, 작업, 노드 범위를 적는다. 승인 JSON 상태는 `pending`으로 둔다. 아래 명령은 plan/현재 SSOT 해시와 승인 시각을 기록하고 본인 개인 키로 서명한다.

```powershell
npm run sign:approval -- --approval "work/$task/approval.json" --plan "work/$task/plan.md" --approver your-github-id --key "$env:USERPROFILE\.cit-design-harness\approval-key.pem"
```

Figma 쓰기 직전에 범위와 서명을 다시 검사한다. plan, SSOT, 범위, 승인 파일이 바뀌거나 24시간이 지나면 차단한다.

```powershell
npm run verify:approval -- --approval "work/$task/approval.json" --plan "work/$task/plan.md" --mode staging --file FILE_KEY --page PAGE_NAME --parent PARENT_NODE_ID --operation use_figma --node NODE_ID
```

개인 키 설정과 로컬 서명 흐름은 [승인 키 설정](approval-key-setup.md)을 따른다. Figma 원본/복제 파일 권한 시험은 [Figma 로컬 점검](figma-access-smoke-test.md)을 따른다.

## 4. 비공개 GitHub에 올리기 전 확인

```powershell
Set-Location ..
npm run preflight
git status --short
git check-ignore -v claude-inventory/.cache/example.json
```

`.cache/`, `out/`, 토큰, 개인 키 파일이 제외되는지 확인한다. 작업 승인 기록은 서명된 업무 이력이므로 의도적으로 private GitHub 저장소에 기록한다. `files.json`에 내부 Figma 파일 식별자가 있으므로 저장소는 비공개로 유지한다. GitHub Pages는 필요하지 않다.

GitHub Actions는 `main` push와 PR에서 Figma 인증정보 없이 preflight를 실행한다. 혼자 운영할 때는 동료 리뷰를 요구하지 않아도 된다. 필요하면 GitHub ruleset에서 `preflight`를 필수 검사로 설정한다. 이 CI는 harness 코드 검사이고 작업별 Figma 승인 서명을 대신하지 않는다.
