$conn = New-Object -ComObject ADODB.Connection
$conn.Open("Provider=Microsoft.ACE.OLEDB.12.0;Data Source=C:\Users\Room3341\Desktop\MHLabmanagement2023N.mdb;Persist Security Info=False;")

$tables = @(
    "tblAntibody", "tblCellline", "tblChemical", "tblDNA", "tblMR", "tblOligo", "tblVirus",
    "tblStorage", "tblDNAStorage", "tblCMStorage", "tblCLStorage", "tblOligoStorage", "tblMRStorage", "tblMItemsStorage",
    "tblExp", "tblExpStorage", "tblbox"
)

foreach ($tbl in $tables) {
    try {
        $rs = $conn.Execute("SELECT COUNT(*) as cnt FROM [$tbl]")
        $count = $rs.Fields.Item(0).Value
        Write-Host "$tbl : $count rows"
        $rs.Close()
    } catch {
        Write-Host "$tbl : error"
    }
}

$conn.Close()
