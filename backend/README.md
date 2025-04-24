# PRAX 2 done and todos:
- Bloki kaevandamine DONE
- Loodud bloki automaatselt teistele edasisaatmine DONE
- Bloki Merkle juure (merkle root) arvutamine DONE
- Transaktsioonide kokkukogumine blokiks ja blokiandmete ülekontrollimine DONE
- Mitme paralleelbloki korral õige valimine (konsensusreeglid) DONE


# P2P Network with Distributed Blockchain

A simple implementation of a P2P network with blockchain and distributed ledger capabilities built on HTTP protocol.

## Overview

This project implements a basic P2P network where multiple nodes can discover each other, exchange information about peers, and propagate blocks and transactions across the network. The implementation is built using pure HTTP without any heavy frameworks, making it suitable for educational purposes.

## Features

- P2P Network Communication
    - Node discovery and peer management
    - Automatic peer exchange
    - Connection limits and grouping
    - Peer health monitoring and cleanup

- Basic Distributed Ledger
    - Block and transaction propagation
    - Simple inventory management
    - Block hash calculation (SHA-256)
    - Basic synchronization mechanism

- Testing Environment
    - Support for multiple nodes (tested up to 100 nodes)
    - Configurable ports
    - Bootstrap node functionality

## Architecture

The project consists of five main components:

1. `index.mjs`: Main server implementation and HTTP endpoints
2. `network.mjs`: P2P network management and peer communication
3. `inventory.mjs`: Block, transaction, and blockchain management
4. `miner.mjs`: Block mining and Proof-of-Work implementation
5. `test.mjs`: Test environment for running nodes and to test network

## Blockchain Structure and Consensus

### Block Structure
Each block in the blockchain contains:
- `isGenesis`: Boolean flag indicating if this is the genesis block
- `previousHash`: Hash of the previous block (chain linking)
- `timestamp`: ISO timestamp when the block was created
- `nonce`: Random number used in mining (Proof-of-Work)
- `creator`: Node ID of the miner who created the block
- `merkleRoot`: Hash representing all transactions in the block
- `count`: Number of transactions in the block
- `transactions`: Array of transaction objects
- `hash`: SHA-256 hash of the block (excluding the hash field itself)

### Transaction Structure
Each transaction contains:
- `id`: Unique identifier for the transaction
- `sender`: Node ID of the sender
- `receiver`: Node ID of the receiver
- `amount`: Number of coins transferred
- `timestamp`: When the transaction was created

### Consensus Rules
The system implements the following consensus rules for handling blockchain forks:

1. **Longest Chain Rule**: When there are competing chains (forks), the chain with the most blocks is considered the valid chain.
   
2. **Smallest Hash Rule**: If two chains have the same length, the chain whose head block has the smaller hash value is chosen as the valid chain.

When a fork is resolved, the system:
1. Identifies the common ancestor between the old and new chain
2. Rolls back transactions from abandoned blocks (credited amounts are reversed)
3. Applies transactions from the new chain's blocks
4. Updates the blockchain head pointer to the new chain's head

### Block Validation
Block validation includes:
- Verifying the block's hash matches its contents
- Ensuring the previous hash links to an existing block
- Validating the Merkle root against the included transactions
- Checking the proof-of-work solution (hash starts with required number of zeros)

### Transaction Validation
Before accepting transactions:
- The system verifies the sender has sufficient balance
- Checks for complete transaction data (sender, receiver, amount)
- Ensures the transaction hasn't been processed before

### Block Mining
Blocks are mined using a Proof-of-Work algorithm:
1. Collect pending transactions from the network
2. Create a block with transaction data and previous block reference
3. Calculate the Merkle root of all transactions
4. Increment the nonce until a hash with the required prefix (difficulty) is found
5. Broadcast the newly mined block to all peers

## Protocol Specification

### GET requests

#### GET /peers
Returns list of known peers
```json
[{
  "ip": "127.0.0.1",
  "port": 3000,
  "nodeId": "abc123..."
}]
```

#### GET /getblocks
Get blocks with optional filtering
- Parameters:
  - `hash`: Get a specific block by hash
  - `mainchain=true`: Get only blocks from the main chain (consensus chain)
- Response: Array of blocks
```json
[
  {
    "isGenesis": false,
    "previousHash": "abc123...",
    "timestamp": "2023-07-12T15:30:45.123Z",
    "nonce": "42935",
    "creator": "node_3001",
    "merkleRoot": "def456...",
    "count": 2,
    "transactions": [
      {
        "id": "tx_123",
        "sender": "node_3001",
        "receiver": "node_3002",
        "amount": 10,
        "timestamp": 1707843647000
      }
    ],
    "hash": "301bc..."
  }
]
```

#### GET /status
Get node status and network information
- Response:
```json
{
  "nodeId": "dc623820020a86c0564e95320d278978",
  "ip": "51.12.217.169",
  "port": "3001",
  "blocks": 1,
  "totalPeers": 0,
  "activeConnections": 0,
  "connectionsByGroup": {},
  "connections": [],
  "allPeers": []
}
```

#### GET /inventory
Get the node's inventory data including consensus information
- Response:
```json
{
  "blocks": [
    "099b..."
  ],
  "transactions": [
    {
      "id": "tx_ihfxil",
      "sender": "node_3022",
      "receiver": "node_3023",
      "amount": 83,
      "timestamp": 1741176657558
    }
  ],
  "balances": {
    "node_3001": 100,
    "node_3002": 50
  },
  "consensus": {
    "currentHead": "099b...",
    "chainHeight": 5,
    "totalBlocks": 8,
    "forkedBlocks": 2
  }
}
```

#### GET /ping
Health check endpoint
- Response: `{ "status": "alive" }`

#### GET /consensus
Get information about the current consensus state
- Response:
```json
{
  "currentHead": "0a1b2c...",
  "chainHeight": 10,
  "headBlock": {
    "hash": "0a1b2c...",
    "previousHash": "d4e5f6...",
    "timestamp": "2023-07-12T15:30:45.123Z",
    "nonce": "42935",
    "creator": "node_3001",
    "merkleRoot": "def456...",
    "count": 2,
    "transactions": [...]
  },
  "totalBlocks": 15,
  "forkedBlocks": 4
}
```


### POST requests

#### POST /register
Register new peer
- Request Body:
```json
{
  "ip": "127.0.0.1",
  "port": 3001,
  "nodeId": "def456..."
}
```
- Response:
```json
{
  "status": "registered",
  "nodeId": "abc123...",
  "peers": [...],
  "blocks": [...],
  "transactions": [...]
}
```

#### POST /block
Submit new block
- Request Body: 
```json
{
  "timestamp": 1707843647000,
  "data": "Test block data",
  "previousHash": "0000"
}
```
- Response: Status of block acceptance


#### POST /inv
Submit new transaction
- Request Body: 
```json 
{
  "timestamp": 1707843647000,
  "data": "Test transaction data",
  "signature": "dummy-sig",
  "id": "tx-123"
}
```
- Response: Status of transaction acceptance

#### POST /sync
...




## Configuration
Current network parameters:
- PEER_EXCHANGE_INTERVAL: 30 seconds
- PEER_TIMEOUT: 10 minutes
- MAX_INTERNAL_CONNECTIONS = 4;
- MAX_EXTERNAL_CONNECTIONS = 4;

## Running the Project

### Prerequisites
- Node.js (version 14 or higher)
- Network connectivity between nodes (if running on multiple machines)

### Starting a Single Node
```bash
node index.mjs [port] [--peers=ip:port,ip:port,...]
```

### Starting Test Environment
```bash
node start-nodes.mjs
```
This will start:
1. Bootstrap node on port 3000
2. Additional nodes connecting to bootstrap node

### Example Setup
```bash
# Terminal 1 - Start bootstrap node
node index.mjs 3000

# Terminal 2 - Start peer node
node index.mjs 3001 --peers=localhost:3000

# Terminal 3 - Start another peer node
node index.mjs 3002 --peers=localhost:3000
```

## Implementation Notes

### Node Groups
- Nodes are grouped based on first character of nodeId
- Maximum 4 connections per group
- Maximum 8 total connections per node

### Peer Management
- Peers are cleaned up after 10 minutes of inactivity
- Failed connections are retried up to 3 times
- Peer exchange occurs every 30 seconds

### Block/Transaction Propagation
- Duplicate detection using seen messages
- SHA-256 hash verification for blocks
- Automatic propagation to connected peers
- Transaction validation based on sender balance
- Consensus rules for handling blockchain forks

## Limitations and Future Improvements

Current limitations:
1. No persistence (in-memory only)
2. Basic security (no authentication)
3. Limited error handling
4. Simple consensus mechanism (longest chain/smallest hash)
5. Basic transaction validation (balance check only)

Planned improvements:
1. Add structured logging
2. Implement basic persistence
3. Add comprehensive testing
4. Add basic security measures
5. Improve documentation

## Testing Status

The system has been tested with:
- Up to 100 nodes on single machine
- Basic block and transaction propagation
- Node discovery and peer exchange
- Network partitioning and recovery


## Transactions simulator
cd backend directory and run
```bash
node test.mjs
```
This demonstrates p2p network, nodes connections and transactions.


## Contributing

This is a school project and not intended for production use. However, suggestions and improvements are welcome.
