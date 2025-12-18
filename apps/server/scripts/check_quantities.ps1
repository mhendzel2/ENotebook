$conn = New-Object -ComObject ADODB.Connection
$conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=C:\Users\Room3341\Desktop\MHLabmanagement2023N.mdb;Persist Security Info=False;")

# Check a few antibodies to see the Tubes field
Write-Host "=== Sample Antibodies with Tubes ==="
$rs = $conn.Execute("SELECT TOP 10 AntibodyID, AntibodyName, Tubes FROM tblAntibody WHERE Tubes IS NOT NULL AND Tubes > 0")
while (!$rs.EOF) {
    Write-Host "ID: $($rs.Fields.Item('AntibodyID').Value), Name: $($rs.Fields.Item('AntibodyName').Value), Tubes: $($rs.Fields.Item('Tubes').Value)"
    $rs.MoveNext()
}
$rs.Close()

# Check chemicals for Amount
Write-Host ""
Write-Host "=== Sample Chemicals with Amount ==="
$rs = $conn.Execute("SELECT TOP 10 CMID, CMName, Amount FROM tblChemical WHERE Amount IS NOT NULL")
while (!$rs.EOF) {
    Write-Host "ID: $($rs.Fields.Item('CMID').Value), Name: $($rs.Fields.Item('CMName').Value), Amount: $($rs.Fields.Item('Amount').Value)"
    $rs.MoveNext()
}
$rs.Close()

# Count storage rows vs main table tubes
Write-Host ""
Write-Host "=== Comparing storage row counts vs Tubes field ==="
$rs = $conn.Execute("SELECT SUM(Tubes) as TotalTubes FROM tblAntibody WHERE Tubes IS NOT NULL")
Write-Host "Total Tubes in tblAntibody: $($rs.Fields.Item(0).Value)"
$rs.Close()

$rs = $conn.Execute("SELECT COUNT(*) as cnt FROM tblStorage")
Write-Host "Total rows in tblStorage (antibody storage): $($rs.Fields.Item(0).Value)"
$rs.Close()

$conn.Close()
