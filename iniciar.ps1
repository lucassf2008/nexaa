# ===================================================================
# NEXA SENAI - Inicializador PowerShell
# ===================================================================
Set-Location -Path $PSScriptRoot
$env:PATH = "C:\Program Files\nodejs;$env:PATH"

Write-Host "===================================================================" -ForegroundColor Red
Write-Host "                    NEXA SENAI - SERVIDOR LOCAL" -ForegroundColor White
Write-Host "       Plataforma de Conexao Profissional do Curso Tecnico SENAI" -ForegroundColor Gray
Write-Host "===================================================================" -ForegroundColor Red
Write-Host ""
Write-Host "[OK] Abrindo navegador em http://localhost:3000..." -ForegroundColor Green
Write-Host "[OK] Iniciando servidor Node.js..." -ForegroundColor Green
Write-Host ""

Start-Process "http://localhost:3000"
node server.js
