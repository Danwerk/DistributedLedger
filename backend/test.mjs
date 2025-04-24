import {spawn} from 'child_process';
import path from 'path';
import {fileURLToPath} from 'url';
import readline from 'readline';
import { mineBlock } from './miner.mjs';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse command line arguments
const args = process.argv.slice(2);
const bootstrapPeerArg = args.find(arg => arg.startsWith('--peer='));
const bootstrapPeer = bootstrapPeerArg ? bootstrapPeerArg.split('=')[1] : null;
// Check if we should use localhost for testing
const useLocalhost = args.includes('--localhost');

const NUM_NODES = 5;
const BASE_PORT = 3000;
const NODES = [];


// Setup interactive CLI
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});


// Function to start a node
async function startNode(port, peers = []) {
    console.log(`Starting node on port: ${port}`);
    const args = [path.join(__dirname, 'index.mjs'), port.toString()];

    // Add localhost flag if needed
    if (useLocalhost) {
        args.push('--localhost');
    }

    if (peers.length === 1) {
        // Use --peer for a single bootstrap node
        args.push(`--peer=${peers[0]}`);
    } else if (peers.length > 1) {
        // Use --peers for multiple peers
        args.push(`--peers=${peers.join(',')}`);
    }

    const process = spawn('node', args, {
        cwd: __dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Detailed logs from nodes are disabled for better usability
    // process.stdout.on('data', (data) => {
    //     console.log(`[Node ${port}] ${data.toString().trim()}`);
    // })

    // Log errors from nodes
    process.stderr.on('data', (data) => {
        console.error(`[Node ${port} ERROR] ${data.toString().trim()}`);
    });

    NODES.push({port, process, peers});
}

// Start multiple nodes with peer connections
async function startNodes() {
    console.log("Launching nodes...");

    // Get IP address to use
    let publicIp;
    if (useLocalhost) {
        publicIp = '127.0.0.1';
        console.log(`Using localhost (127.0.0.1) for local testing`);
    } else {
        try {
            publicIp = await fetch('https://api.ipify.org').then(r => r.text());
            console.log(`Using public IP: ${publicIp}`);
        } catch (error) {
            console.error('Failed to get public IP. This is required for the application to work properly.');
            process.exit(1);
            return;
        }
    }

    // Start first node, potentially using external bootstrap peer
    const firstNodePort = BASE_PORT;
    const firstNodePeers = bootstrapPeer ? [bootstrapPeer] : [];

    // If we have a bootstrap peer, print information about it
    if (bootstrapPeer) {
        console.log(`Using external bootstrap peer: ${bootstrapPeer}`);
    }

    await startNode(firstNodePort, firstNodePeers);
    await new Promise(resolve => setTimeout(resolve, 1000)); // Longer delay for first node

    // Start remaining nodes, using first node as peer
    for (let i = 1; i < NUM_NODES; i++) {
        const port = BASE_PORT + i;
        // Use localhost or public IP based on flag
        const ipToUse = useLocalhost ? '127.0.0.1' : publicIp;
        const peers = [`${ipToUse}:${firstNodePort}`]; // Only connect to first node initially

        await startNode(port, peers);
        await new Promise(resolve => setTimeout(resolve, 500));
    }
}

function stopNode(port) {
    const node = NODES.find(n => n.port === port);
    if (node && node.process) {
        console.log(`\nStopping node on port ${port}...`);
        try {
            // First try SIGTERM for graceful shutdown
            node.process.kill('SIGTERM');

            // Then force with SIGKILL after a short delay if needed
            setTimeout(() => {
                try {
                    if (node.process && !node.process.killed) {
                        node.process.kill('SIGKILL');
                    }
                } catch (e) {
                    // Ignore errors during forced shutdown
                }
            }, 500);

            node.process = null;
        } catch (error) {
            console.error(`Error stopping node on port ${port}:`, error.message);
        }
    } else {
        console.log(`Node on port ${port} is not running!`);
    }
}

async function startNodeManually(port) {
    const existingNode = NODES.find(n => n.port === port);
    if (existingNode && existingNode.process) {
        console.log(`Node ${port} is already running.`);
        return;
    }

    console.log(`Starting node on port: ${port}...`);

    const activePeers = NODES
        .filter(n => n.process && n.port !== port)
        .map(n => `127.0.0.1:${n.port}`);

    await startNode(port, activePeers);
}


async function sendTransaction(fromPort, toPort) {
    const senderNode = NODES.find(n => n.port === fromPort);
    const receiverNode = NODES.find(n => n.port === toPort);

    if (!senderNode || !receiverNode) {
        console.log("Invalid sender or receiver port!");
        return;
    }
    
    // First get the actual node IDs from their status endpoint
    let senderNodeId, receiverNodeId;
    try {
        // Get sender's nodeId
        const senderResponse = await fetch(`http://127.0.0.1:${fromPort}/status`);
        const senderData = await senderResponse.json();
        senderNodeId = senderData.nodeId;
        
        // Get receiver's nodeId
        const receiverResponse = await fetch(`http://127.0.0.1:${toPort}/status`);
        const receiverData = await receiverResponse.json();
        receiverNodeId = receiverData.nodeId;
        
        // console.log(`Got actual nodeIds: sender=${senderNodeId}, receiver=${receiverNodeId}`);
    } catch (error) {
        console.error("Could not get node IDs, using fallback format:", error.message);
        senderNodeId = `node_${senderNode.port}`;
        receiverNodeId = `node_${receiverNode.port}`;
    }
    
    // Ask for transaction amount
    return new Promise((resolve) => {
        rl.question("Enter amount to send: ", async (amountInput) => {
            const amount = parseInt(amountInput);
            
            if (isNaN(amount) || amount <= 0) {
                console.log("Invalid amount. Must be a positive number.");
                resolve();
                return;
            }
            
            const transaction = {
                id: `tx_${Math.random().toString(36).substring(7)}`,
                sender: senderNodeId,
                receiver: receiverNodeId,
                amount: amount,
                timestamp: Date.now()
            };

            console.log(`\nSending transaction ${transaction.id} from ${transaction.sender} to ${transaction.receiver}`);

            // Use localhost or fetch public IP based on flag
            let ipToUse;
            if (useLocalhost) {
                ipToUse = '127.0.0.1';
            } else {
                try {
                    ipToUse = await fetch('https://api.ipify.org').then(r => r.text());
                } catch (error) {
                    console.error('Failed to get public IP for transaction.');
                    resolve();
                    return;
                }
            }

            try {
                const response = await fetch(`http://${ipToUse}:${senderNode.port}/inv`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(transaction)
                });

                const responseData = await response.json();

                if (response.ok) {
                    console.log(`Transaction ${transaction.id} sent to node ${receiverNode.port}`);
                } else {
                    console.error(`Failed to send transaction ${transaction.id}`);
                }
            } catch (error) {
                console.error(`Error sending transaction: ${error.message}`);
            }
            
            resolve();
        });
    });
}

async function sendBlock(fromPort) {

    const senderNode = NODES.find(n => n.port === fromPort);

    if (!senderNode) {
        console.log("Invalid sender port!");
        return;
    }

    // Use localhost or fetch public IP based on flag
    let ipToUse;
    if (useLocalhost) {
        ipToUse = '127.0.0.1';
    } else {
        try {
            ipToUse = await fetch('https://api.ipify.org').then(r => r.text());
        } catch (error) {
            console.error('Failed to get public IP for block creation.');
            return;
        }
    }

    try {
        // Fetch transactions from the selected node
        const inventoryResponse = await fetch(`http://${ipToUse}:${fromPort}/inventory`);
        const inventoryData = await inventoryResponse.json();
        const transactions = inventoryData.transactions.length > 0 ? inventoryData.transactions : [];

        const block = {
            id: `block_${Math.random().toString(36).substring(7)}`,
            transactions: transactions,
            timestamp: Date.now()
        };

        console.log(`\nSending block ${block.id} from node ${fromPort} with ${transactions.length} transactions.`);

        const response = await fetch(`http://${ipToUse}:${fromPort}/block`, {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(block)
        });

        if (response.ok) {
            console.log(`Block ${block.id} added successfully to node ${fromPort}`);
        } else {
            console.error(`Failed to add block ${block.id}`);
        }
    } catch (error) {
        console.error(`Error adding block: ${error.message}`);
    }
}


async function showInventory(port) {
    // Use localhost or fetch public IP based on flag
    let ipToUse;
    if (useLocalhost) {
        ipToUse = '127.0.0.1';
    } else {
        try {
            ipToUse = await fetch('https://api.ipify.org').then(r => r.text());
        } catch (error) {
            console.error('Failed to get public IP for inventory check.');
            return;
        }
    }

    try {
        const response = await fetch(`http://${ipToUse}:${port}/inventory`);
        const data = await response.json();

        console.log(`\nInventory of node on port ${port}:`);

        if (data.blocks.length > 0) {
            console.log("\nBlocks:");
            console.table(data.blocks);
        } else {
            console.log("No blocks found.");
        }

        if (data.transactions.length > 0) {
            console.log("\nPending Transactions:");
            console.table(data.transactions);
        } else {
            console.log("No pending transactions.");
        }
    } catch (error) {
        console.error("Error fetching inventory:", error.message);
    }
}

async function showNetworkStatus() {
    // Use localhost or fetch public IP based on flag
    let ipToUse;
    if (useLocalhost) {
        ipToUse = '127.0.0.1';
    } else {
        try {
            ipToUse = await fetch('https://api.ipify.org').then(r => r.text());
        } catch (error) {
            console.error('Failed to get public IP for network status check.');
            return;
        }
    }

    const stats = [];
    for (const node of NODES) {
        try {
            const response = await fetch(`http://${ipToUse}:${node.port}/status`);
            const inventoryResponse = await fetch(`http://${ipToUse}:${node.port}/inventory`);

            const data = await response.json();
            const inventoryData = await inventoryResponse.json();

            const peerList = data.connections.map(peer => peer.port).join(", ") || "None";
            stats.push({
                Port: data.port,
                PeerList: peerList,
                ActiveConnections: data.activeConnections,
                Transactions: inventoryData.transactions.length,
                Blocks: inventoryData.blocks.length
            });
        } catch (error) {
            console.error(`Cannot get info from node on port ${node.port}`);
        }
    }
    console.log("\nNetwork Statistics:");
    console.table(stats);
}

async function listActiveNodes() {
    const activeNodes = NODES.filter(n => n.process && !n.process.killed);
    if (activeNodes.length === 0) {
        console.log("No active nodes available!");
        return [];
    }

    console.log("\nActive Nodes:");
    activeNodes.forEach(n => console.log(`- Port: ${n.port}`));
    return activeNodes.map(n => n.port);
}

// Check node balances
async function checkBalances(port) {
    let ipToUse;
    if (useLocalhost) {
        ipToUse = '127.0.0.1';
    } else {
        try {
            ipToUse = await fetch('https://api.ipify.org').then(r => r.text());
        } catch (error) {
            console.error('Failed to get public IP for balance check.');
            return;
        }
    }

    try {
        const response = await fetch(`http://${ipToUse}:${port}/balance`);
        const data = await response.json();

        console.log(`\nBalances from node on port ${port}:`);
        
        if (data.balances && Object.keys(data.balances).length > 0) {
            const balanceTable = Object.entries(data.balances).map(([nodeId, balance]) => ({
                Node: nodeId,
                Balance: balance
            }));
            console.table(balanceTable);
        } else {
            console.log("No balance information available.");
        }
    } catch (error) {
        console.error("Error fetching balances:", error.message);
    }
}

// Function to perform automated simulation
async function runSimulation(durationSecs) {
    console.log(`\nStarting simulation for ${durationSecs} seconds...`);
    
    // Get active nodes
    const activePorts = await listActiveNodes();
    if (activePorts.length < 2) {
        console.log("Need at least 2 active nodes to run simulation.");
        return showMenu();
    }
    
    let txCount = 0;
    let blockCount = 0;
    
    // Store node IDs for faster lookups
    const nodeIds = {};
    for (const port of activePorts) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/status`);
            const data = await response.json();
            nodeIds[port] = data.nodeId;
        } catch (error) {
            nodeIds[port] = `node_${port}`;
        }
    }
    
    // Function to send a random transaction
    const sendRandomTransaction = async () => {
        // Pick random sender and receiver ports
        const fromPortIndex = Math.floor(Math.random() * activePorts.length);
        let toPortIndex;
        do {
            toPortIndex = Math.floor(Math.random() * activePorts.length);
        } while (toPortIndex === fromPortIndex);
        
        const fromPort = activePorts[fromPortIndex];
        const toPort = activePorts[toPortIndex];
        
        // Check sender's balance
        let senderBalance = 0;
        try {
            const response = await fetch(`http://127.0.0.1:${fromPort}/balance`);
            const data = await response.json();
            const senderNodeId = nodeIds[fromPort];
            senderBalance = data.balances[senderNodeId] || 0;
        } catch (error) {
            console.error(`Error fetching balance for node on port ${fromPort}:`, error.message);
            return;
        }
        
        // Only proceed if sender has funds
        if (senderBalance > 0) {
            // Generate random amount between 1 and sender's balance
            const amount = Math.floor(Math.random() * senderBalance) + 1;
            
            // Prepare transaction
            const transaction = {
                id: `tx_${Math.random().toString(36).substring(7)}`,
                sender: nodeIds[fromPort],
                receiver: nodeIds[toPort],
                amount: amount,
                timestamp: Date.now()
            };
            
            // Send transaction
            try {
                const response = await fetch(`http://127.0.0.1:${fromPort}/inv`, {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify(transaction)
                });
                
                if (response.ok) {
                    console.log(`TX ${txCount+1}: ${transaction.sender} sent ${amount} to ${transaction.receiver}`);
                    txCount++;
                }
            } catch (error) {
                console.error(`Error sending transaction:`, error.message);
            }
        }
    };
    
    // Function to mine a block
    const mineRandomBlock = async () => {
        // Pick a random node to mine
        const minerPortIndex = Math.floor(Math.random() * activePorts.length);
        const minerPort = activePorts[minerPortIndex];
        const minerId = nodeIds[minerPort];
        
        console.log(`\n=== SIMULATION BLOCK MINING DEBUG ===`);
        console.log(`Selected miner: ${minerId} on port ${minerPort}`);
        
        try {
            // First get the blockchain state before mining
            console.log(`Checking blockchain state before mining...`);
            const beforeInventoryResponse = await fetch(`http://127.0.0.1:${minerPort}/inventory`);
            const beforeInventoryData = await beforeInventoryResponse.json();
            const beforeBlockCount = beforeInventoryData.blocks ? beforeInventoryData.blocks.length : 0;
            const pendingTxCount = beforeInventoryData.transactions ? beforeInventoryData.transactions.length : 0;
            
            console.log(`Current state: ${beforeBlockCount} blocks, ${pendingTxCount} pending transactions`);
            
            if (pendingTxCount === 0) {
                console.log(`No transactions to mine - skipping block creation`);
                return null;
            }
            
            // Limit the number of transactions in a block for stability
            // Too many transactions might cause network congestion or timeouts
            const maxTxPerBlock = 10; // Reasonable limit for a simulation
            if (pendingTxCount > maxTxPerBlock) {
                console.log(`Limiting mining to first ${maxTxPerBlock} of ${pendingTxCount} pending transactions for stability`);
            }
            
            // Mine the block
            console.log(`Mining block with ${Math.min(pendingTxCount, maxTxPerBlock)} of ${pendingTxCount} pending transactions`);
            const block = await mineBlock(minerId, '', 1, 4, minerPort, useLocalhost);
            
            if (block && block.hash) {
                // Wait longer for network propagation and block processing
                console.log(`Block mined with hash ${block.hash}. Waiting for propagation...`);
                await new Promise(resolve => setTimeout(resolve, 500));
                
                // Verify the block was added to the blockchain
                const afterInventoryResponse = await fetch(`http://127.0.0.1:${minerPort}/inventory`);
                const afterInventoryData = await afterInventoryResponse.json();
                const afterBlockCount = afterInventoryData.blocks ? afterInventoryData.blocks.length : 0;
                const afterPendingTxCount = afterInventoryData.transactions ? afterInventoryData.transactions.length : 0;
                
                console.log(`After mining: ${afterBlockCount} blocks, ${afterPendingTxCount} pending transactions`);
                
                let success = false;
                
                if (afterBlockCount > beforeBlockCount) {
                    console.log(`SUCCESS: Block was added to blockchain! (${beforeBlockCount} -> ${afterBlockCount})`);
                    blockCount++;
                    success = true;
                } else {
                    console.log(`FAILURE: Block was not added to blockchain! Still at ${afterBlockCount} blocks`);
                    
                    // Check consensus information
                    if (afterInventoryData.consensus) {
                        console.log(`Consensus info: Current head ${afterInventoryData.consensus.currentHead}, chain height ${afterInventoryData.consensus.chainHeight}`);
                    }
                    
                    // Double-check if our block hash is in the blockchain
                    const blockExists = afterInventoryData.blocks.includes(block.hash) || 
                                      (Array.isArray(afterInventoryData.blocks) && 
                                       afterInventoryData.blocks.some(b => typeof b === 'object' && b.hash === block.hash));
                    
                    console.log(`Block hash ${block.hash} exists in blockchain: ${blockExists}`);
                    
                    if (blockExists) {
                        console.log(`Block exists but count didn't increase. Considering this a success.`);
                        blockCount++;
                        success = true;
                    }
                }
                
                // Also check if transactions were processed
                console.log(`Transaction processing: ${pendingTxCount} -> ${afterPendingTxCount}`);
                if (afterPendingTxCount < pendingTxCount) {
                    console.log(`SUCCESS: ${pendingTxCount - afterPendingTxCount} transactions were processed`);
                    success = true;
                } else {
                    console.log(`FAILURE: No transactions were processed`);
                }
                
                return success ? block : null;
            } else {
                console.log(`FAILURE: Block mining failed, no block returned`);
                return null;
            }
        } catch (error) {
            console.error(`Error mining block:`, error.message);
            return null;
        }
    };
    
    // Start simulation
    const endTime = Date.now() + (durationSecs * 1000);
    let transactionCounter = 0;
    
    // Use setTimeout for each action to avoid blocking
    const simulationStep = async () => {
        if (Date.now() < endTime) {
            console.log(`\n=== SIMULATION STEP (Remaining: ${Math.ceil((endTime - Date.now()) / 1000)}s) ===`);
            
            // Every 4th step, mine a block instead of sending a transaction
            // This ensures we periodically mine regardless of transaction count success
            const shouldMineThisStep = (Math.floor(Math.random() * 4) === 0) || transactionCounter >= 3;
            
            if (shouldMineThisStep) {
                console.log(`Mining step - transaction counter: ${transactionCounter}/3`);
                
                // First check if there are any pending transactions
                const randomPort = activePorts[Math.floor(Math.random() * activePorts.length)];
                try {
                    const response = await fetch(`http://127.0.0.1:${randomPort}/inventory`);
                    const data = await response.json();
                    const pendingTxCount = data.transactions ? data.transactions.length : 0;
                    
                    if (pendingTxCount > 0) {
                        console.log(`Found ${pendingTxCount} pending transactions - mining block...`);
                        
                        // If there are too many pending transactions, it might indicate a problem
                        // Let's log a warning and continue with mining to try to clear them
                        if (pendingTxCount > 20) {
                            console.log(`WARNING: Large number of pending transactions (${pendingTxCount}). This may indicate a processing issue.`);
                        }
                        
                        // Give network time to propagate transactions before mining
                        console.log(`Waiting for transaction propagation before mining...`);
                        await new Promise(resolve => setTimeout(resolve, 400));
                        
                        const result = await mineRandomBlock();
                        transactionCounter = 0; // Reset counter after mining
                        
                        // Give a longer time after mining to let things settle
                        console.log(`Waiting for block propagation...`);
                        await new Promise(resolve => setTimeout(resolve, 800));
                        
                        // If block mining was successful, give even more time for propagation
                        if (result) {
                            console.log(`Block mining succeeded, giving extra time for propagation...`);
                            await new Promise(resolve => setTimeout(resolve, 500));
                        }
                    } else {
                        console.log(`No pending transactions to mine - skipping mining step`);
                    }
                } catch (error) {
                    console.error(`Error checking pending transactions:`, error.message);
                }
            } else {
                // Send a transaction
                await sendRandomTransaction();
                transactionCounter++;
                console.log(`Transaction counter: ${transactionCounter}/3`);
            }
            
            // Schedule next action with a longer delay for stability
            const nextStepDelay = 300; // Increased delay between steps for better stability
            console.log(`Scheduling next simulation step in ${nextStepDelay}ms...`);
            setTimeout(simulationStep, nextStepDelay);
        } else {
            // Mine any remaining transactions
            if (transactionCounter > 0) {
                console.log(`\n=== FINAL MINING (${transactionCounter} pending transactions) ===`);
                await new Promise(resolve => setTimeout(resolve, 300));
                await mineRandomBlock();
            }
            
            // Simulation complete
            console.log(`\n=== SIMULATION COMPLETE ===`);
            console.log(`Created ${txCount} transactions and ${blockCount} blocks.`);
            showMenu();
        }
    };
    
    // Start the simulation
    simulationStep();
}

async function showMenu() {
    rl.question("\nChoose from menu: \n"
        + " Start node (stn)\n"
        + " Stop node (sn)\n"
        + " Send transaction (st)\n"
        + " Show inventory (si)\n"
        + " Show network status (ns)\n"
        + " Mine block (mb)\n"
        + " Check balances (bal)\n"
        + " Run simulation (sim)\n"
        + " Exit (exit)\n"
        + " ➤ ", async (input) => {

        if (input === 'stn') {
            rl.question("Type port number to start: ", async (port) => {
                const parsedPort = parseInt(port);
                if (!isNaN(parsedPort)) {
                    await startNodeManually(parsedPort);
                }
                showMenu();
            });
        } else if (input === 'sn') {
            listActiveNodes()
            rl.question("Type port number to stop: ", (port) => {
                stopNode(parseInt(port));
                showMenu();
            });
        } else if (input === 'st') {
            listActiveNodes()
            rl.question("From (port nr): ", (fromPort) => {
                rl.question("To (port nr): ", async (toPort) => {
                    const from = parseInt(fromPort);
                    const to = parseInt(toPort);

                    if (isNaN(from) || isNaN(to)) {
                        console.log(" Invalid input... Please enter valid and different port numbers.");
                        return showMenu();
                    }
                    await sendTransaction(from, to).then(() => showMenu());
                });
            });
        } else if (input === 'bal') {
            rl.question("Type port number to check balances: ", (port) => {
                const parsedPort = parseInt(port);
                if (isNaN(parsedPort)) {
                    console.log("Invalid port number.");
                    return showMenu();
                }
                checkBalances(parsedPort).then(() => showMenu());
            });
        } else if (input === 'si') {
            rl.question("Type port number: ", (port) => {
                showInventory(port).then(() => showMenu());
            });
        } else if (input === 'mb') {
            listActiveNodes().then(activePorts => {
                rl.question("From which node (port nr) to mine block: ", async (port) => {
                    const parsedPort = parseInt(port);
                    const node = NODES.find(n => n.port === parsedPort);

                    if (!node) {
                        console.log("Invalid node.");
                        return showMenu();
                    }

                    // Get the actual node ID 
                    let nodeId;
                    try {
                        const response = await fetch(`http://127.0.0.1:${parsedPort}/status`);
                        const data = await response.json();
                        nodeId = data.nodeId;
                        // console.log(`Using actual nodeId for mining: ${nodeId}`);
                    } catch (error) {
                        nodeId = `node_${parsedPort}`;
                        console.error(`Could not get node ID, using fallback: ${nodeId}`, error.message);
                    }
                    
                    await mineBlock(nodeId, '', 1, 4, parsedPort, useLocalhost);
                    return showMenu();
                });
            });
        } else if (input === 'sim') {
            rl.question("Enter simulation duration in seconds: ", (seconds) => {
                const duration = parseInt(seconds);
                if (isNaN(duration) || duration <= 0) {
                    console.log("Please enter a valid positive number.");
                    return showMenu();
                }
                runSimulation(duration);
            });
        } else if (input === 'ns') {
            showNetworkStatus().then(() => showMenu());
        } else if (input === 'exit') {
            console.log("Exiting...");
            rl.close();

            // Kill all node processes before exiting
            console.log("Shutting down all nodes...");
            NODES.forEach(node => {
                if (node.process) {
                    try {
                        node.process.kill('SIGTERM');
                    } catch (e) {
                        // Ignore errors during shutdown
                    }
                }
            });

            // Allow time for processes to terminate gracefully
            setTimeout(() => {
                // Force kill any remaining processes
                let remainingNodes = NODES.filter(n => n.process && !n.process.killed);
                if (remainingNodes.length > 0) {
                    console.log(`Forcefully terminating ${remainingNodes.length} remaining nodes...`);
                    remainingNodes.forEach(node => {
                        try {
                            if (node.process) {
                                node.process.kill('SIGKILL');
                            }
                        } catch (e) {
                            // Ignore errors
                        }
                    });
                }

                // Final exit
                console.log("All nodes shut down. Exiting.");
                process.exit(0);
            }, 1000);
        } else {
            console.log("Invalid input, please try again.");
            showMenu();
        }
    });
}

// Function to clean up all processes
function cleanupAllProcesses() {
    console.log("\nShutting down all nodes...");

    // Try graceful shutdown first
    NODES.forEach(node => {
        if (node.process) {
            try {
                node.process.kill('SIGTERM');
            } catch (e) {
                // Ignore errors during shutdown
            }
        }
    });

    // Force kill after short delay
    setTimeout(() => {
        NODES.forEach(node => {
            if (node.process && !node.process.killed) {
                try {
                    node.process.kill('SIGKILL');
                } catch (e) {
                    // Ignore errors
                }
            }
        });

        console.log("All nodes have been terminated.");
        process.exit(0);
    }, 1000);
}

// Handle various exit signals
process.on('SIGINT', () => {
    console.log("\nReceived SIGINT (Ctrl+C). Cleaning up...");
    cleanupAllProcesses();
});

process.on('SIGTERM', () => {
    console.log("\nReceived SIGTERM. Cleaning up...");
    cleanupAllProcesses();
});

// Run test
(async () => {
    await startNodes();
    setTimeout(() => console.log("\n⏳ Waiting for nodes to stabilize...\n"), 2000);
    setTimeout(() => showMenu(), 3000);
})();
