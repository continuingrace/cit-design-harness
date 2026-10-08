## 목적

Figma staging 파일에서 무엇이 바뀌는가?

## 검토 범위

- 작업 계획: `codex-harness/work/<작업명>/plan.md`
- 승인 기록: `codex-harness/work/<작업명>/approval.json`
- Figma 파일 키와 페이지:
- staging 파일 (원본과 반드시 분리):
- 부모 노드와 작업 범위:
- 현재 디자인 SSOT SHA-256:

## 안전 확인

- [ ] 이 PR은 원본 Figma 파일의 직접 편집을 승인하지 않는다.
- [ ] 계획과 승인 기록이 동일한 파일·페이지·부모·작업·노드 ID를 명시한다.
- [ ] `npm run preflight`가 통과한다.
- [ ] 작업 승인은 로컬 Ed25519 서명 키로 서명했고 계획/SSOT 해시와 일치한다.
- [ ] 개인 서명 키는 저장소 밖에 있으며 이 PR에 포함되지 않았다.
