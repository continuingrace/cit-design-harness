# 이 폴더를 다른 AI 도구와 함께 쓸 때

> **이 문서는 공개 데모입니다.** 실제 운영에서 이 폴더를 인수인계할 때 무엇을 다른 에이전트에게
> 알려야 하는지 보여주는 예시이며, 아래에는 실제 경로·조직명·Figma 식별자가 들어 있지 않습니다.
> 현재 구조와 절차는 저장소 루트 `README.md`, `docs/architecture.md`, `docs/getting-started.md`를
> 따릅니다.

`claude-inventory/`

디자인 언어 SSOT와 Figma 읽기 전용 인벤토리 스캐너가 있는 폴더입니다.
Codex 등 다른 에이전트가 이 폴더를 볼 때의 규칙입니다.

---

## 원칙 — 읽기는 공유, 쓰기는 한 주인

같은 파일을 둘이 고치면 갈라집니다. 그래서:

| 파일 | 역할 | 쓰기 권한 |
|---|---|---|
| `design-language.md` | **SSOT.** 디자인 규칙의 유일한 원본 | Claude |
| `out/inventory-report.md` | 스캔 결과 리포트 | 스캐너가 생성 |
| `out/inventory.json` | 스캔 집계 원본 | 스캐너가 생성 |
| `figma-inventory.mjs` | 스캐너 도구 | Claude |
| `files.json` | 스캔 대상 파일 목록 (실제 운영에서는 조직의 Figma 파일 키가 들어가므로 비공개로 유지한다) | 공동 (추가만) |
| `.cache/*.json` | Figma 원본 응답 캐시 | 스캐너가 생성 |

**다른 에이전트는 위 파일을 읽어서 자기 하네스에 반영합니다. 고치지 않습니다.**
고쳐야 할 내용이 있으면 사람에게 말하고, 사람이 SSOT 주인에게 전달합니다.

---

## 규칙은 한 곳에만 — 복사하지 말 것

Codex 하네스가 `design-language.md`의 내용을 **자기 폴더에 복사해 두면 그 순간 SSOT가 둘이 됩니다.**
한쪽만 갱신되면 갈라지고, 어느 쪽이 맞는지 아무도 모르게 됩니다.

올바른 방법: Codex 하네스는 자기 폴더에 두되, 규칙은 **이 파일을 경로로 참조**합니다
(복사하지 않고, 작업 시작 시 읽습니다).

---

## 공유 전에 알아야 할 것 (실제 운영 시 체크리스트)

**① `.cache/`에는 Figma 원본 전체 구조가 들어갈 수 있다**

텍스트 내용, 레이어 이름, 좌표가 전부 들어갑니다. 자격증명은 없지만 조직의 디자인 자산이므로,
폴더를 통째로 공유할 때 이것도 함께 읽힌다는 걸 알고 있어야 합니다. 읽힐 필요가 없다면
다른 에이전트에게는 `.cache`를 제외하고 공유합니다. (`.gitignore`로 Git에서도 제외됩니다.)

**② 토큰은 이 폴더에 없다**

`FIGMA_TOKEN`은 환경변수로만 씁니다. 파일에 적지 않습니다.

**③ 원격 저장소에 올리기 전에 공개 범위부터 확인할 것**

실제 운영 중인 `files.json`·`design-language.md`·인벤토리 산출물에는 조직의 Figma 파일 키,
노드 ID, 실측 캠페인 데이터가 들어갈 수 있습니다. 공개 저장소에는 올리지 않습니다 —
이 공개 데모 저장소는 그 부분을 전부 가상 예시값으로 대체한 버전입니다.

---

## 스캐너 재실행

```powershell
Set-Location .\claude-inventory
$secureToken = Read-Host "Figma 읽기 전용 토큰" -AsSecureString
$env:FIGMA_TOKEN = [System.Net.NetworkCredential]::new("", $secureToken).Password
node figma-inventory.mjs
Remove-Item Env:FIGMA_TOKEN
```

Figma는 **읽기만** 합니다. HTTP GET 외의 요청이 코드상 불가능하고, 원본을 열거나 바꾸지 않습니다.

## Figma 쓰기 세션 — 다섯 축 전부 지정해야 열린다

`block-figma-write.mjs` (PreToolUse 훅)이 막습니다. 하나라도 비면 차단입니다 (fail-closed).

```powershell
$env:FIGMA_MODE      = "staging"      # staging(새로 만들기) | edit(원본 수정)
$env:FIGMA_WRITE     = "1"
$env:FIGMA_WRITE_FILE   = "<fileKey>"    # 이 파일만
$env:FIGMA_WRITE_NODE   = "<nodeId>[,…]" # 이 노드만
$env:FIGMA_WRITE_OPS    = "<도구이름>[,…]" # 이 작업만
$env:FIGMA_WRITE_PARENT = "<부모 노드>"    # staging: 이 아래에만 · 새 파일이면 "new-file"
```

**왜 부모까지 묶는가** — 파일만 묶으면 승인된 파일 *안 아무 페이지에나* 프레임이 생길 수 있습니다.
staging 모드는 요청이 노드를 반드시 가리켜야 하고, 그 노드는 부모(`FIGMA_WRITE_PARENT`) 또는
승인 노드(`FIGMA_WRITE_NODE`) 안에 있어야 합니다.

**검수(preflight)는 이 변수들을 켜지 않은 세션에서 돌립니다.** 자기가 만든 걸 자기가 채점하지
않기 위해서입니다. 변수가 없으면 훅이 모든 쓰기를 막으므로 실효는 같습니다.

회귀 테스트: `node test-block-figma-write.mjs`
