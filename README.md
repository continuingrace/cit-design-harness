# CiT 디자인 하네스

CiT의 Claude·Codex 디자인 작업 절차를 한 저장소에서 관리한다. `claude-inventory/`는 디자인 언어 SSOT와 Figma 읽기 전용 인벤토리를 관리한다. `codex-harness/`는 그 SSOT를 읽어 Figma 제작과 독립 검수를 안내한다. 각 파일의 책임과 쓰기 경계는 [구조 안내](docs/architecture.md), Windows 설정과 실행은 [시작 안내](docs/getting-started.md)를 참고한다.

이 저장소는 Figma 디자인 시스템을 지키는 Claude·Codex 하네스의 공개 데모다. `claude-inventory/files.json`·`design-language.md`·`spec.json` 등에 들어 있는 조직명·Figma 파일 키·실측 수치는 전부 가상의 예시값이며, 실제로 운영팀에 맞춰 쓸 때는 그 값들을 채운 저장소를 비공개로 유지하는 것을 권장한다. GitHub Pages를 사용하지 않는다. `.cache/`, `out/`, 토큰, 생성된 Figma 응답은 Git에 올리지 않는다.

## 전체 검사

Node.js 18 이상이 필요하다. 패키지를 설치하지 않아도 되며 저장소 루트에서 아래 한 명령으로 두 하네스의 사전 검사와 테스트를 실행한다. 혼자 운영하는 승인 흐름은 Codex 하네스에서 만든 Ed25519 키로 로컬 서명한다. GitHub 동료나 `gh` 로그인은 필요하지 않다.

```powershell
npm run preflight
```

GitHub Actions는 `main` push와 pull request 때 동일한 검사를 실행한다. 병합 전 필수 조건으로 만들려면 GitHub 브랜치 보호에서 `preflight` 검사를 required status check로 설정한다.

## 개별 점검

```powershell
cd claude-inventory
npm run check
npm run test:write-gate
```

```powershell
cd codex-harness
npm run validate
npm test
npm run check:ssot
```

Codex 하네스는 기본 설정으로 같은 저장소의 Claude SSOT를 읽는다. 별도 로컬 SSOT를 쓸 때만 `CIT_DESIGN_SSOT`를 세션 환경변수로 지정하며, Codex 폴더에 SSOT 사본을 만들지 않는다. Claude 인벤토리 실행에는 권한을 읽기로 제한한 `FIGMA_TOKEN`과 Figma 네트워크 연결이 필요하다.

코드 근거, 점수, 남은 제한은 [검토 보고서](REVIEW.md)에 정리했다.

Codex 승인 키 설정은 [승인 설정 안내](docs/approval-key-setup.md), 실제 Figma 권한 확인은 [로컬 smoke test](docs/figma-access-smoke-test.md)를 참고한다. `main` 브랜치에서 `preflight`를 필수 상태 검사로 지정하는 GitHub 설정은 [GitHub 보호 설정](docs/github-approval-setup.md)을 참고한다. GitHub Actions는 코드 preflight를 자동화할 뿐, 작업 승인을 대신하지 않는다.
