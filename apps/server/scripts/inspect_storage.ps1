param(
    [string]$MdbPath = "C:\Users\Room3341\Desktop\MHLabmanagement2023N.mdb"
)

$connectionString = "Provider=Microsoft.ACE.OLEDB.12.0;Data Source=$MdbPath"
$conn = New-Object System.Data.OleDb.OleDbConnection($connectionString)

try {
    $conn.Open()
    Write-Host "Connected to: $MdbPath" -ForegroundColor Green
    Write-Host ""
    
    # Get columns of tblStorage
    $cmd = $conn.CreateCommand()
    $cmd.CommandText = "SELECT TOP 5 * FROM tblStorage"
    $adapter = New-Object System.Data.OleDb.OleDbDataAdapter($cmd)
    $table = New-Object System.Data.DataTable
    $adapter.Fill($table) | Out-Null
    
    Write-Host "=== tblStorage Columns ===" -ForegroundColor Cyan
    foreach ($col in $table.Columns) {
        Write-Host "  $($col.ColumnName) ($($col.DataType.Name))" -ForegroundColor Yellow
    }
    
    Write-Host ""
    Write-Host "=== Sample rows ===" -ForegroundColor Cyan
    foreach ($row in $table.Rows) {
        $values = @()
        foreach ($col in $table.Columns) {
            $val = $row[$col.ColumnName]
            if ($val -eq [DBNull]::Value) { $val = "NULL" }
            $values += "$($col.ColumnName)=$val"
        }
        Write-Host "  $($values -join ', ')" -ForegroundColor Gray
    }
    
} catch {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
} finally {
    $conn.Close()
}
