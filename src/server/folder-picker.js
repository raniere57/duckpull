function decodeOutput(stream) {
  return new Response(stream).text()
}

async function runPicker(command, timeoutMs = 120000) {
  try {
    const proc = Bun.spawn(command, {
      stdout: 'pipe',
      stderr: 'pipe'
    })

    let timedOut = false
    const timeoutHandle = setTimeout(() => {
      timedOut = true
      try {
        proc.kill()
      } catch {
        // ignore
      }
    }, timeoutMs)

    const exitCode = await proc.exited
    clearTimeout(timeoutHandle)

    if (timedOut || exitCode !== 0) {
      return null
    }

    const output = (await decodeOutput(proc.stdout)).trim()
    return output || null
  } catch {
    return null
  }
}

export async function pickDirectory() {
  switch (process.platform) {
    case 'darwin':
      return await runPicker([
        'osascript',
        '-e',
        'POSIX path of (choose folder with prompt "Selecione a pasta de destino do duckpull")'
      ])
    case 'linux':
      return (
        await runPicker([
          'zenity',
          '--file-selection',
          '--directory',
          '--title=Selecione a pasta de destino do duckpull'
        ]) ||
        await runPicker([
          'kdialog',
          '--getexistingdirectory',
          '.',
          '--title',
          'Selecione a pasta de destino do duckpull'
        ])
      )
    case 'win32':
      return (
        await runPicker([
          'powershell.exe',
          '-NoProfile',
          '-STA',
          '-Command',
          [
            '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
            '$app = New-Object -ComObject Shell.Application;',
            "$folder = $app.BrowseForFolder(0, 'Selecione a pasta de destino do duckpull', 0, 'C:\\');",
            'if ($folder) { Write-Output $folder.Self.Path }'
          ].join(' ')
        ]) ||
        await runPicker([
          'powershell.exe',
          '-NoProfile',
          '-STA',
          '-Command',
          [
            '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8;',
            'Add-Type -AssemblyName System.Windows.Forms;',
            '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
            '$dialog.Description = "Selecione a pasta de destino do duckpull";',
            '$dialog.ShowNewFolderButton = $true;',
            '$dialog.SelectedPath = "C:\\";',
            '$result = $dialog.ShowDialog();',
            'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }'
          ].join(' ')
        ])
      )
    default:
      return null
  }
}

export async function openDirectory(path) {
  if (!path) {
    return false
  }

  try {
    switch (process.platform) {
      case 'darwin': {
        const proc = Bun.spawn(['open', path], { stdout: 'ignore', stderr: 'ignore' })
        return (await proc.exited) === 0
      }
      case 'linux': {
        const proc = Bun.spawn(['xdg-open', path], { stdout: 'ignore', stderr: 'ignore' })
        return (await proc.exited) === 0
      }
      case 'win32': {
        const proc = Bun.spawn(['explorer.exe', path], { stdout: 'ignore', stderr: 'ignore' })
        return (await proc.exited) === 0
      }
      default:
        return false
    }
  } catch {
    return false
  }
}
