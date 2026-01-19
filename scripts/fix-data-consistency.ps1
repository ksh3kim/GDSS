# PowerShell script to add missing fields to gunpla detail JSON files
# This script adds standardized fields while preserving existing data

$detailsPath = "c:\00_KSH\01_Programming\01_Programming Language\01_HTML\GunList\data\gunpla-details"

# Default fullSpecs based on grade
$gradeDefaults = @{
    "EG"   = @{ partCount = 30; runnerCount = 3; difficulty = "beginner"; mobility = 3; frameType = "none" }
    "HG"   = @{ partCount = 150; runnerCount = 8; difficulty = "beginner"; mobility = 4; frameType = "partial" }
    "RG"   = @{ partCount = 200; runnerCount = 12; difficulty = "intermediate"; mobility = 5; frameType = "full" }
    "MG"   = @{ partCount = 400; runnerCount = 20; difficulty = "intermediate"; mobility = 5; frameType = "full" }
    "MGEX" = @{ partCount = 500; runnerCount = 25; difficulty = "advanced"; mobility = 5; frameType = "full" }
    "PG"   = @{ partCount = 800; runnerCount = 40; difficulty = "advanced"; mobility = 5; frameType = "full" }
    "PGU"  = @{ partCount = 900; runnerCount = 45; difficulty = "advanced"; mobility = 5; frameType = "full" }
    "FM"   = @{ partCount = 300; runnerCount = 15; difficulty = "intermediate"; mobility = 4; frameType = "full" }
    "SD"   = @{ partCount = 40; runnerCount = 4; difficulty = "beginner"; mobility = 2; frameType = "none" }
    "SDCS" = @{ partCount = 50; runnerCount = 4; difficulty = "beginner"; mobility = 2; frameType = "none" }
    "SDEX" = @{ partCount = 35; runnerCount = 3; difficulty = "beginner"; mobility = 2; frameType = "none" }
}

Get-ChildItem "$detailsPath\*.json" | ForEach-Object {
    $file = $_
    $content = Get-Content $file.FullName -Raw -Encoding UTF8
    $json = $content | ConvertFrom-Json
    
    $modified = $false
    
    # Add manufacturer if missing
    if (-not $json.manufacturer) {
        $json | Add-Member -NotePropertyName "manufacturer" -NotePropertyValue @{ ko = "Unknown"; en = "Unknown" } -Force
        $modified = $true
    }
    
    # Add releaseLine if missing
    if (-not $json.releaseLine) {
        $json | Add-Member -NotePropertyName "releaseLine" -NotePropertyValue "standard" -Force
        $modified = $true
    }
    
    # Add isRevive if missing
    if ($null -eq $json.isRevive) {
        $isRevive = $json.id -match "revive"
        $json | Add-Member -NotePropertyName "isRevive" -NotePropertyValue $isRevive -Force
        $modified = $true
    }
    
    # Add isVerKa if missing
    if ($null -eq $json.isVerKa) {
        $isVerKa = $json.id -match "verka|ver-ka"
        $json | Add-Member -NotePropertyName "isVerKa" -NotePropertyValue $isVerKa -Force
        $modified = $true
    }
    
    # Add images if missing
    if (-not $json.images) {
        $boxartId = $json.id
        $json | Add-Member -NotePropertyName "images" -NotePropertyValue @{
            boxart  = "https://gunpla.fyi/images/boxarts/$boxartId"
            gallery = @()
        } -Force
        $modified = $true
    }
    
    # Add fullSpecs if missing
    if (-not $json.fullSpecs) {
        $grade = $json.grade
        $defaults = $gradeDefaults[$grade]
        if (-not $defaults) { $defaults = $gradeDefaults["HG"] }
        
        $json | Add-Member -NotePropertyName "fullSpecs" -NotePropertyValue @{
            partCount        = $defaults.partCount
            runnerCount      = $defaults.runnerCount
            runnerColors     = 5
            frameType        = $defaults.frameType
            spareParts       = "few"
            sealDependency   = "partial"
            clearParts       = "none"
            coatingParts     = $false
            eyeExpression    = "sticker"
            paintSuitability = "partial"
            difficulty       = $defaults.difficulty
            mobility         = $defaults.mobility
            colorSeparation  = "high"
            decalType        = @("sticker")
            weaponCount      = "standard"
            transformation   = $false
            combination      = $false
            sizeFeeling      = "normal"
            recommendedUser  = @("beginner")
        } -Force
        $modified = $true
    }
    
    # Add pros if missing
    if (-not $json.pros) {
        $json | Add-Member -NotePropertyName "pros" -NotePropertyValue @{
            ko = @("Good color separation", "Decent articulation", "Reasonable price")
            en = @("Good color separation", "Decent articulation", "Reasonable price")
        } -Force
        $modified = $true
    }
    
    # Add cons if missing
    if (-not $json.cons) {
        $json | Add-Member -NotePropertyName "cons" -NotePropertyValue @{
            ko = @("Some sticker dependency")
            en = @("Some sticker dependency")
        } -Force
        $modified = $true
    }
    
    # Update lastUpdated
    $json.lastUpdated = "2026-01-19"
    
    if ($modified) {
        $json | ConvertTo-Json -Depth 10 | Set-Content $file.FullName -Encoding UTF8
        Write-Output "Updated: $($file.Name)"
    }
}

Write-Output "Batch update complete!"
