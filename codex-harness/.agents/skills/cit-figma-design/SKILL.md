---
name: cit-figma-design
description: CiT Figma staging 디자인을 제작한다. 살아있는 design-language SSOT를 읽고, staging 쓰기 전에 로컬 Ed25519 승인을 요구한다.
---

# CiT Figma Design

Figma staging 제작과 반복 작업에 이 스킬을 쓴다. 원본 Figma 파일의 직접 편집은 이 스킬이 승인하지 않는다.

## 필요한 입력

- 의도한 결과와 채널
- 정확한 별도 staging 파일과 페이지 또는 노드
- 읽기 전용으로 참고할 원본 파일(관련 있을 때)

## 작업 순서

1. `config/harness-policy.json`을 읽는다.
2. 거기 적힌 경로의 살아있는 SSOT를 읽는다. 복사하지 않는다. 확정되지 않은 값은 후보로 취급한다.
3. 계획을 세우기 전에 정확한 Figma 대상을 조회하고 스크린샷을 확보한다.
4. `work/WORK_ORDER.md`를 바탕으로 범위, 대상, 작성자, 보존 방법, 완료 기준을 작업 기록에 남긴다. 계획과 `work/APPROVAL_TEMPLATE.json`의 작업별 사본을 저장한다.
5. 적절한 경우 기존 컴포넌트, 스타일, 변수, 확정 템플릿을 재사용한다.
6. Codex는 별도 AI staging 파일에만 쓸 수 있고, 원본에는 절대 쓰지 않는다. Figma에서 Codex 계정이 원본은 보기 전용, staging 파일은 편집 가능하도록 설정돼 있는지 확인한다. 원본 파일 안의 페이지 하나로는 경계가 되지 않는다.
7. `work/작업명/plan.md`와 `work/작업명/approval.json`에 정확한 staging 파일, 페이지, 부모, 작업, 노드 ID를 적는다. 사용자가 계획을 검토하고 `npm run sign:approval`로 본인의 등록된 로컬 키로 서명하기 전까지는 `pending` 상태로 둔다. 이 명령은 계획과 현재 SSOT 해시를 함께 기록한다.
8. 각 Figma 쓰기 직전에 `npm run verify:approval -- --approval work/작업명/approval.json --plan work/작업명/plan.md --mode staging --file FILE_KEY --page PAGE_NAME --parent PARENT_NODE_ID --operation use_figma --node NODE_ID`를 예시값을 실제 승인된 값으로 바꿔 실행한다. 서명, 시각, 해시, 범위가 전부 통과하지 않으면 멈춘다. 입력이 하나라도 바뀌면 다시 서명해야 한다.
9. 공식 Figma 쓰기 도구를 쓰기 전에 공식 `figma-use` 안내를 먼저 읽는다.
10. 주 에이전트만 작성자로 유지한다. Figma 변경을 다른 에이전트에 위임하지 않는다.
11. 결과를 기록하고 완료 전에 `$cit-design-audit` 또는 `cit_design_auditor`를 호출한다.
12. 사람이 staging 결과를 검토하고, 받아들여진 변경을 원본에 직접 적용한다.

## 중단 조건

대상을 확인할 수 없거나, 다른 작성자가 활성 상태이거나, 승인이 모호하거나, SSOT를 읽을 수 없거나, 원본 보존이 불가능하면 쓰지 않고 멈춘다.

## 실패 반복과 재개

같은 단계(승인 검증, Figma 쓰기, 검증 읽기)가 같은 대상에서 **두 번째로 실패**하면 세 번째 시도를 하지 않고 멈춘 뒤 사용자에게 보고한다. 재서명을 반복해서 실패를 덮지 않는다. 자세한 복귀·반복 제한 절차는 [references/write-gates.md](references/write-gates.md)의 "실패 시 복귀와 반복 제한"을 따른다.

작업이 중단된 뒤 다시 시작할 때는 `work/작업명/plan.md`의 "중단·재개 기록"을 먼저 읽고, 이미 완료된 쓰기와 이미 받은 승인을 다시 만들거나 다시 요청하지 않는다.

기존 원본 변경이나 정책에서 별도로 게이트를 요구하는 작업 전에는 [references/write-gates.md](references/write-gates.md)를 읽는다.
