function loginItemSettings({ isPackaged, execPath, appPath }) {
  return {
    openAtLogin: true,
    name: 'AI Limit Tray',
    path: execPath,
    args: isPackaged ? ['--background'] : [appPath, '--background']
  };
}

module.exports = { loginItemSettings };
