$conn = New-Object -ComObject ADODB.Connection
$conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=C:\Users\Room3341\Desktop\MHLabmanagement2023N.mdb;Persist Security Info=False;")

$tablesToInspect = @("tblStorage", "tblDNAStorage", "tblCMStorage", "tblCLStorage", "tblOligoStorage", "tblMRStorage", "tblMItemsStorage", "tblAntibody", "tblChemical", "tblDNA", "tblCellline")

foreach ($tbl in $tablesToInspect) {
    try {
        $rs = $conn.Execute("SELECT TOP 1 * FROM [$tbl]")
        $cols = @()
        for ($i = 0; $i -lt $rs.Fields.Count; $i++) {
            $cols += $rs.Fields.Item($i).Name
        }
        Write-Host "=== $tbl ==="
        Write-Host ($cols -join ", ")
        Write-Host ""
        $rs.Close()
    } catch {
        Write-Host "=== $tbl === (error: $($_.Exception.Message))"
        Write-Host ""
    }
}

$conn.Close()
