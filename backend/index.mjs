// index.mjs
import http from 'http';
import crypto from 'crypto';
import { bootstrap, addPeer, getActivePeers, getActiveConnections, cleanupPeers, startPeerExchange, PEER_TIMEOUT, handleSync } from './network.mjs';
import { inventory, handleInventorySync } from './inventory.mjs';

const port = process.argv[2] || 3000;
let publicIp = null; // Don't set a default - force getting a real IP

function generateNodeId(ip, port) {
    const data = `${ip}:${port}`;
    return crypto.createHash('sha256').update(data).digest('hex').slice(0, 32);
}

// Parse CLI arguments
const args = process.argv.slice(2);
// Support both peer and peers parameters (peer for single bootstrap node, peers for multiple)
let initialPeers = [];
const peerArg = args.find(a => a.startsWith('--peer='));
const peersArg = args.find(a => a.startsWith('--peers='));
const useLocalhost = args.includes('--localhost');

if (peerArg) {
    // Single bootstrap peer
    const peerAddress = peerArg.split('=')[1];
    if (peerAddress) initialPeers.push(peerAddress);
} else if (peersArg) {
    // Multiple peers format
    initialPeers = peersArg.split('=')[1]?.split(',') || [];
}

const nodeId = crypto.randomBytes(16).toString('hex');


const server = http.createServer(async (req, res) => {
    // handle CORS for visualizer
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const path = url.pathname;

    try {
        if (req.method === 'GET') {
            switch(path) {
                case '/status':
                    const allPeers = getActivePeers();
                    const activeConns = getActiveConnections();
                    return sendJSON(res, {
                        nodeId,
                        ip: publicIp,
                        port,
                        blocks: inventory.blocks.size,
                        totalPeers: allPeers.length,  // These are now the active outgoing connections
                        activeConnections: allPeers.length,  // Same as totalPeers with new definition
                        connectionsByGroup: allPeers.reduce((acc, peer) => {
                            acc[peer.group] = (acc[peer.group] || 0) + 1;
                            return acc;
                        }, {}),
                        connections: allPeers.map(p => ({
                            nodeId: p.id,
                            group: p.group,
                            ip: p.ip,
                            port: p.port
                        })),
                        allPeers: allPeers.map(p => ({
                            nodeId: p.id,
                            group: p.group,
                            ip: p.ip,
                            port: p.port,
                            isActive: true  // All peers returned are now active outgoing connections
                        }))
                    });

                case '/peers':
                    return sendJSON(res, getActivePeers().map(p => ({
                        ip: p.ip,
                        port: p.port,
                        nodeId: p.id
                    })));

                case '/inventory':
                    return sendJSON(res, inventory.getInventory());
                    
                case '/balance':
                    return sendJSON(res, { balances: inventory.getBalances() });
                    
                case '/balance/' + nodeId:
                    return sendJSON(res, { 
                        nodeId: nodeId,
                        balance: inventory.getBalance(nodeId)
                    });
                    
                case '/consensus':
                    // Return information about the current consensus state
                    const headBlock = inventory.getBlock(inventory.blockchainHead);
                    const chainLength = inventory.blockHeights.get(inventory.blockchainHead) || 0;
                    
                    return sendJSON(res, {
                        currentHead: inventory.blockchainHead,
                        chainHeight: chainLength,
                        headBlock: headBlock,
                        totalBlocks: inventory.blocks.size,
                        forkedBlocks: inventory.blocks.size - (chainLength + 1) // +1 for genesis
                    });

                case '/getblocks':
                    const hash = url.searchParams.get('hash');
                    const mainChainOnly = url.searchParams.get('mainchain') === 'true';
                    
                    let blocks;
                    if (hash) {
                        // Get specific block by hash
                        blocks = [inventory.getBlock(hash)];
                    } else if (mainChainOnly) {
                        // Get only blocks in the main chain
                        blocks = inventory.getMainChain();
                    } else {
                        // Get all blocks (including those in forks)
                        blocks = inventory.getAllBlocks();
                    }
                    
                    return sendJSON(res, blocks.filter(Boolean));

                case '/ping':
                    return sendJSON(res, { status: 'alive' });

                default:
                    return sendError(res, 404, 'Not found');
            }
        }
        else if (req.method === 'POST') {
            let body = '';
            req.on('data', chunk => body += chunk);

            req.on('end', async () => {
                try {
                    const data = JSON.parse(body);

                    switch(path) {
                        case '/inv':
                            const added = inventory.addTransaction(data);
                            return sendJSON(res, { status: added ? 'added' : 'already_exists' });

                        case '/block':
                            const blockAdded = inventory.addBlock(data);
                            return sendJSON(res, { status: blockAdded ? 'added' : 'already_exists' });

                        case '/sync':
                            const syncData = await handleSync(data, server.address().port, publicIp, nodeId);
                            return sendJSON(res, syncData);

                        case '/register':
                            const { ip, port, nodeId: peerNodeId } = data;
                            addPeer(ip, port, server.address().port, publicIp, peerNodeId, nodeId, "Register endpoint");

                            // Send back our peers AND current inventory
                            const response = {
                                status: 'registered',
                                peers: getActivePeers().map(p => ({
                                    ip: p.ip,
                                    port: p.port,
                                    nodeId: p.id
                                })),
                                nodeId: nodeId,
                                ip: publicIp,
                                port: port,
                                blocks: Array.from(inventory.blocks.values()),
                                transactions: Array.from(inventory.transactions.values())
                            };
                            return sendJSON(res, response);

                        case '/ping':
                            return sendJSON(res, { status: 'alive' });

                        default:
                            return sendError(res, 404, 'Not found');
                    }
                } catch (e) {
                    return sendError(res, 400, 'Invalid JSON');
                }
            });
        }
    } catch (e) {
        console.error('Server error:', e);
        return sendError(res, 500, 'Internal error');
    }
});

function sendJSON(res, data) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function sendError(res, code, message) {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: message }));
}

// Start server
server.listen(port, async () => {
    // Ensure we have our IP before proceeding with bootstrap
    if (!publicIp) {
        if (useLocalhost) {
            publicIp = '127.0.0.1';
            console.log('Using localhost (127.0.0.1) for local testing');
        } else {
            try {
                publicIp = await fetch('https://api.ipify.org').then(r => r.text());
                console.log(`Public IP detected on server start: ${publicIp}`);
            } catch (error) {
                console.error('Failed to get public IP during server start. This is required.');
                server.close();
                process.exit(1);
                return;
            }
        }
    }
    
    console.log(`Node ${nodeId} running at ${publicIp}:${port}`);
    const selfInfo = { ip: publicIp, port, nodeId };
    
    // Check if we need to create a genesis block (first node or standalone)
    if (initialPeers.length === 0 && inventory.blocks.size === 0) {
        console.log('This appears to be the first node. Creating genesis block...');
        const genesisBlock = inventory.createGenesisBlock(nodeId);
        if (genesisBlock) {
            console.log(`Genesis block created with hash: ${genesisBlock.hash}`);
            console.log(`Initial balance of 100 coins assigned to node: ${nodeId}`);
        }
    }

    // Initial peer exchange
    if (initialPeers.length) {
        try {
            const bootstrapResult = await bootstrap(initialPeers, selfInfo);
            
            // Process any inventory received during bootstrap
            if (bootstrapResult && bootstrapResult.data) {
                // Process blocks
                if (bootstrapResult.data.blocks && Array.isArray(bootstrapResult.data.blocks)) {
                    console.log(`Processing ${bootstrapResult.data.blocks.length} blocks from bootstrap`);
                    bootstrapResult.data.blocks.forEach(block => {
                        if (block && (block.hash || block.id)) {
                            console.log(`Adding block from bootstrap: ${JSON.stringify(block)}`);
                            inventory.addBlock(block);
                        } else {
                            console.log(`Skipping invalid block from bootstrap: ${JSON.stringify(block)}`);
                        }
                    });
                }
                
                // Process transactions
                if (bootstrapResult.data.transactions && Array.isArray(bootstrapResult.data.transactions)) {
                    console.log(`Processing ${bootstrapResult.data.transactions.length} transactions from bootstrap`);
                    bootstrapResult.data.transactions.forEach(tx => {
                        if (tx && tx.id) {
                            inventory.addTransaction(tx);
                        }
                    });
                }
            }
        } catch (error) {
            console.error("Error during bootstrap:", error.message);
        }
    }

    // Start maintenance tasks
    setInterval(cleanupPeers, PEER_TIMEOUT);
    startPeerExchange(selfInfo);
});

// Periodic network maintenance
setInterval(() => {
    cleanupPeers();
}, 30000);

// Handle exit signals properly
process.on('SIGINT', () => {
    console.log('Shutting down server...');
    server.close(() => {
        console.log('Server closed successfully');
        process.exit(0);
    });
    
    // Force exit after timeout if something hangs
    setTimeout(() => {
        console.log('Forcing exit after timeout');
        process.exit(1);
    }, 2000);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down...');
    server.close(() => {
        console.log('Server closed successfully');
        process.exit(0);
    });
    
    // Force exit after timeout if something hangs
    setTimeout(() => {
        console.log('Forcing exit after timeout');
        process.exit(1);
    }, 2000);
});