#!/bin/sh
set -e

REPO="canta2899/claude-redline"
BIN="claude-redline"

ARCH=$(uname -m)
OS=$(uname)

# Normalize architecture to the names used in the release assets.
case "$ARCH" in
  arm64|aarch64)
    ARCH="aarch64"
    ;;
  x86_64|amd64)
    ARCH="x86_64"
    ;;
  *)
    echo "Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

# Normalize OS name to the names used in the release assets.
case "$OS" in
  Darwin)
    OS="macos"
    ;;
  Linux)
    OS="linux"
    ;;
  *)
    echo "Unsupported OS: $OS"
    exit 1
    ;;
esac

if [ -z "$REDLINE_VERSION" ]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | cut -d '"' -f 4)
else
  VERSION="$REDLINE_VERSION"
fi

if [ -z "$VERSION" ]; then
  echo "Could not determine the latest version. Set REDLINE_VERSION to install a specific one."
  exit 1
fi

DOWNLOAD_URL="https://github.com/${REPO}/releases/download/${VERSION}/${BIN}-${OS}-${ARCH}.tar.gz"

if [ -z "$REDLINE_INSTALL_DIR" ]; then
  INSTALL_DIR="$HOME/.local/bin"
else
  INSTALL_DIR="$REDLINE_INSTALL_DIR"
fi
mkdir -p "$INSTALL_DIR"

if ! echo "$PATH" | grep -q "$INSTALL_DIR"; then
  echo "Warning: $INSTALL_DIR is not in your PATH."
  echo "You should add it to your PATH or move $BIN to a directory that is."
fi

echo "Downloading $BIN $VERSION ($OS-$ARCH)..."
curl -fsSL "$DOWNLOAD_URL" | tar -xzf - -C "$INSTALL_DIR" "./$BIN"
chmod +x "$INSTALL_DIR/$BIN"

echo "✅ $BIN $VERSION installed to $INSTALL_DIR/$BIN"

# Install/update the /redline skill so it stays in sync with the binary.
if "$INSTALL_DIR/$BIN" skill; then
  :
else
  echo "⚠️  The /redline skill could not be installed. Run \`$BIN skill\` manually."
fi
