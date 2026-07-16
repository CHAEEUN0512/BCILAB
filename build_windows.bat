@echo off
REM ============================================================
REM  청각 자극 재생기 - Windows 실행파일(.exe) 빌드 스크립트
REM  파이썬(3.10 이상)이 설치된 PC에서 이 파일을 더블클릭하세요.
REM  완료되면 dist\AuditoryStimulusPlayer.exe 가 생깁니다.
REM ============================================================
setlocal
cd /d "%~dp0"

echo [1/3] 필요한 라이브러리 설치 중...
python -m pip install --upgrade pip
python -m pip install PySide6 pyserial pyinstaller
if errorlevel 1 goto :error

echo.
echo [2/3] 실행파일 빌드 중... (수 분 걸릴 수 있습니다)
python -m PyInstaller --noconfirm --clean --windowed --onefile ^
  --name AuditoryStimulusPlayer ^
  --collect-all PySide6 ^
  run_app.py
if errorlevel 1 goto :error

echo.
echo [3/3] 완료!
echo   생성된 파일: dist\AuditoryStimulusPlayer.exe
echo   이 파일을 더블클릭하면 프로그램이 실행됩니다.
echo.
pause
exit /b 0

:error
echo.
echo [오류] 빌드 중 문제가 발생했습니다. 위 메시지를 확인하세요.
echo   - 파이썬이 설치되어 있고 PATH에 등록되어 있는지 확인하세요.
echo   - "python --version" 이 동작하는지 확인하세요.
pause
exit /b 1
