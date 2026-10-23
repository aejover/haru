@echo off
chcp 65001 >nul
cd /d "%~dp0"
title 하루
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js가 필요해요. https://nodejs.org 에서 설치한 뒤 다시 실행하세요.
  pause
  exit /b 1
)
if not exist "node_modules\@anthropic-ai\sdk" (
  echo 처음 실행: 필요한 파일을 설치하는 중...
  call npm install --no-audit --no-fund
)
if not exist data mkdir data

set LAST=1
if exist "data\phone-mode.txt" set /p LAST=<"data\phone-mode.txt"
echo.
echo   어디에서 하루를 쓸까요?
echo     [1] 이 컴퓨터에서만
echo     [2] 같은 Wi-Fi의 휴대폰에서도  (간단, 녹음·앱 설치는 안 됨)
echo     [3] 어디서나 휴대폰으로 - Tailscale  (추천)
echo.
choice /c 123 /n /t 8 /d %LAST% /m "  번호를 누르세요 (8초 뒤 %LAST%번으로 시작): "
set PICK=%errorlevel%
> "data\phone-mode.txt" echo %PICK%

set PHONE=local
if "%PICK%"=="2" set PHONE=lan
if "%PICK%"=="3" set PHONE=tailscale
if "%PHONE%"=="lan" (
  echo.
  echo   주의: 같은 Wi-Fi에 있는 사람은 누구나 주소를 알면 기록을 볼 수 있어요.
  echo   Windows 방화벽 창이 뜨면 "개인 네트워크" 허용을 눌러 주세요.
)

start "" http://localhost:5500
node server.js
pause
