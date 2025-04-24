// network.mjs
import fs from 'fs';

const PEER_EXCHANGE_INTERVAL = 30000; // 30 seconds
export const PEER_TIMEOUT = 600000; // 10 minutes
const MAX_INTERNAL_CONNECTIONS = 4;
const MAX_EXTERNAL_CONNECTIONS = 4;

const PEER_FILE = 'peers.json'

const nodes = new Map();
const activeConnections = new Map();

// Save peers every 60 seconds
function savePeers() {
    fs.writeFileSync(PEER_FILE, JSON.stringify(Array.from(nodes.values()), null, 2));
}

setInterval(savePeers, 60000);

export async function bootstrap(initialPeers, selfInfo) {
    const selfGroup = determineGroup(selfInfo.nodeId);
    console.log(`Node ${selfInfo.nodeId} (${selfInfo.ip}:${selfInfo.port}) is bootstrapping from peers: ${initialPeers.join(', ') || 'None'}`);
    
    // Handle case with no initial peers
    if (initialPeers.length === 0) {
        console.log("No initial peers provided. Starting as bootstrap node.");
        return null;
    }
    
    const requests = initialPeers.map(async (peerAddress) => {
        if (!peerAddress) return null;
        
        const [ip, port] = peerAddress.split(':');
        if (!ip || !port) {
            console.error(`Invalid peer address format: ${peerAddress}. Expected format: ip:port`);
            return null;
        }
        
        try {
            console.log(`Bootstrapping from ${ip}:${port}`);
            const response = await fetch(`http://${ip}:${port}/register`, {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify(selfInfo)
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const data = await response.json();
            console.log(`Node ${selfInfo.nodeId} successfully bootstrapped from ${ip}:${port}`);
            
            // Process the bootstrap peer's inventory
            if (data.blocks && Array.isArray(data.blocks)) {
                console.log(`Received ${data.blocks.length} blocks from bootstrap peer`);
                // The inventory will be handled by index.mjs when it receives the response
            }
            
            if (data.transactions && Array.isArray(data.transactions)) {
                console.log(`Received ${data.transactions.length} transactions from bootstrap peer`);
                // The inventory will be handled by index.mjs when it receives the response
            }
            
            return {ip, port, data};
        } catch (error) {
            console.error(`Failed to bootstrap from ${ip}:${port}:`, error.message);
            return null;
        }
    });

    const results = await Promise.allSettled(requests);
    let bootstrapResult = null;
    
    // First, add the direct bootstrap nodes we successfully connected to
    for (const result of results) {
        if (result.status !== "fulfilled" || !result.value) continue;

        const { ip, port, data } = result.value;
        
        // Skip if we didn't get valid data
        if (!data || !data.nodeId) continue;
        
        // Store the first successful result for return value
        if (!bootstrapResult) {
            bootstrapResult = result.value;
        }
        
        // Add the bootstrap node first (these have priority)
        addPeer(ip, port, selfInfo.port, selfInfo.ip, data.nodeId, selfInfo.nodeId, "bootstrap");
        
        // Get current connection counts
        const activeConns = getActivePeers();
        const internalCount = activeConns.filter(p => p.group === selfGroup).length;
        const externalCount = activeConns.filter(p => p.group !== selfGroup).length;
        
        // If we already have enough connections, don't process additional peers
        if (internalCount >= MAX_INTERNAL_CONNECTIONS && externalCount >= MAX_EXTERNAL_CONNECTIONS) {
            console.log("Connection limits reached during bootstrap, not processing additional peers");
            break;
        }
        
        // Process additional peers from this bootstrap node
        if (data.peers && Array.isArray(data.peers)) {
            console.log(`Received ${data.peers.length} peers from bootstrap node ${ip}:${port}`);
            
            // Shuffle peers to get a random subset
            const shuffledPeers = [...data.peers].sort(() => Math.random() - 0.5);
            
            // Process peers up to our connection limits
            for (const peer of shuffledPeers) {
                if (peer && peer.ip && peer.port && peer.nodeId) {
                    // Check connection counts again before each peer
                    const currentActiveConns = getActivePeers();
                    const currentInternalCount = currentActiveConns.filter(p => p.group === selfGroup).length;
                    const currentExternalCount = currentActiveConns.filter(p => p.group !== selfGroup).length;
                    
                    // If we've reached our limits, stop processing peers
                    if (currentInternalCount >= MAX_INTERNAL_CONNECTIONS && 
                        currentExternalCount >= MAX_EXTERNAL_CONNECTIONS) {
                        break;
                    }
                    
                    // Otherwise, try to add this peer
                    addPeer(peer.ip, peer.port, selfInfo.port, selfInfo.ip, peer.nodeId, selfInfo.nodeId, "bootstrap peers");
                }
            }
        }
    }
    
    return bootstrapResult;
}

export function startPeerExchange(nodeInfo) {
    let exchangeInProgress = false;

    setInterval(async () => {
        if (exchangeInProgress) {
            return; // Skip if previous exchange is still running
        }

        exchangeInProgress = true;
        
        try {
            // Get current active peers
            const peers = getActivePeers();
            const selfGroup = determineGroup(nodeInfo.nodeId);
            
            // Count current connections
            const internalCount = peers.filter(p => p.group === selfGroup).length;
            const externalCount = peers.filter(p => p.group !== selfGroup).length;
            
            // Log current connection status
            console.log(`Peer exchange status: ${peers.length} total connections ` +
                `(${internalCount} internal, ${externalCount} external)`);
            
            // Check if we need to find new peers because we don't have enough connections
            const needMoreInternalPeers = internalCount < MAX_INTERNAL_CONNECTIONS;
            const needMoreExternalPeers = externalCount < MAX_EXTERNAL_CONNECTIONS;
            
            // Skip peer exchange only if we have maximum connections in both categories
            if (!needMoreInternalPeers && !needMoreExternalPeers) {
                console.log("Connection limits reached, skipping peer exchange");
                return;
            }
            
            // Process active peers to get their peer lists
            for (const peer of peers) {
                if (peer.retries > 3) continue; // Skip peers with too many retries

                try {
                    const response = await fetch(`http://${peer.ip}:${peer.port}/peers`);
                    const remotePeers = await response.json();

                    // Reset retries on successful connection
                    peer.retries = 0;
                    peer.lastSeen = Date.now();

                    // Filter and separate peers by group, then shuffle each group
                    const validPeers = remotePeers.filter(p => p.nodeId && p.ip && p.port);
                    
                    // Split peers by group relative to our node
                    const internalPeers = validPeers
                        .filter(p => determineGroup(p.nodeId) === selfGroup)
                        .sort(() => Math.random() - 0.5);
                        
                    const externalPeers = validPeers
                        .filter(p => determineGroup(p.nodeId) !== selfGroup)
                        .sort(() => Math.random() - 0.5);
                    
                    // Process internal peers first if we need them
                    if (needMoreInternalPeers && internalPeers.length > 0) {
                        console.log(`Found ${internalPeers.length} potential internal peers to connect to`);
                        for (const p of internalPeers) {
                            const currentActiveConns = getActivePeers();
                            const currentInternalCount = currentActiveConns.filter(p => p.group === selfGroup).length;
                            
                            if (currentInternalCount >= MAX_INTERNAL_CONNECTIONS) {
                                console.log("Internal connection limit reached, stopping internal peer search");
                                break;
                            }
                            
                            // Add this internal peer
                            addPeer(p.ip, p.port, nodeInfo.port, nodeInfo.ip, p.nodeId, nodeInfo.nodeId, "peer exchange");
                        }
                    }
                    
                    // Then process external peers if we need them
                    if (needMoreExternalPeers && externalPeers.length > 0) {
                        console.log(`Found ${externalPeers.length} potential external peers to connect to`);
                        for (const p of externalPeers) {
                            const currentActiveConns = getActivePeers();
                            const currentExternalCount = currentActiveConns.filter(p => p.group !== selfGroup).length;
                            
                            if (currentExternalCount >= MAX_EXTERNAL_CONNECTIONS) {
                                console.log("External connection limit reached, stopping external peer search");
                                break;
                            }
                            
                            // Add this external peer
                            addPeer(p.ip, p.port, nodeInfo.port, nodeInfo.ip, p.nodeId, nodeInfo.nodeId, "peer exchange");
                        }
                    }
                    
                    // If we've reached both limits, no need to continue with other peers
                    const updatedPeers = getActivePeers();
                    const updatedInternalCount = updatedPeers.filter(p => p.group === selfGroup).length;
                    const updatedExternalCount = updatedPeers.filter(p => p.group !== selfGroup).length;
                    
                    if (updatedInternalCount >= MAX_INTERNAL_CONNECTIONS && 
                        updatedExternalCount >= MAX_EXTERNAL_CONNECTIONS) {
                        console.log("Connection limits reached during peer exchange, stopping");
                        break;
                    }
                } catch (error) {
                    peer.retries++;
                    if (peer.retries > 3) {
                        console.log(`Removing unresponsive peer ${peer.id}`);
                        removePeer(peer.id);
                        
                        // If we lost a connection, we should try to replace it immediately
                        // We'll attempt to establish a new connection from our known nodes
                        tryReplaceDisconnectedPeer(peer, selfGroup, nodeInfo.nodeId, nodeInfo.port, nodeInfo.ip);
                    }
                }
            }
        } finally {
            exchangeInProgress = false;
        }
    }, PEER_EXCHANGE_INTERVAL);
}


export function addPeer(ip, port, selfPort, selfIp, nodeId, selfNodeId, location = 'unknown') {
    if (!nodeId || !ip || !port || !selfIp) {
        console.error('Attempted to add peer without required fields:', {ip, port, nodeId, selfIp});
        return;
    }


    if (nodeId === selfNodeId) {
        return ;
    }
    // // Prevent self-connection (loopback prevention)
    // if (port === selfPort && (ip === selfIp || ip === '127.0.0.1' || ip === 'localhost')) {
    //     return;
    // }


    const existingPeer = nodes.get(nodeId);

    if (existingPeer) {
        // Update last seen timestamp for existing peer
        existingPeer.lastSeen = Date.now();
        return;
    }


    // Create new peer
    const peer = {
        id: nodeId,
        ip,
        port,
        lastSeen: Date.now(),
        retries: 0,
        group: determineGroup(nodeId)
    };

    console.log(`Adding new peer (${ip}:${port}) to group ${peer.group}`);

    nodes.set(nodeId, peer);

    // Batch propagation for efficiency (avoid per-peer calls)
    // Only propagate if we actually have active connections
    if (nodes.size % 10 === 0 && activeConnections.size > 0) {
        propagateToActivePeers({peers: Array.from(nodes.values()).slice(-10)});
    }

    // Connection attempts are throttled to avoid overwhelming the network
    const ourOutgoingConnections = Array.from(activeConnections.values());
    const selfGroup = determineGroup(selfNodeId);
    const peerGroup = determineGroup(nodeId);
    
    // Count our outgoing connections by group
    const outgoingInternalConns = ourOutgoingConnections.filter(p => p.group === selfGroup).length;
    const outgoingExternalConns = ourOutgoingConnections.filter(p => p.group !== selfGroup).length;
    
    // Only attempt connection if we haven't reached our limits
    if ((peerGroup === selfGroup && outgoingInternalConns < MAX_INTERNAL_CONNECTIONS) ||
        (peerGroup !== selfGroup && outgoingExternalConns < MAX_EXTERNAL_CONNECTIONS)) {
        tryEstablishConnection(peer, selfNodeId);
    }
}


export function getActivePeers() {
    // Return only active outgoing connections (nodes we've successfully connected to)
    return Array.from(activeConnections.values()).filter(peer =>
        Date.now() - peer.lastSeen < PEER_TIMEOUT
    );
}

async function tryEstablishConnection(peer, selfNodeId) {
    // Double-check connection limits before establishing a new connection
    // This prevents race conditions where multiple connections are established simultaneously
    
    const selfGroup = determineGroup(selfNodeId);
    const peerGroup = determineGroup(peer.id);
    const activeConns = getActivePeers();
    
    // Count our outgoing connections by group again (in case they changed since we last checked)
    const outgoingInternalConns = activeConns.filter(p => p.group === selfGroup).length;
    const outgoingExternalConns = activeConns.filter(p => p.group !== selfGroup).length;
    
    // Skip if we've reached our limits
    if ((peerGroup === selfGroup && outgoingInternalConns >= MAX_INTERNAL_CONNECTIONS) ||
        (peerGroup !== selfGroup && outgoingExternalConns >= MAX_EXTERNAL_CONNECTIONS)) {
        console.log(`Connection limits reached, not connecting to ${peer.id} (${peer.ip}:${peer.port})`);
        return false;
    }
    
    // Also skip if we're already connected to this peer
    if (activeConnections.has(peer.id)) {
        // Just update the timestamp
        const existingConn = activeConnections.get(peer.id);
        existingConn.lastSeen = Date.now();
        return true;
    }

    try {
        const response = await fetch(`http://${peer.ip}:${peer.port}/ping`);
        if (response.ok) {
            // One final check before adding the connection
            const updatedActiveConns = getActivePeers();
            const updatedInternalConns = updatedActiveConns.filter(p => p.group === selfGroup).length;
            const updatedExternalConns = updatedActiveConns.filter(p => p.group !== selfGroup).length;
            
            if ((peerGroup === selfGroup && updatedInternalConns >= MAX_INTERNAL_CONNECTIONS) ||
                (peerGroup !== selfGroup && updatedExternalConns >= MAX_EXTERNAL_CONNECTIONS)) {
                console.log(`Connection limits reached during ping, not connecting to ${peer.id}`);
                return false;
            }
            
            activeConnections.set(peer.id, {
                ...peer,
                lastSeen: Date.now()
            });
            console.log(`${selfNodeId} successfully established outgoing connection with ${peer.id} (${peer.ip}:${peer.port})`);
            return true;
        }
    } catch (error) {
        console.error(`Failed to establish connection with ${peer.id}:`, error.message);
        peer.retries++;
    }
    return false;
}

function determineGroup(nodeId) {
    return nodeId.charAt(0);
}


export async function handleSync(syncData, serverPort, serverIp, serverNodeId) {
    const updatedPeers = [];

    if (syncData.peers) {
        for (const peer of syncData.peers) {
            if (!nodes.has(peer.id)) {
                addPeer(peer.ip, peer.port, serverPort, serverIp, peer.id, serverNodeId, 'handle sync');
                updatedPeers.push(peer);
            }
        }
    }

    if (updatedPeers.length > 0) {
        propagateToActivePeers({peers: updatedPeers});
    }

    return {
        status: 'ok',
        added: updatedPeers.length
    };
}


// Block propagation - Ensures only new blocks are broadcasted.
async function propagateToActivePeers(data) {
    // Only propagate to outgoing connections that are active
    const activeNodes = Array.from(activeConnections.values())
        .filter(peer => Date.now() - peer.lastSeen < PEER_TIMEOUT);
        
    for (const peer of activeNodes) {
        try {
            await fetch(`http://${peer.ip}:${peer.port}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            peer.lastSeen = Date.now();
        } catch (error) {
            peer.retries++;
            if (peer.retries > 3) removePeer(peer.id);
        }
    }
}

export function removePeer(peerId) {
    nodes.delete(peerId);
    activeConnections.delete(peerId);
    console.log(`Removed inactive peer: ${peerId}`);
}

// Attempts to find and connect to a replacement peer when one disconnects
async function tryReplaceDisconnectedPeer(disconnectedPeer, selfGroup, selfNodeId, selfPort, selfIp) {
    // First, determine if we're replacing an internal or external peer
    const isInternal = disconnectedPeer.group === selfGroup;
    console.log(`Attempting to replace disconnected ${isInternal ? 'internal' : 'external'} peer: ${disconnectedPeer.id}`);
    
    // Get all peers we know about but aren't currently connected to
    const allKnownPeers = Array.from(nodes.values()).filter(peer => 
        !activeConnections.has(peer.id) && // Not already an active connection
        peer.retries < 3 && // Hasn't failed too many times
        Date.now() - peer.lastSeen < PEER_TIMEOUT // Not too old
    );
    
    // Filter to find potential replacement peers of the same group type
    const replacementCandidates = allKnownPeers.filter(peer => 
        (peer.group === selfGroup) === isInternal // Match the group type we're replacing
    );
    
    if (replacementCandidates.length === 0) {
        console.log(`No replacement candidates found for ${isInternal ? 'internal' : 'external'} peer`);
        return false;
    }
    
    // Shuffle the candidates to avoid always trying the same ones
    const shuffledCandidates = [...replacementCandidates].sort(() => Math.random() - 0.5);
    console.log(`Found ${shuffledCandidates.length} potential replacement peers`);
    
    // Try to establish connection with candidates
    for (const candidate of shuffledCandidates) {
        try {
            console.log(`Attempting to connect to replacement peer: ${candidate.id} (${candidate.ip}:${candidate.port})`);
            
            // Try to establish connection to this peer
            const success = await tryEstablishConnection(candidate, selfNodeId);
            
            if (success) {
                console.log(`Successfully connected to replacement peer: ${candidate.id}`);
                return true;
            }
        } catch (error) {
            console.error(`Failed to connect to replacement peer ${candidate.id}:`, error.message);
            candidate.retries++;
        }
    }
    
    console.log(`Failed to find a working replacement for ${isInternal ? 'internal' : 'external'} peer`);
    return false;
}

export function cleanupPeers() {
    const now = Date.now();
    for (const [id, peer] of nodes.entries()) {
        if (now - peer.lastSeen > PEER_TIMEOUT) {
            removePeer(id);
        }
    }
}

export function getActiveConnections() {
    // Same as getActivePeers - this is now redundant but kept for API compatibility
    // Only return connections that are recent
    return Array.from(activeConnections.values()).filter(peer => 
        Date.now() - peer.lastSeen < PEER_TIMEOUT
    );
}
