@echo off
rem PDF Bookmark Workspace - single-command launcher (Windows).
rem
rem Builds the frontend when needed, starts the backend (which serves both
rem the API and the built frontend on one port) and opens the app in the
rem browser. Runs in the foreground so logs and the app URL stay visible.
rem
rem Usage:
rem   bookmark.bat              start with defaults (port 8000)
rem   bookmark.bat --port 8123  use another port
rem   bookmark.bat --no-open    do not open the browser automatically
rem   bookmark.bat --rebuild    rebuild the frontend even if dist exists
rem   bookmark.bat --help       show this help
rem
rem Environment: BOOKMARK_PORT, BOOKMARK_WEB_DIST (frontend build directory).

setlocal

set "ROOT=%~dp0"
set "PORT=8000"
set "OPEN_BROWSER=1"
set "REBUILD=0"
set "WEB_DIST=%ROOT%web\dist"
if defined BOOKMARK_PORT set "PORT=%BOOKMARK_PORT%"
if defined BOOKMARK_WEB_DIST set "WEB_DIST=%BOOKMARK_WEB_DIST%"

:parse
if "%~1"=="" goto parsed
if /i "%~1"=="--port" (
  if "%~2"=="" (
    echo Missing value for --port.
    exit /b 1
  )
  set "PORT=%~2"
  shift
  shift
  goto parse
)
if /i "%~1"=="--no-open" (
  set "OPEN_BROWSER=0"
  shift
  goto parse
)
if /i "%~1"=="--rebuild" (
  set "REBUILD=1"
  shift
  goto parse
)
if /i "%~1"=="--help" (
  call :usage
  exit /b 0
)
echo Unknown option: %~1 ^(try --help^)
exit /b 1
:parsed

where uv >nul 2>&1
if errorlevel 1 (
  echo uv is required ^(https://docs.astral.sh/uv/^). Install it first.
  exit /b 1
)
where npm >nul 2>&1
if errorlevel 1 (
  echo npm is required to build the frontend. Install Node.js first.
  exit /b 1
)

rem Refuse to start on a port that is already in use.
netstat -an | findstr /R /C:":%PORT% " | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo Port %PORT% is already in use. Pick another one with --port.
  exit /b 1
)

if "%REBUILD%"=="1" goto build
if not exist "%WEB_DIST%\index.html" goto build
goto built

:build
echo == Building frontend (web/dist) ==
pushd "%ROOT%web"
call npm install
if errorlevel 1 exit /b 1
call npm run build
if errorlevel 1 exit /b 1
popd

:built
set "URL=http://127.0.0.1:%PORT%"

echo.
echo   PDF Bookmark Workspace
echo   URL: %URL%
echo   Press Ctrl+C to stop.
echo.

if "%OPEN_BROWSER%"=="1" (
  rem Open the browser once the server is reachable, without blocking startup.
  start "" /b powershell -NoProfile -ExecutionPolicy Bypass -Command "$u='%URL%';for($i=0;$i -lt 60;$i++){try{Invoke-WebRequest -UseBasicParsing -Uri $u/api/health -TimeoutSec 2|Out-Null;break}catch{Start-Sleep -Milliseconds 500}};Start-Process $u" >nul 2>&1
)

pushd "%ROOT%server"
uv run uvicorn bookmark_server.main:app --host 127.0.0.1 --port %PORT%
popd

exit /b 0

:usage
echo PDF Bookmark Workspace - single-command launcher ^(Windows^).
echo.
echo Builds the frontend when needed, starts the backend ^(API + web UI on
echo one port^) and opens the app in the browser. Runs in the foreground.
echo.
echo Usage:
echo   bookmark.bat              start with defaults ^(port 8000^)
echo   bookmark.bat --port 8123  use another port
echo   bookmark.bat --no-open    do not open the browser automatically
echo   bookmark.bat --rebuild    rebuild the frontend even if dist exists
echo   bookmark.bat --help       show this help
exit /b 0
