# P2P Network Visualizer (Frontend)

A simple web-based visualization tool for displaying the P2P network topology and node details.

## Overview

This project provides a **real-time visual representation** of the P2P network, displaying:
- Active nodes in the network
- Grouped connections based on node IDs
- Node details such as peers, status, and address

## Features

- **Live network visualization**
- **Refresh to update node status**
- **Displays node connections and group distribution**
- **Detailed node information panel**


## Installation & Setup

### Install Dependencies
Ensure you have **Node.js** installed. Then, run:
```bash
npm install
```
## Start Development Server
Run the following command to start the frontend in development mode:
```bash
npm run dev
```

### Network visualizer:
- `NetworkVisualizer.jsx` is the core component that visualizes the P2P network.
- It fetches **network status** from the backend (`/status` API).
- Uses **SVG rendering** to draw nodes and connections dynamically.
- Supports **interactive node selection** to display details of each node.
- Implements **drag-and-drop functionality** for repositioning nodes.

