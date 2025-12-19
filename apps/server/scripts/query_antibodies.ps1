param(
    [string]$MdbPath = "C:\Users\Room3341\Desktop\MHLabmanagement2023N.mdb"
)

$connectionString = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$MdbPath"
$conn = New-Object System.Data.OleDb.OleDbConnection($connectionString)

try {
    $conn.Open()
    Write-Host "Connected to: $MdbPath" -ForegroundColor Green
    Write-Host ""
    
    # Query antibodies with Tubes count
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT AntibodyID, AntiBodyName, Tubes FROM tblAntibody"
    $reader = $cmd.ExecuteReader()
    
    Write-Host "=== All Antibodies ===" -ForegroundColor Cyan
    $count = 0
    $withTubes = 0
    while ($reader.Read()) {
        $id = $reader["AntibodyID"]
        $name = $reader["AntiBodyName"]
        $tubes = $reader["Tubes"]
        
        $tubesVal = if ($tubes -eq [DBNull]::Value) { "NULL" } else { $tubes }
        
        if ($tubesVal -ne "NULL" -and $tubesVal -gt 0) {
            Write-Host "  ID: $id - $name - Tubes: $tubesVal" -ForegroundColor Yellow
            $withTubes++
        }
        $count++
    }
    $reader.Close()
    
    Write-Host ""
    Write-Host "Total antibodies: $count" -ForegroundColor Green
    Write-Host "Antibodies with Tubes > 0: $withTubes" -ForegroundColor Green
    Write-Host ""
    
    # Count storage entries per antibody
    $cmd2 = $conn.CreateCommand()
    $cmd2.CommandText = "SELECT AntibodyID, COUNT(*) as StorageCount FROM tblStorage GROUP BY AntibodyID"
    $reader2 = $cmd2.ExecuteReader()
    
    Write-Host "=== Storage Counts by Antibody ===" -ForegroundColor Cyan
    $storageCount = 0
    while ($reader2.Read()) {
        $id = $reader2["AntibodyID"]
        $cnt = $reader2["StorageCount"]
        Write-Host "  AntibodyID: $id - Storage entries: $cnt" -ForegroundColor Yellow
        $storageCount++
    }
    $reader2.Close()
    
    Write-Host ""
    Write-Host "Total unique antibodies in storage: $storageCount" -ForegroundColor Green
    
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $conn.Close()
}
