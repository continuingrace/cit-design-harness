# 하네스 구조와 소유권

## 저장소 하나, 도구별 하네스 두 개

```text
사람이 승인한 디자인 기준
          │
          ▼
claude-inventory/design-language.md  ← 사람이 읽는 기준 원본(SSOT)
          │ 검토된 버전 연결
          ▼
claude-inventory/spec.json          ← 기계가 읽는 스캔 규칙
          │
          ├── Claude: Figma 읽기 전용 인벤토리 + 쓰기 사전 훅
          │
          └── Codex: 읽기 전용 디자인 기준 + 작업별 승인 검사
```

Claude의 Figma 인벤토리·쓰기 훅과 Codex의 Figma 제작·검수 절차는 실행 환경이 다르므로 하네스는 분리한다. 두 하네스는 디자인 기준 파일과 Git 저장소를 공유하지만 도구 권한은 공유하지 않는다.

## 파일별 책임

| 대상 | 담당 | 수정 권한 | 용도 |
|---|---|---|---|
| `claude-inventory/design-language.md` | CiT 디자인 담당자 | 담당자 검토 후 수정 | 확정된 디자인 규칙, 근거, 변경 이력 |
| `claude-inventory/spec.json` | Claude 인벤토리 담당자 | SSOT 변경과 함께 수정 | 스캐너가 읽는 규칙 사본 |
| `claude-inventory/files.json` | CiT 디자인 담당자 | 담당자 | 스캔 대상 Figma 파일 키. 실제 조직 키를 채운 운영 환경에서는 저장소를 비공개로 유지 |
| `codex-harness/config/harness-policy.json` | CiT 하네스 담당자 | 하네스 관리 담당자 | Codex 읽기/쓰기 경계와 승인 유효기간 |
| `codex-harness/config/approvers.json` | 하네스 담당자 | 공개 키 등록·폐기 | 서명 검증용 공개 키. 개인 키는 사용자 프로필 밖에 보관 |
| `codex-harness/work/<작업>/approval.json` | CiT 하네스 담당자 | 개인 키로 서명 | 승인 범위, 계획/SSOT 지문, 서명 |
| `.cache/`, `out/` | 로컬 실행 | 도구 | 생성 데이터. Git 제외 |

확정된 디자인 규칙을 바꾸면 사람이 읽는 SSOT와 `spec.json`을 함께 수정한다. Claude의 `npm run check`는 두 파일이 같은 버전을 가리키는지 확인한다. 저장소 루트의 `npm run preflight`는 저장소 간 버전과 기본 SSOT 경로도 검사한다.

## Figma 쓰기 경계

- `figma-inventory.mjs`는 Figma HTTP GET만 사용한다. 생성 결과는 `.cache/`와 `out/`에 저장한다.
- Claude의 `block-figma-write.mjs`는 `PreToolUse` 훅으로 기본 쓰기를 차단한다. 쓰기 환경변수가 지정되면 파일, 노드, 작업, 부모를 확인한다.
- Codex는 원본 파일에 쓰지 않는다. Figma에서 Codex에 원본은 보기 전용, 별도 AI 스테이징 파일은 편집 가능으로 권한을 나눈다. 스테이징 결과를 원본에 반영하는 일은 사람이 직접 검토한 뒤 수행한다.
- `sign-approval.mjs`는 사용자가 실행한 서명 행위로 승인 범위, 계획/SSOT SHA-256 지문, 시각을 기록하고 등록된 Ed25519 개인 키로 서명한다. `verify-approval.mjs`는 등록 공개 키로 서명과 현재 요청 범위를 검증한다. GitHub 동료나 PR은 필요하지 않다.
- 이 CLI 절차를 건너뛴 Codex 도구 호출 자체는 차단하지 않는다. 원본을 보호하는 경계는 Figma 계정 권한이다. 원본에서 Codex 계정을 보기 전용으로 제한하고 staging 파일만 편집 가능하게 둬야 한다. 같은 계정에 원본 편집 권한이 있으면 로컬 서명이 직접 도구 호출을 막아주지 않는다.
- 개인 키 소유는 서명으로 확인하지만 실제 사람 신원은 운영체제나 회사 인증 시스템이 증명하지 않는다. 키 접근권한을 제한하고, 사용자가 의도적으로 승인 명령을 실행하는 방식으로 1인 승인 기록을 남긴다.
- 정적 코드 검사는 JavaScript의 모든 동적 Figma 대상 지정 방식을 해석하지 않는다. Figma 권한으로 보호할 원본은 직접 수정하지 않는다.

## 데이터 관리

`files.json`에는 조직의 실제 Figma 파일 식별자가 들어갈 수 있다. 인증 토큰은 아니지만 내부 프로젝트 정보이므로, 실제 값을 채운 운영 환경에서는 저장소를 비공개로 유지한다. Figma 응답 캐시에는 전체 문서 내용, 레이어 이름, 위치가 들어갈 수 있어 `.cache/`를 Git에서 제외한다. `out/`은 다시 만들 수 있으므로 Git에서 제외한다. 승인 파일에는 내부 Figma 식별자가 들어갈 수 있으므로 실제 운영에서는 비공개 저장소에만 보관한다. 공개 키는 `config/approvers.json`에 저장할 수 있지만 Figma 토큰과 개인 키는 저장소에 저장하지 않는다.
