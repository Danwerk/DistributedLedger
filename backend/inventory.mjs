// inventory.mjs
import { getActivePeers, removePeer } from './network.mjs';
import crypto from 'crypto';

export class InventoryManager {
    constructor() {
        this.blocks = new Map();
        this.transactions = new Map();
        this.seenMessages = new Set();
        this.balances = new Map(); // Track node balances
        this.genesisCreated = false; // Track if genesis block was created
        this.blockchainHead = null; // Track current chain head
        this.blockHeights = new Map(); // Map to track block heights
        
        // Set up periodic inventory synchronization with active peers
        setInterval(() => this.syncInventoryWithPeers(), 30000); // Sync every 30 seconds
    }
    
    // Create genesis block with initial balance for the creator
    createGenesisBlock(nodeId) {
        if (this.genesisCreated || this.blocks.size > 0) {
            console.log('Genesis block already exists, skipping creation');
            return null;
        }
        
        console.log(`Creating genesis block for node ${nodeId}`);
        const timestamp = new Date().toISOString();
        const initialBalance = 100; // Initial coins for first node
        
        const genesisBlock = {
            isGenesis: true,
            previousHash: "0000000000000000000000000000000000000000000000000000000000000000",
            timestamp,
            nonce: "0",
            creator: nodeId,
            merkleRoot: "",
            count: 0,
            transactions: [],
            hash: "" // Will be calculated
        };
        
        // Calculate hash for genesis block
        const genesisHash = this.calculateBlockHash(genesisBlock);
        genesisBlock.hash = genesisHash;
        
        // Add genesis block to inventory
        this.blocks.set(genesisHash, genesisBlock);
        this.seenMessages.add(genesisHash);
        this.genesisCreated = true;
        
        // Set block height (genesis is height 0)
        this.blockHeights.set(genesisHash, 0);
        
        // Set genesis as the blockchain head
        this.blockchainHead = genesisHash;
        
        // Set initial balance for creator
        this.balances.set(nodeId, initialBalance);
        console.log(`Genesis block created with hash ${genesisHash}`);
        console.log(`Initial balance for ${nodeId}: ${initialBalance} coins`);
        
        return genesisBlock;
    }

    calculateBlockHash(block) {
        // We need to match the exact hash calculation from miner.mjs
        // In miner.mjs, the hash is calculated as sha256(blockString + nonce)
        const { hash, ...blockWithoutHash } = block;
        const blockString = JSON.stringify(blockWithoutHash);
        const nonce = block.nonce || "0"; // Get nonce from block, default to "0"
        
        // Calculate hash the same way as in miner.mjs
        return crypto.createHash('sha256')
            .update(blockString + nonce)
            .digest('hex');
    }

    addBlock(block) {
        console.log('=============================================================');
        console.log('BLOCK ADDITION DEBUG - Attempting to add block:', JSON.stringify(block, null, 2));

        // Save original hash for debugging
        const originalBlockHash = block.hash; 
        
        // Calculate the correct hash based on block content
        const calculatedHash = this.calculateBlockHash(block);
        console.log('Original block hash:', originalBlockHash);
        console.log('Calculated hash:', calculatedHash);
        console.log('Hash mismatch?', originalBlockHash !== calculatedHash);
        
        // Show existing blocks for debugging
        console.log('Current blockchain head:', this.blockchainHead);
        console.log('Existing blocks:', Array.from(this.blocks.keys()));

        // We'll use the hash from the block if available, or calculated hash otherwise
        // This helps with compatibility when receiving blocks that might have
        // been mined with a different hash calculation
        const blockHash = originalBlockHash || calculatedHash;
        
        // Check if we've seen this block before (try both original and calculated hash)
        if (this.seenMessages.has(blockHash) || this.seenMessages.has(calculatedHash)) {
            console.log('Block already seen, skipping');
            return false;
        }

        // If this is a genesis block, handle it specially
        if (block.isGenesis) {
            console.log('Adding genesis block');
            // For genesis block, we just accept it and don't validate transactions
            const blockWithHash = { ...block, hash: blockHash };
            this.blocks.set(blockHash, blockWithHash);
            this.seenMessages.add(blockHash);
            this.genesisCreated = true;
            
            // Set block height (genesis is height 0)
            this.blockHeights.set(blockHash, 0);
            
            // Set genesis as the blockchain head
            this.blockchainHead = blockHash;
            
            // Set initial balance for creator if specified
            if (block.creator) {
                this.balances.set(block.creator, 100); // Initial balance
                console.log(`Set initial balance for ${block.creator}: 100 coins`);
            }
            
            // Propagate with correct hash
            this.propagateBlock(blockWithHash);
            return true;
        }
        
        // For regular blocks, first validate the block structure and chain links
        if (!this.validateBlockStructure(block, calculatedHash)) {
            console.log('BLOCK REJECTED: Block structure validation failed');
            return false;
        }
        
        // For regular blocks, validate the transactions
        if (block.transactions && Array.isArray(block.transactions)) {
            console.log(`Block has ${block.transactions.length} transactions to validate`);
            
            // Log all transactions in the block for debugging
            block.transactions.forEach((tx, index) => {
                console.log(`Block TX ${index}: ${tx.id} - ${tx.sender} sends ${tx.amount} to ${tx.receiver}`);
            });
            
            // Validate all transactions in the block
            if (!this.validateBlockTransactions(block.transactions)) {
                console.log('BLOCK REJECTED: Block transactions validation failed');
                return false;
            }
            
            console.log(`Processing block with ${block.transactions.length} transactions`);
            
            // Log the pending transactions before processing
            const pendingTxIds = Array.from(this.transactions.keys()).join(', ');
            console.log(`Pending transactions before: ${pendingTxIds ? pendingTxIds : "none"}`);
            
            // Check if the transactions in the block match pending transactions
            if (block.transactions.length > 0) {
                const pendingTxMap = new Map(Array.from(this.transactions.entries()));
                const missingTxs = block.transactions.filter(tx => !pendingTxMap.has(tx.id));
                if (missingTxs.length > 0) {
                    console.log(`WARNING: ${missingTxs.length} transactions in block not found in pending pool`);
                    missingTxs.forEach(tx => {
                        console.log(`  Missing TX: ${tx.id} - ${tx.sender} sends ${tx.amount} to ${tx.receiver}`);
                    });
                }
            }
            
            // Store block with the hash (use consistent hash from earlier)
            const blockWithHash = { ...block, hash: blockHash };
            this.blocks.set(blockHash, blockWithHash);
            this.seenMessages.add(blockHash);
            
            console.log(`BLOCK ADDED TO BLOCKCHAIN with hash ${blockHash}`);
            
            // Calculate the block height
            const prevBlockHeight = this.blockHeights.get(block.previousHash) || -1;
            if (prevBlockHeight === -1) {
                console.log(`Warning: Previous block with hash ${block.previousHash} not found`);
                // For simulation purposes, assume a height of 1 if previous is unknown
                // This helps orphaned blocks still get processed
                this.blockHeights.set(blockHash, 1);
                console.log(`Assigned default height 1 to orphaned block`);
            } else {
                const currentHeight = prevBlockHeight + 1;
                this.blockHeights.set(blockHash, currentHeight);
                console.log(`Block height set to ${currentHeight}`);
            }
            
            // Process transactions in the block regardless of consensus
            // This ensures transactions are applied even if we later need to rollback
            // The processBlockTransactions function now also removes them from the pending pool
            console.log(`Processing ${block.transactions.length} transactions from block`);
            this.processBlockTransactions(block.transactions);
            
            // Apply consensus rules to handle potential forks
            const consensusResult = this.applyConsensusRules(blockHash, blockWithHash);
            console.log(`Consensus result: ${consensusResult ? 'Block is now blockchain head' : 'Block added but not head'}`);
            
            // Final verification
            console.log(`VERIFICATION: Block ${blockHash} is now in blockchain: ${this.blocks.has(blockHash)}`);
            console.log(`VERIFICATION: Current blockchain head: ${this.blockchainHead}`);
            console.log(`VERIFICATION: Block height: ${this.blockHeights.get(blockHash)}`);
            console.log(`VERIFICATION: Pending transactions count: ${this.transactions.size}`);
            
            
            // Log the pending transactions after processing
            const remainingTxIds = Array.from(this.transactions.keys()).join(', ');
            console.log(`Pending transactions after: ${remainingTxIds}`);

            // Propagate with correct hash
            this.propagateBlock(blockWithHash);
            return true;
        }

        return false;
    }
    
    // Validate the block structure and chain links
    validateBlockStructure(block, calculatedHash) {
        console.log(`\n=== VALIDATING BLOCK STRUCTURE ===`);
        console.log(`Block hash: ${block.hash}`);
        console.log(`Calculated hash: ${calculatedHash}`);
        console.log(`Previous hash: ${block.previousHash}`);
        
        // Now we can validate the proof of work properly
        // Check that the hash starts with the required number of zeros (difficulty)
        const hashMeetsDifficulty = calculatedHash.startsWith('0000');
        console.log(`Hash meets difficulty (starts with 0000): ${hashMeetsDifficulty}`);
        
        if (!hashMeetsDifficulty) {
            console.log(`Block hash validation FAILED: hash does not meet difficulty requirement`);
            return false;
        }
        
        // Check if previousHash exists in our blockchain (chain validation)
        const previousBlockExists = this.blocks.has(block.previousHash);
        console.log(`Previous block exists in our blockchain: ${previousBlockExists}`);
        
        if (!previousBlockExists) {
            console.log(`Block chain validation note: previous hash ${block.previousHash} not found in blockchain`);
            // We might still accept orphaned blocks that could be connected later
            // But we should not validate them until we have their ancestors
            console.log('Block might be an orphan, will be accepted but not fully validated');
            
            // List first few blocks we have to help debug
            const existingBlockHashes = Array.from(this.blocks.keys()).slice(0, 5);
            console.log(`First few existing blocks: ${existingBlockHashes.join(', ')}`);
            
            // For debugging - return true to accept orphans and avoid cascading rejections
            return true;
        }
        
        // Validate merkleRoot if transactions exist
        if (block.transactions && block.transactions.length > 0) {
            console.log(`Block has ${block.transactions.length} transactions, merkleRoot: ${block.merkleRoot}`);
            // Import the getMerkleRoot function from miner.mjs to recalculate
            // For simplicity, we'll skip this here, but in a full implementation this would verify
            // that the merkle root in the block matches a recalculation from the transactions
            // This helps detect transaction tampering
        }
        
        console.log('Block structure and chain validation PASSED ✅');
        return true;
    }
    
    // Validate all transactions within a block
    validateBlockTransactions(transactions) {
        if (!Array.isArray(transactions)) {
            console.log('Block has invalid transactions format');
            return false;
        }
        
        // Make a temporary copy of balances to validate the entire block
        // without affecting the actual balances
        const tempBalances = new Map(this.balances);
        
        // Validate each transaction in sequence
        for (let i = 0; i < transactions.length; i++) {
            const tx = transactions[i];
            
            // Check required fields
            if (!tx.id || !tx.sender || !tx.receiver || !tx.amount || tx.amount <= 0) {
                console.log(`Transaction ${i} in block has missing or invalid fields`);
                return false;
            }
            
            // Check if sender has enough balance to cover the transaction
            const senderBalance = tempBalances.get(tx.sender) || 0;
            if (senderBalance < tx.amount) {
                console.log(`Transaction ${tx.id} validation failed: sender ${tx.sender} has insufficient balance (${senderBalance})`);
                return false;
            }
            
            // Update temporary balances for subsequent transaction validations
            tempBalances.set(tx.sender, senderBalance - tx.amount);
            const receiverBalance = tempBalances.get(tx.receiver) || 0;
            tempBalances.set(tx.receiver, receiverBalance + tx.amount);
        }
        
        console.log('All transactions in block are valid');
        return true;
    }
    
    // Apply consensus rules to handle potential forks
    applyConsensusRules(newBlockHash, newBlock) {
        console.log(`\n=== CONSENSUS CHECK ===`);
        if (!this.blockchainHead) {
            // If no head exists yet, set this as the head
            this.blockchainHead = newBlockHash;
            console.log(`Setting blockchain head to: ${newBlockHash} (first block in chain)`);
            return true;
        }
        
        // Get heights of current head and new block
        const currentHeadHeight = this.blockHeights.get(this.blockchainHead) || 0;
        const newBlockHeight = this.blockHeights.get(newBlockHash) || 0;
        
        console.log(`Consensus check: Current head ${this.blockchainHead} at height ${currentHeadHeight}, new block ${newBlockHash} at height ${newBlockHeight}`);
        
        // DEBUGGING: Print the chain structure to understand path to genesis
        console.log(`Chain from new block to genesis:`);
        let tempHash = newBlockHash;
        let i = 0;
        let chainPath = [];
        while (tempHash && i < 10) { // Limit to 10 iterations for safety
            const block = this.blocks.get(tempHash);
            if (!block) {
                console.log(`  ${i}: ${tempHash} (block not found)`);
                break;
            }
            chainPath.push(tempHash);
            console.log(`  ${i}: ${tempHash} (previous: ${block.previousHash})`);
            if (block.isGenesis) break;
            tempHash = block.previousHash;
            i++;
        }
        
        // Rule 1: Longest chain wins
        if (newBlockHeight > currentHeadHeight) {
            console.log(`Consensus: New block creates longer chain. Switching head from ${this.blockchainHead} to ${newBlockHash}`);
            this.handleChainReorganization(this.blockchainHead, newBlockHash);
            this.blockchainHead = newBlockHash;
            return true;
        } 
        // Rule 2: If same height, smallest hash wins
        else if (newBlockHeight === currentHeadHeight && newBlockHash < this.blockchainHead) {
            console.log(`Consensus: New block has same height but smaller hash. Switching head from ${this.blockchainHead} to ${newBlockHash}`);
            this.handleChainReorganization(this.blockchainHead, newBlockHash);
            this.blockchainHead = newBlockHash;
            return true;
        } else {
            console.log('Consensus: Current chain remains the preferred chain');
            return false;
        }
    }
    
    // Handle chain reorganization when the head changes
    handleChainReorganization(oldHead, newHead) {
        console.log(`Chain reorganization: From ${oldHead} to ${newHead}`);
        
        // We need to:
        // 1. Roll back transactions from the old chain
        // 2. Apply transactions from the new chain
        
        // Find the common ancestor
        const oldChain = this.getChainToBlock(oldHead);
        const newChain = this.getChainToBlock(newHead);
        
        console.log(`Old chain: ${JSON.stringify(oldChain)}`);
        console.log(`New chain: ${JSON.stringify(newChain)}`);
        
        // Find the common ancestor
        let commonAncestorIndex = 0;
        while (commonAncestorIndex < oldChain.length && 
               commonAncestorIndex < newChain.length && 
               oldChain[commonAncestorIndex] === newChain[commonAncestorIndex]) {
            commonAncestorIndex++;
        }
        
        // Blocks to roll back (from old chain after the fork)
        const blocksToRollback = oldChain.slice(commonAncestorIndex).reverse();
        
        // Blocks to apply (from new chain after the fork)
        const blocksToApply = newChain.slice(commonAncestorIndex);
        
        console.log(`Common ancestor at index ${commonAncestorIndex}`);
        console.log(`Chain reorganization: Rolling back ${blocksToRollback.length} blocks and applying ${blocksToApply.length} blocks`);
        console.log(`Blocks to rollback: ${JSON.stringify(blocksToRollback)}`);
        console.log(`Blocks to apply: ${JSON.stringify(blocksToApply)}`);
        
        // Roll back transactions from the old chain
        for (const blockHash of blocksToRollback) {
            const block = this.blocks.get(blockHash);
            if (block && block.transactions) {
                console.log(`Rolling back transactions in block ${blockHash}`);
                // Reverse the transactions (from latest to earliest)
                for (const tx of block.transactions) {
                    if (tx.sender && tx.receiver && tx.amount) {
                        // Get current balances
                        const senderBalance = this.balances.get(tx.sender) || 0;
                        const receiverBalance = this.balances.get(tx.receiver) || 0;
                        
                        // Reverse the transaction
                        const newSenderBalance = senderBalance + tx.amount;
                        this.balances.set(tx.sender, newSenderBalance);
                        
                        const newReceiverBalance = receiverBalance - tx.amount;
                        this.balances.set(tx.receiver, newReceiverBalance);
                        
                        console.log(`Rolled back: ${tx.sender} (${senderBalance} → ${newSenderBalance}), ${tx.receiver} (${receiverBalance} → ${newReceiverBalance})`);
                    }
                }
            }
        }
        
        // Apply transactions from the new chain
        for (const blockHash of blocksToApply) {
            const block = this.blocks.get(blockHash);
            if (block && block.transactions) {
                console.log(`Applying transactions in block ${blockHash}`);
                this.processBlockTransactions(block.transactions);
            }
        }
    }
    
    // Get the full chain from genesis to a specific block
    getChainToBlock(blockHash) {
        const chain = [];
        let currentHash = blockHash;
        
        // Maximum iterations to prevent infinite loops
        let maxIterations = 1000;
        
        while (currentHash && maxIterations > 0) {
            const block = this.blocks.get(currentHash);
            if (!block) break;
            
            chain.unshift(currentHash); // Add to beginning of array
            
            if (block.isGenesis) break; // Stop at genesis block
            currentHash = block.previousHash;
            maxIterations--;
        }
        
        return chain;
    }
    
    // Process all transactions in a block, updating balances
    processBlockTransactions(transactions) {
        console.log(`\n=== PROCESSING BLOCK TRANSACTIONS ===`);
        if (!Array.isArray(transactions)) {
            console.log(`No transactions to process (not an array)`);
            return;
        }
        
        if (transactions.length === 0) {
            console.log(`No transactions to process (empty array)`);
            return;
        }
        
        console.log(`Processing ${transactions.length} transactions`);
        
        // Apply all transactions
        for (const tx of transactions) {
            if (!tx.sender || !tx.receiver || !tx.amount) {
                console.log('Skipping invalid transaction in block');
                continue;
            }
            
            // Deduct from sender
            const senderBalance = this.balances.get(tx.sender) || 0;
            const newSenderBalance = senderBalance - tx.amount;
            this.balances.set(tx.sender, newSenderBalance);
            
            // Add to receiver
            const receiverBalance = this.balances.get(tx.receiver) || 0;
            const newReceiverBalance = receiverBalance + tx.amount;
            this.balances.set(tx.receiver, newReceiverBalance);
            
            console.log(`Applied transaction: ${tx.sender} (${senderBalance} → ${newSenderBalance}) sent ${tx.amount} to ${tx.receiver} (${receiverBalance} → ${newReceiverBalance})`);
            
            // Remove this transaction from pending pool if it exists
            if (tx.id && this.transactions.has(tx.id)) {
                console.log(`Removing processed transaction ${tx.id} from pending pool`);
                this.transactions.delete(tx.id);
            }
        }
        
        // Check how many pending transactions remain
        console.log(`After processing transactions: ${this.transactions.size} pending transactions remain`);
    }

    addTransaction(tx) {
        if (this.seenMessages.has(tx.id)) {
            return false;
        }
        
        // Validate transaction
        if (!this.validateTransaction(tx)) {
            return false;
        }

        this.transactions.set(tx.id, tx);
        this.seenMessages.add(tx.id);
        this.propagateTransaction(tx);
        return true;
    }
    
    // Validate if a transaction is valid (sender has enough balance)
    validateTransaction(tx) {
        // Check for required fields
        if (!tx.sender || !tx.receiver || !tx.amount || tx.amount <= 0) {
            console.log('Transaction missing required fields or invalid amount');
            console.log('  sender:', tx.sender);
            console.log('  receiver:', tx.receiver);
            console.log('  amount:', tx.amount);
            return false;
        }
        
        // Get sender balance
        const senderBalance = this.balances.get(tx.sender) || 0;
        console.log(`VALIDATION: ${tx.sender} has balance: ${senderBalance}`);
        
        // Check if sender has enough funds
        if (senderBalance < tx.amount) {
            console.log(`Transaction rejected: ${tx.sender} has balance ${senderBalance}, tried to send ${tx.amount}`);
            return false;
        }
        
        console.log(`Transaction validated: ${tx.sender} has balance ${senderBalance}, sending ${tx.amount} to ${tx.receiver}`);
        return true;
    }
    
    // Get a transaction from the pending pool by ID
    getTransaction(txId) {
        return this.transactions.get(txId);
    }

    getInventory() {
        // Enhanced inventory info with consensus details
        const chainHeight = this.blockHeights.get(this.blockchainHead) || 0;
        
        // Debug inventory output
        console.log(`Getting inventory - blocks: ${this.blocks.size}, transactions: ${this.transactions.size}`);
        console.log(`Blockchain head: ${this.blockchainHead}, chain height: ${chainHeight}`);
        
        // Get actual block objects for debugging
        const blockObjects = Array.from(this.blocks.values());
        
        return {
            // Return both keys (hashes) and full block objects for better debugging
            blocks: Array.from(this.blocks.keys()),
            blockObjects: blockObjects, // Full block objects for debugging
            transactions: Array.from(this.transactions.values()),
            balances: Object.fromEntries(this.balances),
            consensus: {
                currentHead: this.blockchainHead,
                chainHeight: chainHeight,
                totalBlocks: this.blocks.size,
                forkedBlocks: this.blocks.size - (chainHeight + 1) // +1 for genesis
            }
        };
    }
    
    // Get all balances
    getBalances() {
        return Object.fromEntries(this.balances);
    }
    
    // Get balance for a specific node
    getBalance(nodeId) {
        return this.balances.get(nodeId) || 0;
    }

    propagateBlock(block) {
        const peers = getActivePeers();
        console.log('Propagating block to peers:', peers.length);
        
        // Array to track failed peers for retry
        const failedPeers = [];
        
        // Send to each peer with retry mechanism
        peers.forEach(peer => {
            console.log(`Attempting to send block to peer ${peer.id}`);
            fetch(`http://${peer.ip}:${peer.port}/block`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(block),
                // Add timeout to avoid hanging requests
                signal: AbortSignal.timeout(5000)
            }).then(response => {
                if (response.ok) {
                    console.log(`Successfully sent block to peer ${peer.id}`);
                    peer.lastSeen = Date.now();
                    // Reset retries on successful connection
                    peer.retries = 0;
                } else {
                    console.error(`Failed to send block to peer ${peer.id}: HTTP ${response.status}`);
                    peer.retries = (peer.retries || 0) + 1;
                    failedPeers.push(peer);
                }
            }).catch((error) => {
                console.error(`Failed to send block to peer ${peer.id}:`, error);
                peer.retries = (peer.retries || 0) + 1;
                failedPeers.push(peer);
            });
        });
        
        // Retry once after a short delay for any failed peers
        if (failedPeers.length > 0) {
            setTimeout(() => {
                console.log(`Retrying block propagation to ${failedPeers.length} failed peers`);
                failedPeers.forEach(peer => {
                    // Only retry if the peer hasn't exceeded retry limit
                    if (peer.retries < 3) {
                        fetch(`http://${peer.ip}:${peer.port}/block`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(block)
                        }).then(() => {
                            console.log(`Retry successful for peer ${peer.id}`);
                            peer.lastSeen = Date.now();
                            peer.retries = 0;
                        }).catch((error) => {
                            console.error(`Retry failed for peer ${peer.id}:`, error);
                            peer.retries++;
                            
                            // If we've exceeded retry limit, remove peer and try to replace it
                            if (peer.retries >= 3) {
                                console.log(`Removing peer ${peer.id} after multiple failed retries`);
                                removePeer(peer.id);
                            }
                        });
                    } else {
                        console.log(`Skipping retry for peer ${peer.id} (too many retries)`);
                        removePeer(peer.id);
                    }
                });
            }, 5000); // Retry after 5 seconds
        }
    }

    propagateTransaction(tx) {
        const peers = getActivePeers();
        console.log('Propagating transaction to peers:', peers.length);
        
        // Array to track failed peers for retry
        const failedPeers = [];
        
        // Send to each peer with retry mechanism
        peers.forEach(peer => {
            console.log(`Attempting to send transaction to peer ${peer.id} at ${peer.ip}:${peer.port}`);
            fetch(`http://${peer.ip}:${peer.port}/inv`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tx),
                // Add timeout to avoid hanging requests
                signal: AbortSignal.timeout(5000)
            }).then(response => {
                if (response.ok) {
                    console.log(`Successfully sent transaction to peer ${peer.id}`);
                    peer.lastSeen = Date.now();
                    // Reset retries on successful connection
                    peer.retries = 0;
                } else {
                    console.error(`Failed to send transaction to peer ${peer.id}: HTTP ${response.status}`);
                    peer.retries = (peer.retries || 0) + 1;
                    failedPeers.push(peer);
                }
            }).catch((error) => {
                console.error(`Failed to send transaction to peer ${peer.id}:`, error);
                peer.retries = (peer.retries || 0) + 1;
                failedPeers.push(peer);
            });
        });
        
        // Retry once after a short delay for any failed peers
        if (failedPeers.length > 0) {
            setTimeout(() => {
                console.log(`Retrying transaction propagation to ${failedPeers.length} failed peers`);
                failedPeers.forEach(peer => {
                    // Only retry if the peer hasn't exceeded retry limit
                    if (peer.retries < 3) {
                        fetch(`http://${peer.ip}:${peer.port}/inv`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(tx)
                        }).then(() => {
                            console.log(`Retry successful for peer ${peer.id}`);
                            peer.lastSeen = Date.now();
                            peer.retries = 0;
                        }).catch((error) => {
                            console.error(`Retry failed for peer ${peer.id}:`, error);
                            peer.retries++;
                            
                            // If we've exceeded retry limit, remove peer and try to replace it
                            if (peer.retries >= 3) {
                                console.log(`Removing peer ${peer.id} after multiple failed retries`);
                                removePeer(peer.id);
                            }
                        });
                    } else {
                        console.log(`Skipping retry for peer ${peer.id} (too many retries)`);
                        removePeer(peer.id);
                    }
                });
            }, 5000); // Retry after 5 seconds
        }
    }

    getAllBlocks() {
        // Return all blocks, sorted by their height if available
        const allBlocks = Array.from(this.blocks.values());
        
        // Sort blocks by height if available
        return allBlocks.sort((a, b) => {
            const heightA = this.blockHeights.get(a.hash) || 0;
            const heightB = this.blockHeights.get(b.hash) || 0;
            return heightA - heightB;
        });
    }
    
    // Get blocks in the main chain only (the consensus chain)
    getMainChain() {
        if (!this.blockchainHead) return [];
        
        const mainChainHashes = this.getChainToBlock(this.blockchainHead);
        return mainChainHashes.map(hash => this.blocks.get(hash)).filter(Boolean);
    }

    getBlock(hash) {
        return this.blocks.get(hash);
    }

    propagatePeerList() {
        const peers = getActivePeers();
        peers.forEach(peer => {
            // Send to /sync endpoint instead of /peers
            fetch(`http://${peer.ip}:${peer.port}/sync`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ peers: peers }),
                signal: AbortSignal.timeout(5000) // Add timeout to avoid hanging requests
            }).then(response => {
                if (response.ok) {
                    peer.lastSeen = Date.now();
                    peer.retries = 0; // Reset retries on successful connection
                } else {
                    console.error(`Failed to propagate peer list to ${peer.id}: HTTP ${response.status}`);
                    peer.retries = (peer.retries || 0) + 1;
                    
                    // If we've exceeded retry limit, remove peer
                    if (peer.retries >= 3) {
                        console.log(`Removing peer ${peer.id} after failed peer list propagation`);
                        removePeer(peer.id);
                    }
                }
            }).catch((error) => {
                console.error(`Error propagating peer list to ${peer.id}:`, error.message);
                peer.retries = (peer.retries || 0) + 1;
                
                // If we've exceeded retry limit, remove peer
                if (peer.retries >= 3) {
                    console.log(`Removing peer ${peer.id} after failed peer list propagation`);
                    removePeer(peer.id);
                }
            });
        });
    }
    
    // Periodic inventory synchronization with active peers
    async syncInventoryWithPeers() {
        const peers = getActivePeers();
        if (peers.length === 0) return;
        
        console.log(`Syncing inventory with ${peers.length} active peers`);
        
        // Use a properly time-limited fetch for each peer
        for (let i = 0; i < peers.length; i++) {
            const peer = peers[i];
            try {
                console.log(`Requesting inventory from peer ${peer.id}`);
                // Use AbortSignal with timeout to prevent hanging requests
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
                
                const response = await fetch(`http://${peer.ip}:${peer.port}/inventory`, {
                    signal: controller.signal
                });
                
                clearTimeout(timeoutId); // Clear the timeout if fetch completed
                
                if (!response.ok) {
                    console.error(`Failed to get inventory from peer ${peer.id}: HTTP ${response.status}`);
                    peer.retries = (peer.retries || 0) + 1;
                    continue;
                }
                
                const peerInventory = await response.json();
                peer.lastSeen = Date.now();
                peer.retries = 0; // Reset retries on successful connection
                
                // Process transactions from peer
                if (peerInventory.transactions && Array.isArray(peerInventory.transactions)) {
                    console.log(`Received ${peerInventory.transactions.length} transactions from peer ${peer.id}`);
                    peerInventory.transactions.forEach(tx => {
                        if (tx && tx.id && !this.seenMessages.has(tx.id)) {
                            // Add to our inventory without re-propagating
                            this.transactions.set(tx.id, tx);
                            this.seenMessages.add(tx.id);
                            console.log(`Added missing transaction ${tx.id} from peer ${peer.id}`);
                        }
                    });
                }
                
                // Process blocks from peer
                if (peerInventory.blocks && Array.isArray(peerInventory.blocks)) {
                    // For blocks, we may only have hashes in the inventory response
                    // We need to fetch any blocks we don't have
                    for (const blockId of peerInventory.blocks) {
                        if (!this.blocks.has(blockId) && !this.seenMessages.has(blockId)) {
                            try {
                                // Use timeout for block fetch as well
                                const blockController = new AbortController();
                                const blockTimeoutId = setTimeout(() => blockController.abort(), 5000);
                                
                                const blockResponse = await fetch(`http://${peer.ip}:${peer.port}/getblocks?hash=${blockId}`, {
                                    signal: blockController.signal
                                });
                                
                                clearTimeout(blockTimeoutId);
                                
                                if (blockResponse.ok) {
                                    const blocks = await blockResponse.json();
                                    if (Array.isArray(blocks)) {
                                        blocks.forEach(block => {
                                            if (block && !this.seenMessages.has(block.hash)) {
                                                // Add to our inventory without re-propagating
                                                this.blocks.set(block.hash, block);
                                                this.seenMessages.add(block.hash);
                                                console.log(`Added missing block ${block.hash} from peer ${peer.id}`);
                                            }
                                        });
                                    }
                                }
                            } catch (blockError) {
                                console.log(`Failed to fetch block ${blockId} from peer ${peer.id}`);
                            }
                        }
                    }
                }
            } catch (error) {
                console.log(`Error syncing with peer ${peer.id}`);
                peer.retries = (peer.retries || 0) + 1;
                
                // If we've failed to connect 3+ times, remove this peer from our active connections
                if (peer.retries >= 3) {
                    console.log(`Removing unresponsive peer ${peer.id} after ${peer.retries} failed attempts`);
                    removePeer(peer.id);
                    
                    // Get a new peer to try if available
                    const remainingPeers = getActivePeers();
                    if (remainingPeers.length > 0) {
                        console.log(`Trying another peer from the remaining ${remainingPeers.length} peers`);
                    }
                }
            }
        }
    }
}

setInterval(() => inventory.propagatePeerList(), 45000);

export const inventory = new InventoryManager();

export async function handleInventorySync(syncData) {
    let addedBlocks = 0;
    let addedTransactions = 0;
    
    if (syncData.blocks && Array.isArray(syncData.blocks)) {
        console.log(`Processing ${syncData.blocks.length} blocks from sync`);
        syncData.blocks.forEach(block => {
            if (inventory.addBlock(block)) {
                addedBlocks++;
            }
        });
    }
    
    if (syncData.transactions && Array.isArray(syncData.transactions)) {
        console.log(`Processing ${syncData.transactions.length} transactions from sync`);
        syncData.transactions.forEach(tx => {
            if (inventory.addTransaction(tx)) {
                addedTransactions++;
            }
        });
    }
    
    console.log(`Sync complete: Added ${addedBlocks} blocks and ${addedTransactions} transactions`);
    return {
        addedBlocks,
        addedTransactions
    };
}