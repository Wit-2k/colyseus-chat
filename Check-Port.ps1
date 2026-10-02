<#
.SYNOPSIS
检查端口占用，并询问是否终止占用进程。
.DESCRIPTION
输入端口号，检查 TCP/UDP 端口占用。若被占用，显示占用进程，并询问是否终止，默认终止（直接回车）。
.NOTES
建议以管理员身份运行，否则可能无法终止其他用户的进程。
#>

[CmdletBinding()]
param(
    [int]$Port
)

function Read-Port {
    while ($true) {
        $inputPort = Read-Host "请输入要检查的端口号 (1-65535)"
        $parsedPort = 0
        if ($inputPort -and [int]::TryParse($inputPort.Trim(), [ref]$parsedPort) -and $parsedPort -ge 1 -and $parsedPort -le 65535) {
            return $parsedPort
        }
        Write-Host "端口号无效，请输入 1-65535 之间的整数。" -ForegroundColor Red
    }
}

function Get-PortOccupation {
    param(
        [int]$TargetPort
    )

    $result = @()

    if (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue) {
        $tcpConns = Get-NetTCPConnection -LocalPort $TargetPort -ErrorAction SilentlyContinue
        foreach ($conn in $tcpConns) {
            if ($conn.OwningProcess -eq 0) { continue }

            $proc = Get-Process -Id $conn.OwningProcess -ErrorAction SilentlyContinue
            $procName = if ($proc) { $proc.ProcessName } else { '未知' }
            $procPath = if ($proc) { $proc.Path } else { '' }

            $result += [pscustomobject]@{
                Protocol     = 'TCP'
                LocalAddress = $conn.LocalAddress
                LocalPort    = $conn.LocalPort
                State        = $conn.State
                ProcessId    = $conn.OwningProcess
                ProcessName  = $procName
                Path         = $procPath
            }
        }

        $udpEndpoints = Get-NetUDPEndpoint -LocalPort $TargetPort -ErrorAction SilentlyContinue
        foreach ($endpoint in $udpEndpoints) {
            if ($endpoint.OwningProcess -eq 0) { continue }

            $proc = Get-Process -Id $endpoint.OwningProcess -ErrorAction SilentlyContinue
            $procName = if ($proc) { $proc.ProcessName } else { '未知' }
            $procPath = if ($proc) { $proc.Path } else { '' }

            $result += [pscustomobject]@{
                Protocol     = 'UDP'
                LocalAddress = $endpoint.LocalAddress
                LocalPort    = $endpoint.LocalPort
                State        = ''
                ProcessId    = $endpoint.OwningProcess
                ProcessName  = $procName
                Path         = $procPath
            }
        }
    }
    else {
        $netstatOutput = netstat -ano
        foreach ($line in $netstatOutput) {
            $parts = -split $line.Trim()
            if ($parts.Count -lt 4) { continue }
            $proto = $parts[0]
            if ($proto -ne 'TCP' -and $proto -ne 'UDP') { continue }
            $localAddrPort = $parts[1]
            $stateValue = ''
            $processId = 0
            if ($proto -eq 'TCP' -and $parts.Count -ge 5) {
                $stateValue = $parts[3]
                $processId = [int]$parts[4]
            } elseif ($proto -eq 'UDP' -and $parts.Count -ge 4) {
                $processId = [int]$parts[3]
            }
            if ($processId -eq 0) { continue }
            if ($localAddrPort -match ':(\d+)$') {
                $localPort = [int]$Matches[1]
                if ($localPort -eq $TargetPort) {
                    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
                    $procName = if ($proc) { $proc.ProcessName } else { '未知' }
                    $procPath = if ($proc) { $proc.Path } else { '' }
                    $result += [pscustomobject]@{
                        Protocol     = $proto
                        LocalAddress = $localAddrPort
                        LocalPort    = $TargetPort
                        State        = $stateValue
                        ProcessId    = $processId
                        ProcessName  = $procName
                        Path         = $procPath
                    }
                }
            }
        }
    }

    return $result
}

if ($Port -lt 1 -or $Port -gt 65535) {
    $Port = Read-Port
}

Write-Host "正在检查端口 $Port ..." -ForegroundColor Cyan
$occupations = @(Get-PortOccupation -TargetPort $Port)

if ($occupations.Count -eq 0) {
    Write-Host "端口 $Port 未被占用。" -ForegroundColor Green
    exit 0
}

Write-Host "端口 $Port 被以下进程占用：" -ForegroundColor Yellow
$occupations | Format-Table Protocol, LocalAddress, LocalPort, State, ProcessId, ProcessName, Path -AutoSize

$promptAnswer = Read-Host "是否终止以上占用进程？[Y/n]（默认 Y）"
$answer = if ($null -ne $promptAnswer) { $promptAnswer.Trim() } else { '' }
if ($answer -ne '' -and $answer -notmatch '^(y|yes)$') {
    Write-Host "已取消，未终止任何进程。" -ForegroundColor Cyan
    exit 0
}

$processIds = @($occupations | Select-Object -ExpandProperty ProcessId -Unique)

foreach ($procId in $processIds) {
    if ($procId -eq $PID) {
        Write-Warning "PID $procId 是当前 PowerShell 进程，已跳过。"
        continue
    }

    try {
        $proc = Get-Process -Id $procId -ErrorAction Stop
        Write-Host "正在终止 $($proc.ProcessName) (PID: $procId) ..." -ForegroundColor Yellow
        Stop-Process -Id $procId -Force -ErrorAction Stop
        Write-Host "已终止 PID $procId。" -ForegroundColor Green
    }
    catch {
        Write-Host "无法终止 PID $procId：$($_.Exception.Message)" -ForegroundColor Red
    }
}

Start-Sleep -Milliseconds 500
$stillOccupied = @(Get-PortOccupation -TargetPort $Port)

if ($stillOccupied.Count -eq 0) {
    Write-Host "端口 $Port 已释放。" -ForegroundColor Green
}
else {
    Write-Host "端口 $Port 仍被占用，可能需要管理员权限或进程未完全结束。" -ForegroundColor Red
    $stillOccupied | Format-Table Protocol, LocalAddress, LocalPort, State, ProcessId, ProcessName -AutoSize
}
