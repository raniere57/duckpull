function runPicker(command) {
  try {
    const result = Bun.spawnSync(command)
    if (result.exitCode !== 0) {
      return null
    }
    const output = result.stdout.toString().trim()
    return output || null
  } catch {
    return null
  }
}

export function pickDirectory() {
  switch (process.platform) {
    case 'darwin':
      return runPicker([
        'osascript',
        '-e',
        'POSIX path of (choose folder with prompt "Selecione a pasta de destino do duckpull")'
      ])
    case 'linux':
      return (
        runPicker([
          'zenity',
          '--file-selection',
          '--directory',
          '--title=Selecione a pasta de destino do duckpull'
        ]) ||
        runPicker([
          'kdialog',
          '--getexistingdirectory',
          '.',
          '--title',
          'Selecione a pasta de destino do duckpull'
        ])
      )
    case 'win32':
      return (
        runPicker([
          'powershell',
          '-NoProfile',
          '-STA',
          '-Command',
          [
            'Add-Type -AssemblyName System.Windows.Forms;',
            '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
            '$dialog.Description = "Selecione a pasta de destino do duckpull";',
            '$dialog.ShowNewFolderButton = $true;',
            '$result = $dialog.ShowDialog();',
            'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
            '  Write-Output $dialog.SelectedPath',
            '}'
          ].join(' ')
        ]) ||
        runPicker([
          'pwsh',
          '-NoProfile',
          '-STA',
          '-Command',
          [
            'Add-Type -AssemblyName System.Windows.Forms;',
            '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog;',
            '$dialog.Description = "Selecione a pasta de destino do duckpull";',
            '$dialog.ShowNewFolderButton = $true;',
            '$result = $dialog.ShowDialog();',
            'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
            '  Write-Output $dialog.SelectedPath',
            '}'
          ].join(' ')
        ])
      )
    default:
      return null
  }
}
