# ELN Client Installation Guide for macOS

This guide provides detailed instructions for installing and running the Electronic Lab Notebook (ELN) client application on macOS.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation Methods](#installation-methods)
   - [Method A: Pre-built Application (Recommended)](#method-a-pre-built-application-recommended)
   - [Method B: Build from Source](#method-b-build-from-source)
3. [Configuration](#configuration)
4. [Running the Application](#running-the-application)
5. [Troubleshooting](#troubleshooting)
6. [Uninstallation](#uninstallation)

---

## Prerequisites

### System Requirements

- **macOS Version:** macOS 10.15 (Catalina) or later
- **Architecture:** Intel (x64) or Apple Silicon (arm64/M1/M2/M3)
- **RAM:** 4 GB minimum, 8 GB recommended
- **Disk Space:** 500 MB for application, additional space for data
- **Network:** Connection to ELN server (for sync features)

### Required Software (for building from source)

- **Xcode Command Line Tools**
- **Node.js 18.x or later**
- **Git**

---

## Installation Methods

### Method A: Pre-built Application (Recommended)

If a pre-built `.dmg` or `.zip` file is provided:

#### Step 1: Download the Application

1. Download the latest ELN client for macOS:
   - `ELN-Client-x.x.x-mac-arm64.dmg` (Apple Silicon M1/M2/M3)
   - `ELN-Client-x.x.x-mac-x64.dmg` (Intel Macs)

#### Step 2: Install the Application

1. Double-click the downloaded `.dmg` file
2. Drag the **ELN** app to the **Applications** folder
3. Eject the disk image

#### Step 3: First Launch (Security)

On first launch, macOS may block the app because it's from an unidentified developer:

1. Try to open the app from **Applications**
2. If blocked, go to **System Preferences** → **Security & Privacy** → **General**
3. Click **"Open Anyway"** next to the message about ELN being blocked
4. Confirm by clicking **Open** in the dialog

**Alternative:** Right-click (or Control-click) the app and select **Open**, then click **Open** in the dialog.

---

### Method B: Build from Source

#### Step 1: Install Prerequisites

##### Install Xcode Command Line Tools

```bash
xcode-select --install
```

Click **Install** when prompted.

##### Install Homebrew (if not installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

##### Install Node.js

```bash
# Using Homebrew
brew install node@20

# Or using nvm (Node Version Manager) - recommended
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.zshrc  # or ~/.bashrc
nvm install 20
nvm use 20
```

Verify installation:

```bash
node --version  # Should show v20.x.x or later
npm --version   # Should show 10.x.x or later
```

##### Install Git

```bash
brew install git
```

#### Step 2: Clone the Repository

```bash
# Navigate to your preferred directory
cd ~/Projects

# Clone the repository
git clone https://github.com/YourOrg/ENotebook.git

# Enter the project directory
cd ENotebook
```

#### Step 3: Install Dependencies

```bash
# Install all project dependencies
npm install

# Build the shared package
npm --workspace packages/shared run build
```

#### Step 4: Configure the Server Connection

Create or edit the environment configuration:

```bash
# The client connects to the server via API_BASE in the code
# Default is http://localhost:4000
# For a remote server, you'll need to modify the API_BASE constant
```

If connecting to a remote server, edit `apps/client/src/renderer/App.tsx`:

```typescript
// Change this line to your server address
const API_BASE = 'http://your-server-address:4000';
```

#### Step 5: Build the Application

```bash
# Build the client
npm --workspace apps/client run build
```

#### Step 6: Run in Development Mode

```bash
# Start the renderer (in one terminal)
npm --workspace apps/client run dev:renderer

# Start Electron (in another terminal)
VITE_DEV_SERVER_URL=http://localhost:5173 npm --workspace apps/client run dev:main
```

#### Step 7: Package for Distribution (Optional)

To create a distributable application, you'll need to add electron-builder:

```bash
# Install electron-builder
npm --workspace apps/client install electron-builder --save-dev
```

Add to `apps/client/package.json`:

```json
{
  "scripts": {
    "package": "electron-builder --mac",
    "package:dmg": "electron-builder --mac dmg",
    "package:zip": "electron-builder --mac zip"
  },
  "build": {
    "appId": "com.yourorg.eln",
    "productName": "ELN",
    "mac": {
      "category": "public.app-category.productivity",
      "target": [
        {
          "target": "dmg",
          "arch": ["x64", "arm64"]
        }
      ],
      "icon": "assets/icon.icns"
    },
    "directories": {
      "output": "release"
    }
  }
}
```

Then build:

```bash
npm --workspace apps/client run package
```

---

## Configuration

### Server Connection

The ELN client needs to connect to an ELN server. Configure the server address:

1. **During Development:** Edit `API_BASE` in `apps/client/src/renderer/App.tsx`
2. **For Production:** The server URL should be configured at build time or through environment variables

### Network Requirements

Ensure the following ports are accessible:

| Port | Protocol | Purpose |
|------|----------|---------|
| 4000 | TCP | ELN API Server |
| 5432 | TCP | PostgreSQL (if direct DB access) |

### Firewall Settings

If using macOS Firewall:

1. Go to **System Preferences** → **Security & Privacy** → **Firewall**
2. Click **Firewall Options**
3. Add the ELN app and select **Allow incoming connections**

---

## Running the Application

### From Applications Folder

1. Open **Finder** → **Applications**
2. Double-click **ELN**

### From Terminal (Development)

```bash
cd ~/Projects/ENotebook

# Option 1: Run both renderer and main together
npm --workspace apps/client run dev

# Option 2: Run separately for debugging
# Terminal 1:
npm --workspace apps/client run dev:renderer

# Terminal 2:
VITE_DEV_SERVER_URL=http://localhost:5173 npm --workspace apps/client run dev:main
```

### Create a Desktop Shortcut

1. Open **Finder** → **Applications**
2. Right-click (Control-click) the **ELN** app
3. Select **Make Alias**
4. Drag the alias to your Desktop

### Add to Dock

1. Open the **ELN** app
2. Right-click the app icon in the Dock
3. Select **Options** → **Keep in Dock**

---

## Troubleshooting

### Common Issues

#### "ELN is damaged and can't be opened"

This occurs due to macOS Gatekeeper. Fix with:

```bash
# Remove the quarantine attribute
xattr -cr /Applications/ELN.app
```

#### "Cannot connect to server"

1. Verify the server is running:
   ```bash
   curl http://your-server:4000/health
   ```
2. Check your network connection
3. Verify firewall settings allow outbound connections
4. Ensure the `API_BASE` is correctly configured

#### App Won't Start

1. Check for crash logs:
   ```bash
   open ~/Library/Logs/DiagnosticReports/
   ```
2. Try running from terminal to see error messages:
   ```bash
   /Applications/ELN.app/Contents/MacOS/ELN
   ```

#### White/Blank Screen

1. Clear the application cache:
   ```bash
   rm -rf ~/Library/Application\ Support/ELN/
   rm -rf ~/Library/Caches/ELN/
   ```
2. Restart the application

#### "npm install" Fails

1. Clear npm cache:
   ```bash
   npm cache clean --force
   ```
2. Delete node_modules and reinstall:
   ```bash
   rm -rf node_modules
   rm package-lock.json
   npm install
   ```

#### Apple Silicon (M1/M2/M3) Compatibility

If you encounter issues on Apple Silicon Macs:

```bash
# Ensure you're using the native arm64 version of Node
node -p process.arch  # Should output "arm64"

# If needed, reinstall dependencies for arm64
rm -rf node_modules
npm install
```

### Log Files

Application logs are stored at:

```
~/Library/Logs/ELN/
~/Library/Application Support/ELN/logs/
```

### Getting Help

1. Check the [GitHub Issues](https://github.com/YourOrg/ENotebook/issues)
2. Contact your lab IT administrator
3. Email: support@yourorganization.com

---

## Uninstallation

### Remove the Application

1. Quit the ELN application
2. Open **Finder** → **Applications**
3. Drag **ELN** to the Trash
4. Empty the Trash

### Remove Application Data (Optional)

To completely remove all data:

```bash
# Remove application support data
rm -rf ~/Library/Application\ Support/ELN/

# Remove caches
rm -rf ~/Library/Caches/ELN/

# Remove preferences
rm -rf ~/Library/Preferences/com.yourorg.eln.plist

# Remove logs
rm -rf ~/Library/Logs/ELN/
```

### Remove Development Files (If Built from Source)

```bash
# Remove the cloned repository
rm -rf ~/Projects/ENotebook
```

---

## Quick Reference

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Experiment | ⌘ + N |
| Save | ⌘ + S |
| Refresh | ⌘ + R |
| Settings | ⌘ + , |
| Quit | ⌘ + Q |
| Toggle Sidebar | ⌘ + B |

### File Locations

| Type | Location |
|------|----------|
| Application | `/Applications/ELN.app` |
| User Data | `~/Library/Application Support/ELN/` |
| Cache | `~/Library/Caches/ELN/` |
| Logs | `~/Library/Logs/ELN/` |
| Preferences | `~/Library/Preferences/com.yourorg.eln.plist` |

---

## Version History

| Version | Date | Notes |
|---------|------|-------|
| 0.1.0 | 2025-12-18 | Initial release |

---

*For server installation instructions, see [SERVER_INSTALLATION.md](SERVER_INSTALLATION.md)*
