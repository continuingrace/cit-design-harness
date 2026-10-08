# Claude와 Codex의 책임 구분

이 문서는 이 저장소 안의 두 하네스를 비교한다. 별도의 RE webapp 하네스는 다루지 않는다.

| 구분 | Claude (`../claude-inventory/`) | Codex (`./`) |
|---|---|---|
| 디자인 규칙 | `design-language.md`와 그 기계 판정 사본 `spec.json`을 소유 | 같은 SSOT를 읽기만 한다. 복사·수정하지 않는다 |
| Figma 인벤토리 | 읽기 전용 REST 스캐너로 지정된 CiT 파일을 읽는다 | 공식 Figma 플러그인으로 요청된 대상을 조회한다 |
| 디자인 제작 | palette/route 스킬 + Claude 도구 훅 | `cit-figma-design` 스킬 + 로컬 Ed25519 서명 승인 |
| 독립 검수 | `preflight` 스킬 | `cit-design-audit` 스킬과 읽기 전용 감사 에이전트 |
| 생성 데이터 | `.cache/`와 `out/`, Git 제외 | 작업 계획과 승인 JSON은 서명 후 비공개 저장소에 commit |
| 쓰기 경계 | Claude `PreToolUse` 훅이 기본적으로 쓰기를 차단 | Figma가 Codex 계정에 원본은 보기 전용, 별도 staging 파일만 편집 가능하게 권한을 나눔 |

## 공통 규칙

- `design-language.md`가 사람이 읽는 기준 원본이다. `spec.json`은 Claude 스캐너가 읽는 기계 판정 사본이다.
- Codex는 `config/harness-policy.json`에 지정된 경로로 같은 파일을 읽고, 현재 SHA-256을 서명된 작업 승인 기록과 대조한다.
- 도구별 작업 절차 파일은 분리해 둔다. 디자인 규칙의 두 번째 사본을 만들지 않는다.
- 두 흐름 모두 원본 Figma 작업을 보존하고, 대상과 범위를 명시하며, 완료 보고 전에 읽기 전용 검수를 요구한다.

## 안전 한계

Claude 훅은 Claude의 Figma 도구 호출에 연결되어 있다. Codex는 로컬 Ed25519 승인 서명과 요청 범위를 검사하지만, 이것은 호스트 수준의 도구 샌드박스가 아니다. 이 CLI 서명 절차를 건너뛴 직접 호출도 Codex의 Figma 계정이 편집 권한을 가진 파일에는 여전히 쓸 수 있다 — 그래서 원본 파일은 반드시 보기 전용으로 설정해야 한다. 자세한 내용은 [저장소 구조 안내](../../docs/architecture.md)를 참고한다.
