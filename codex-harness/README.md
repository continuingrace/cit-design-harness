# CiT Codex 디자인 하네스

Claude가 관리하는 디자인 언어 SSOT를 읽어 Codex가 Figma staging 산출물을 만들고 독립 검수하는 하네스다.

기본 SSOT 경로는 저장소 상대 경로다. 다른 컴퓨터에서 위치가 다를 때만 `CIT_DESIGN_SSOT`와 `CIT_DESIGN_INVENTORY_ROOT`를 세션 환경변수로 지정한다. 경로 값을 저장소에 하드코딩하지 않는다.

## 안전 경계

- 디자인 규칙의 SSOT는 저장소의 `../claude-inventory/design-language.md`다. Codex는 읽기만 한다.
- Figma 원본 파일은 Codex 계정에 보기 전용 권한만 준다. Codex는 별도의 `AI_CODEX__<작업명>` 파일에만 쓴다.
- Codex가 만든 staging 결과는 사람이 검토하고 원본에 적용한다. 승인 기록이 있어도 Codex가 원본에 직접 쓰지 않는다.
- staging 쓰기는 등록된 Ed25519 개인 키로 작업 범위에 서명한다. 승인자 ID 문자열만으로는 통과하지 않는다.
- Figma 제작은 공식 Figma 플러그인을 사용한다. 인벤토리 PAT는 읽기 전용이며 쓰기에 사용하지 않는다.
- 제작은 주 에이전트 한 명만 수행하고 감사 에이전트는 읽기만 한다.

## 검사

```powershell
npm run validate
npm test
npm run check:ssot
```

Node.js 18 이상이 필요하다. 의존성 설치는 없다.

## 1인 승인 키 등록

```powershell
npm run setup:approver -- --approver your-github-id --key "$env:USERPROFILE\.cit-design-harness\approval-key.pem"
npm run validate
```

개인 키는 사용자 프로필에 만들고 공개 키만 `config/approvers.json`에 저장한다. 개인 키는 백업하되 저장소에 넣지 않는다.

## staging 작업 승인

```powershell
$task = "poster-refresh"
New-Item -ItemType Directory -Force ".\work\$task" | Out-Null
Copy-Item .\work\APPROVAL_TEMPLATE.json ".\work\$task\approval.json"
npm run fingerprint -- ".\work\$task\plan.md"
npm run check:ssot
```

계획과 승인 JSON에 staging 파일, 페이지, 부모, 작업, 노드 범위를 동일하게 기록한다. 승인 JSON을 `pending` 상태로 둔 채 본인 키로 서명한다.

```powershell
npm run sign:approval -- --approval "work/$task/approval.json" --plan "work/$task/plan.md" --approver your-github-id --key "$env:USERPROFILE\.cit-design-harness\approval-key.pem"
npm run verify:approval -- --approval "work/$task/approval.json" --plan "work/$task/plan.md" --mode staging --file FILE_KEY --page PAGE_NAME --parent PARENT_NODE_ID --operation use_figma --node NODE_ID
```

검증기는 Ed25519 서명, 유효기간, 계획/SSOT 해시와 대상 범위를 검사한다. 하나라도 바뀌면 승인 파일을 `pending`으로 되돌리고 다시 서명한다. 키 보관 지침은 [1인 운영 안내](../docs/approval-key-setup.md), Figma 권한 점검은 [로컬 smoke test](../docs/figma-access-smoke-test.md)를 참고한다.

## 프로젝트 스킬

- `.agents/skills/cit-figma-design`: staging 제작 절차
- `.agents/skills/cit-design-audit`: 읽기 전용 디자인 검수
- `.codex/agents/cit-design-auditor.toml`: 프로젝트 전용 감사자 설정

`uibowl` MCP는 필수 의존성이 아니다. 레퍼런스 검색의 실제 사용 빈도와 품질을 검증한 후 별도 스킬로 추가한다.
