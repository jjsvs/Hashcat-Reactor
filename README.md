
# Hashcat Reactor - Setup & Build Guide

## Prerequisites
1.  **Node.js**: Version 16 or higher.
2.  **Hashcat**: Download Hashcat binaries from the official website.

## Setup

1.  Open your terminal in the project directory.
2.  Install dependencies (Frontend & Backend):
    ```bash
    npm install
    ```
3.  **Place Hashcat Binaries**: (already placed Version 7.1.2)
    *   Create a folder: `backend/hashcat`
    *   Extract your hashcat files there.
    *   Ensure you have `backend/hashcat/hashcat.exe` (Windows) or `backend/hashcat/hashcat.bin` (Linux/Mac).

## Development Mode

Run the app with hot-reloading and the local backend server:

```bash
npm run electron:dev
```
This starts Vite (frontend), Server (backend), and Electron simultaneously.

## Building the Executable (.exe)

To create a standalone binary for distribution:

1.  Run the build script:
    ```bash
    npm run electron:build
    ```
2.  The output file will be in the `dist` folder (`Hashcat Reactor Setup 1.0.0.exe`).


