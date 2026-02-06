# Cleanup script for Microsoft Store preparation
# Removes build artifacts and unnecessary files

Write-Host "Cleaning up project directory..." -ForegroundColor Green

# Remove build artifacts
Write-Host "Removing build artifacts..." -ForegroundColor Yellow
Remove-Item -Path "dist" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "build" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "out" -Recurse -Force -ErrorAction SilentlyContinue

# Remove Electron build artifacts from root
Write-Host "Removing Electron build artifacts..." -ForegroundColor Yellow
$artifacts = @(
    "*.exe",
    "*.dll",
    "*.pak",
    "*.dat",
    "*.bin",
    "*.json",
    "*.html",
    "locales",
    "resources",
    "LICENSE.electron.txt",
    "LICENSES.chromium.html",
    "Uninstall*.exe",
    "uninstallerIcon.ico",
    "builder-debug.yml",
    "builder-effective-config.yaml",
    "vk_swiftshader_icd.json"
)

foreach ($pattern in $artifacts) {
    Get-ChildItem -Path . -Filter $pattern -Recurse -ErrorAction SilentlyContinue | 
        Where-Object { $_.FullName -notlike "*node_modules*" -and $_.FullName -notlike "*.asar*" } |
        Remove-Item -Force -ErrorAction SilentlyContinue
}

# Remove node_modules if requested (commented out by default)
# Write-Host "Removing node_modules..." -ForegroundColor Yellow
# Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "Cleanup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "1. Update package.json with your publisher information" -ForegroundColor White
Write-Host "2. Run: npm install" -ForegroundColor White
Write-Host "3. Run: npm run build:msix" -ForegroundColor White
Write-Host "4. Follow STORE_SUBMISSION.md for submission process" -ForegroundColor White

