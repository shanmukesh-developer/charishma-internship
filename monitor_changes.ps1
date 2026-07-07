# Monitor file changes to catch reversions
$filePath = "delivery-app/src/app/page.tsx"
$lastContent = ""
$changeCount = 0

Write-Host "🔍 Monitoring $filePath for changes..." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop monitoring`n" -ForegroundColor Yellow

while ($true) {
    if (Test-Path $filePath) {
        $currentContent = Get-Content $filePath -Raw
        
        if ($currentContent -ne $lastContent) {
            $changeCount++
            $timestamp = Get-Date -Format "HH:mm:ss.fff"
            
            if ($lastContent -eq "") {
                Write-Host "[$timestamp] ✓ Initial read: $(($currentContent.Length)) bytes" -ForegroundColor Green
            } else {
                $byteDiff = $currentContent.Length - $lastContent.Length
                Write-Host "[$timestamp] ✓ Change #$changeCount detected (+$byteDiff bytes)" -ForegroundColor Cyan
                
                # Show first 100 chars of change
                $diff = Compare-Object ($lastContent.Split("`n")) ($currentContent.Split("`n")) -PassThru | Select-Object -First 3
                if ($diff) {
                    Write-Host "    Changes detected in content" -ForegroundColor Gray
                }
            }
            
            $lastContent = $currentContent
        }
    }
    
    Start-Sleep -Milliseconds 500
}
