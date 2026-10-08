# Claude CiT 인벤토리 하네스

Claude 소유의 디자인 규칙 원본과 Figma 읽기 전용 인벤토리 도구다. 이 폴더의 `design-language.md`가 사람이 확인하는 기준 문서이고, `spec.json`은 스캐너가 읽는 기계 판정본이다. 규칙을 바꾸면 두 파일을 함께 수정하고 `npm run check`로 버전 일치를 확인한다.

## 책임과 경계

- `design-language.md`: 승인된 디자인 기준과 근거. Codex는 읽기만 한다.
- `spec.json`: 같은 기준을 스캐너가 읽는 구조화 규칙.
- `files.json`: 읽을 Figma 파일 목록과 파일 키.
- `figma-inventory.mjs`: HTTP GET만 사용해 Figma 데이터를 읽고 `out/`에 리포트를 생성한다.
- `block-figma-write.mjs`: Claude 세션의 Figma 쓰기 도구 호출을 기본 차단하고 승인 범위를 확인한다.
- `skills/`, `hooks/`: Claude 작업 절차와 자동 점검 설정.
- `guide/`: 과거 작업 자료. 현재 작업 범위나 승인을 정의하지 않는다. 새 작업은 현재 요청과 SSOT로 시작한다.

저장소 루트의 [`docs/architecture.md`](../docs/architecture.md)에서 Codex와의 관계, 기준 파일, 쓰기 경계를 확인한다.

## 실행 전 확인

Node.js 18 이상이 필요하며 외부 패키지 설치는 없다.

```powershell
npm run check
npm run test:write-gate
```

## 읽기 전용 인벤토리 실행

`FIGMA_TOKEN`은 File content `Read`만 허용한 개인 액세스 토큰이어야 한다. 토큰 만료일은 회사 보안 정책에 맞춰 설정한다. 파일에 토큰을 저장하거나 명령 인수에 붙여넣지 않는다.

```powershell
$secureToken = Read-Host "Figma read-only token" -AsSecureString
$env:FIGMA_TOKEN = [System.Net.NetworkCredential]::new("", $secureToken).Password
node figma-inventory.mjs
Remove-Item Env:FIGMA_TOKEN
```

```bash
read -s FIGMA_TOKEN
export FIGMA_TOKEN
node figma-inventory.mjs
unset FIGMA_TOKEN
```

`.cache/`는 Figma 원본 응답을 보관하고 `out/`은 재생성 가능한 결과를 보관한다. 둘 다 Git 제외 대상이다. 스캔 실패 시 부분 결과를 성공 리포트로 덮어쓰지 않는다.

옵션:

```text
node figma-inventory.mjs --file <files.json의 팀 이름>
node figma-inventory.mjs --refetch
node figma-inventory.mjs --all
```

## 규칙 수정과 결과 읽기

`design-language.md`에서 사람이 규칙과 근거를 확정한 뒤 `spec.json`에 같은 버전을 반영한다. 스캐너 기준은 `spec.json`에 둔다. 검사 허용오차와 디자인 목표를 혼동하지 말고, 근거가 부족한 영문 대문자 라벨 자간은 현재 판정 대상이 아니다.

주요 결과는 `out/inventory-report.md`와 `out/inventory.json`이다. 프레임 이름 분석은 `out/dupname-analysis.json`, 심층 비교는 `out/dupname-deep-compare.json`에 생성된다. 생성 파일은 재생성 가능하며 커밋하지 않는다.

## 오류 확인

- `403`: 계정 파일 접근 권한, 토큰 스코프와 만료 설정을 확인한다.
- `404`: `files.json`의 파일 키가 실제 Figma URL과 일치하는지 확인한다.
- 네트워크 오류 또는 일부 파일 실패: 실행이 중단된다. 기존 리포트를 새 결과로 간주하지 말고 연결 상태를 확인한 뒤 다시 실행한다.
- 스캔 결과가 의심스러움: 리포트 수치만으로 기준을 바꾸지 말고 Figma 실물과 `design-language.md` 근거를 확인한다.
