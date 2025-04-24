//start-nodes.mjs
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Track all child processes
const childProcesses = [];

// Parse command line arguments
const args = process.argv.slice(2);
// Look for bootstrap peer parameter
const bootstrapPeerArg = args.find(arg => arg.startsWith('--peer='));
const bootstrapPeer = bootstrapPeerArg ? bootstrapPeerArg.split('=')[1] : null;
// Allow customizing number of nodes and base port
const numNodesArg = args.find(arg => arg.startsWith('--nodes='));
const basePortArg = args.find(arg => arg.startsWith('--port='));
const basePort = basePortArg ? parseInt(basePortArg.split('=')[1]) : 3000;
const numNodes = numNodesArg ? parseInt(numNodesArg.split('=')[1]) : 5;
// Check if we should use localhost for testing
const useLocalhost = args.includes('--localhost');

const startNode = (port, peer = null) => {
    const args = ['index.mjs', port.toString()];
    
    // Add the localhost flag if needed
    if (useLocalhost) {
        args.push('--localhost');
    }
    
    if (peer) {
        if (typeof peer === 'string') {
            // Single peer - use --peer parameter
            args.push(`--peer=${peer}`);
        } else if (Array.isArray(peer)) {
            // Multiple peers - use --peers parameter
            args.push(`--peers=${peer.join(',')}`);
        }
    }

    const node = spawn('node', args, {
        cwd: __dirname,
        stdio: ['inherit', 'pipe', 'pipe'],
        detached: false // Ensure the child process is attached to parent
    });

    node.stdout.on('data', (data) => {
        console.log(`[Node ${port}] ${data}`);
    });

    node.stderr.on('data', (data) => {
        console.error(`[Node ${port}] Error: ${data}`);
    });
    
    // Track exit for cleanup
    node.on('exit', (code, signal) => {
        console.log(`Node ${port} exited with code ${code} and signal ${signal || 'none'}`);
        const index = childProcesses.indexOf(node);
        if (index > -1) {
            childProcesses.splice(index, 1);
        }
    });
    
    // Add to tracked processes
    childProcesses.push(node);
    
    return node;
};

const nodes = [];

// Start bootstrap node, possibly with external peer
if (bootstrapPeer) {
    console.log(`Using external bootstrap peer: ${bootstrapPeer}`);
    nodes.push(startNode(basePort, bootstrapPeer));
} else {
    console.log('Starting as a new network without bootstrap peer');
    nodes.push(startNode(basePort));
}

// Wait a bit for the first node to start
setTimeout(async () => {
    // Determine the IP to use
    let ip;
    
    if (useLocalhost) {
        ip = '127.0.0.1';
        console.log(`Using localhost (127.0.0.1) for local testing`);
        startRemainingNodes(ip);
    } else {
        try {
            // Get public IP for regular operation
            ip = await fetch('https://api.ipify.org').then(r => r.text());
            console.log(`Using public IP: ${ip}`);
            startRemainingNodes(ip);
        } catch (error) {
            console.error('Failed to get public IP. This is required for the application to work properly.');
            process.exit(1);
        }
    }
    
    // Start the remaining nodes
    function startRemainingNodes(ipAddress) {
        let i = 1;
        const startNextNode = () => {
            if (i < numNodes) {
                const port = basePort + i;
                // Always connect to our first node as the peer
                nodes.push(startNode(port, `${ipAddress}:${basePort}`));
                i++;
                setTimeout(startNextNode, 1000);  // Start next node after 1 second
            }
        };
        startNextNode();
    }
}, 2000);

// Handle cleanup for various exit scenarios
function cleanup() {
    console.log('Shutting down all nodes...');
    // Kill all tracked child processes
    for (const node of childProcesses) {
        try {
            if (!node.killed) {
                // Try SIGTERM first for graceful shutdown
                node.kill('SIGTERM');
                
                // If still running after a brief delay, use SIGKILL
                setTimeout(() => {
                    try {
                        if (!node.killed) {
                            node.kill('SIGKILL');
                        }
                    } catch (e) {
                        // Ignore errors during forced kill
                    }
                }, 500);
            }
        } catch (error) {
            console.error(`Error killing node: ${error.message}`);
            // Try force kill if regular kill fails
            try {
                process.kill(node.pid, 'SIGKILL');
            } catch (e) {
                // Last resort failed
            }
        }
    }
}

// Handle various exit signals
process.on('SIGINT', () => {
    console.log('Received SIGINT, cleaning up...');
    cleanup();
    
    // Give processes time to terminate gracefully before we force exit
    setTimeout(() => {
        console.log('Exiting after cleanup');
        process.exit(0);
    }, 1000);
});

process.on('SIGTERM', () => {
    console.log('Received SIGTERM, cleaning up...');
    cleanup();
    
    // Give processes time to terminate gracefully before we force exit
    setTimeout(() => {
        console.log('Exiting after cleanup');
        process.exit(0);
    }, 1000);
});

// This might be called multiple times, so make it idempotent
let cleanupDone = false;
process.on('exit', () => {
    if (!cleanupDone) {
        cleanupDone = true;
        cleanup();
    }
});

// Handle uncaught exceptions to ensure cleanup
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    cleanup();
    
    // Give processes time to terminate before we force exit
    setTimeout(() => {
        console.log('Exiting after cleanup');
        process.exit(1);
    }, 1000);
});

