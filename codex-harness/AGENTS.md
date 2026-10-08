# CiT Codex 디자인 하네스

## 권한 체계

- 사용자의 현재 요청과 `config/harness-policy.json`을 따른다.
- `config/harness-policy.json`에 적힌 경로에서 살아있는 design SSOT를 읽는다. 다른 컴퓨터나 CI에서는 `CIT_DESIGN_SSOT`가 기본 경로를 덮어쓴다.
- SSOT를 이 하네스 안으로 복사하지 않는다. 설정된 SSOT/인벤토리 루트를 수정하지 않는다.
- 사용자가 명시적으로 그 접근을 승인하지 않는 한, 설정된 인벤토리 루트의 `.cache`를 읽지 않는다.

## Figma 안전 규칙

- 캔버스 조회·쓰기에는 공식 Figma 플러그인을 쓴다. 인벤토리 PAT는 읽기 전용이며 쓰기에 쓰지 않는다.
- Codex는 원본 Figma 파일에 보기 전용 권한만, 별도 AI staging 파일에만 편집 권한을 가져야 한다. 원본 파일 안의 페이지 하나로는 충분한 권한 경계가 아니다.
- 기본값은 `AI_CODEX__<작업명>` 이름의 별도 staging 파일이다. 작업 승인이 있어도 Codex는 원본 파일에 절대 쓰지 않는다.
- 사람이 정확한 차이를 검토한 뒤 승인된 staging 결과를 원본에 적용한다.
- 주 에이전트만 Figma에 쓸 수 있다. 같은 대상에 Figma 작성자를 병렬로 실행하지 않는다.
- 쓰기 후에는 스크린샷을 남기고 완료 보고 전에 읽기 전용 감사를 실행한다.
- 각 staging 파일 쓰기 전에 `config/approvers.json`에 등록된 활성 Ed25519 키로 서명한 작업 `approval.json`을 요구한다. 정확한 대상과 범위로 `npm run verify:approval`을 실행한다. 하나라도 어긋나면 멈춘다. 개인 서명 키는 저장소 밖에 둔다. 이 검사는 Figma 도구 호출 자체를 가로채지 못한다 — Figma 파일 권한이 원본 경계를 강제한다.
- 같은 단계가 같은 대상에서 두 번째로 실패하면 세 번째 시도를 하지 않고 멈춘 뒤 보고한다. 재서명을 반복해서 실패를 덮지 않는다. 중단 후 재개할 때는 `work/<작업명>/plan.md`의 "중단·재개 기록"을 먼저 읽는다. 자세한 절차는 [`write-gates.md`](.agents/skills/cit-figma-design/references/write-gates.md)를 따른다.

## 작업 흐름

- Figma 제작·수정에는 `$cit-figma-design`을 쓴다.
- 읽기 전용 검수에는 `$cit-design-audit`을 쓴다.
- 조사 → 계약 → 제작 → 검증 → 보고의 5단계로 작업한다.
- 살아있는 SSOT가 확정으로 표시하지 않은 빈도 기반 인벤토리 값은 후보로 취급한다.
- 대상, 권한, 현재 작성자, 복구 경로가 불확실하면 멈춘다.

## 에이전트

- 주 에이전트가 유일한 Figma 작성자이자 진행자다.
- `cit_design_auditor`는 읽기 전용이며 독립 검증을 위임받을 수 있다.
- 병렬 변경 작업을 위임하지 않는다.

## 패키지 매니저

- 로컬 검증 스크립트 실행에만 npm을 쓴다. 패키지 설치는 필요 없다.

## 파일별 명령

| 작업 | 명령 |
|---|---|
| 하네스 검증 | `npm run validate` |
| 안전 게이트 테스트 | `npm test` |
| SSOT 지문 확인 | `npm run check:ssot` |

## 커밋 귀속

- AI가 만든 커밋에는 그 AI 고유의 `Co-Authored-By` 귀속을 포함한다.
