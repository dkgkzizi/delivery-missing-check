# 배송 누락 체크 도구

이 폴더는 EasyAdmin에서 다운로드한 두 개의 엑셀 파일을 비교하여 배송 누락/초과를 찾아내는 간단한 Node.js 도구입니다.

## 설치

```powershell
cd "c:\Users\ozkiz\OneDrive\바탕 화면\클로드 코드\배송 마감"
npm install
npx playwright install
```

## 자동 다운로드 + 필터 실행

환경 변수를 설정하고 실행하면 EasyAdmin 로그인부터 엑셀 다운로드, 필터 처리까지 자동화합니다.

```powershell
$env:EASYADMIN_DOMAIN = 'dammom'
$env:EASYADMIN_USER = '김대성'
$env:EASYADMIN_PASS = '!asrornf14'
$env:EASYADMIN_DOWNLOAD_URL = 'https://login2.ezadmin.co.kr/your-download-page'
$env:DOWNLOAD_DIR = 'C:\Users\ozkiz\OneDrive\바탕 화면\클로드 코드\배송 마감\downloads'
npm run download
```

- `EASYADMIN_DOWNLOAD_URL`는 로그인 후 엑셀 다운로드 버튼이 있는 페이지 URL입니다.
- 다운로드 파일은 `downloads` 폴더에 저장됩니다.
- 필터 결과는 `filtered_<filename>.xlsx`로 생성됩니다.

## 사용법

```powershell
node delivery-missing-check.js <planned.xlsx> <shipped.xlsx> [options]
```

### 옵션

- `--key <col1,col2,...>`
  - 비교에 사용할 키 컬럼
  - 기본값: `주문번호,상품코드`
- `--qty <col>`
  - 수량 컬럼 이름
  - 기본값: `수량`
- `--sheet <index>`
  - 읽을 시트 인덱스
  - 기본값: `0`
- `--output <filename>`
  - 결과 CSV 파일 이름
  - 기본값: `delivery_missing_report.csv`
- `--skip-headers <n>`
  - 실제 헤더보다 앞에 타이틀 행이 있는 경우 건너뛸 행 수
  - 기본값: `0`

### 예시

```powershell
node delivery-missing-check.js plan.xls shipped.xls --key "주문번호,상품코드" --qty "수량" --output report.csv
```

## 출력

- `delivery_missing_report.csv`
  - 누락/초과/정상 상태를 포함한 결과 리포트
