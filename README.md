# Hashcat Reactor

**Hashcat Reactor** is a modern, high-performance GUI frontend for Hashcat, built with Electron, React, and Node.js. It transforms the command-line experience into a visual dashboard with advanced analytics, real-time monitoring, and intelligent attack automation.

## 🚀 Features

* **Real-time Dashboard**: Monitor hashrates, progress, temperature, and recovered hashes live via Socket.IO.
* **PACK Analysis**: Integrated Password Analysis and Cracking Kit implementation. Analyzes imported hashes to generate optimized masks, rules, and wordlists automatically.
* **Smart Potfile Management**:
    * Automatic potfile syncing.
    * **Large File Support**: Stream-optimized processing to check target lists against the potfile without crashing RAM (supports gigabytes of data).
* **Interactive Terminal**: Full pseudo-terminal (PTY) access to the underlying shell for manual overrides.
* **Escrow Integration**: Built-in module to submit cracked hashes to remote escrow APIs.
* **Session History**: Tracks all past attacks, their configurations, and success rates.

---

## 🛠 Prerequisites

Before you begin, ensure you have the following installed:

1.  **Node.js**: Version 16.x or higher (LTS recommended).
2.  **Build Tools** (Required for `node-pty`):
    * **Windows**: Visual Studio Build Tools (C++) or run `npm install --global --production windows-build-tools` (in an admin shell).
    * **Linux/Mac**: `make`, `gcc`, `g++`, and Python.
3.  **Hashcat Binaries**: You must provide your own Hashcat executables. (already included v7.1.2 for windows)

---

## ⚙️ Setup & Installation

1.  **Clone the repository**:
    ```bash
    git clone <repository-url>
    cd hashcat-reactor
    ```

2.  **Install Dependencies**:
    This will install packages for both the React frontend and the Node.js backend.
    ```bash
    npm install
    ```
    *Note: If `node-pty` fails to install, ensure your C++ build tools are set up correctly.*

3.  **Configure Hashcat**:
    The application looks for Hashcat in a specific directory. You must place the binaries manually.
    
    1.  Create the folder structure:
        ```
        backend/hashcat/
        ```
    2.  Download **Hashcat binaries** (v6.2.6 or higher recommended) from the [official website](https://hashcat.net/hashcat/).
    3.  Extract the contents into `backend/hashcat/`.
    4.  Verify the path exists:
        * **Windows**: `backend/hashcat/hashcat.exe`
        * **Linux**: `backend/hashcat/hashcat.bin`

---

## 💻 Development Mode

To run the application in development mode with hot-reloading (Vite) and the local backend server:

```bash
npm run electron:dev