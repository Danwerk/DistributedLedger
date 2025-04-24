import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Camera, RefreshCw, Database } from 'lucide-react';
import _ from 'lodash';

const NetworkVisualizer = () => {
    const [seedNode, setSeedNode] = useState({ ip: 'localhost', port: '3000' });
    const [networkData, setNetworkData] = useState(null);
    const [error, setError] = useState(null);
    const [loading, setLoading] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 1200, height: 600 });
    const [draggingNode, setDraggingNode] = useState(null);
    const [selectedNode, setSelectedNode] = useState(null);
    const [nodeDetails, setNodeDetails] = useState(null);
    const [queryLoading, setQueryLoading] = useState(false);
    const [discoveredConnections, setDiscoveredConnections] = useState(new Set());
    const animationFrameRef = useRef();

    const initializePositions = (nodes) => {
        const groups = _.groupBy(nodes, node => node.id.charAt(0));
        const centerX = dimensions.width / 2;
        const centerY = dimensions.height / 2;
        const radius = Math.min(dimensions.width, dimensions.height) * 0.25;

        return nodes.map(node => {
            const group = node.id.charAt(0);
            const groupIndex = Object.keys(groups).indexOf(group);
            const nodesInGroup = groups[group].length;
            const angleOffset = (Math.PI * 2) / Object.keys(groups).length;
            const nodeOffset = (Math.PI * 2) / (nodesInGroup * 8);

            const angle = groupIndex * angleOffset +
                (groups[group].indexOf(node) * nodeOffset);

            return {
                ...node,
                x: centerX + radius * Math.cos(angle),
                y: centerY + radius * Math.sin(angle)
            };
        });
    };

    const fetchNodeDetails = async (node) => {
        setQueryLoading(true);
        try {
            const response = await fetch(`http://${node.ip}:${node.port}/status`);
            const data = await response.json();
            setNodeDetails(data);

            setNetworkData(prev => {
                if (!prev) return prev;

                const newNodes = new Map(prev.nodes.map(n => [n.id, n]));
                const newConnections = new Set(prev.connections.map(c => JSON.stringify(c)));
                const newDiscoveredConnections = new Set(discoveredConnections);

                data.allPeers.forEach(peer => {
                    if (!newNodes.has(peer.nodeId)) {
                        const angle = Math.random() * 2 * Math.PI;
                        const radius = 100;
                        const newNode = {
                            id: peer.nodeId,
                            ip: peer.ip,
                            port: peer.port,
                            isActive: peer.isActive,
                            x: node.x + radius * Math.cos(angle),
                            y: node.y + radius * Math.sin(angle)
                        };
                        newNodes.set(peer.nodeId, newNode);
                    }
                });

                data.connections.forEach(conn => {
                    const connection = {
                        source: data.nodeId,
                        target: conn.nodeId
                    };
                    const connectionStr = JSON.stringify(connection);
                    newConnections.add(connectionStr);
                    newDiscoveredConnections.add(connectionStr);
                });

                setDiscoveredConnections(newDiscoveredConnections);

                const groupStats = Array.from(newNodes.values()).reduce((acc, node) => {
                    const group = node.id.charAt(0);
                    if (!acc[group]) acc[group] = 0;
                    acc[group]++;
                    return acc;
                }, {});

                return {
                    ...prev,
                    nodes: Array.from(newNodes.values()),
                    connections: Array.from(newConnections).map(conn => JSON.parse(conn)),
                    stats: {
                        ...prev.stats,
                        totalNodes: newNodes.size,
                        activeConnections: newConnections.size,
                        groupStats,
                        groups: Object.keys(groupStats).length
                    }
                };
            });

        } catch (err) {
            setError(`Failed to query node ${node.ip}:${node.port}`);
        } finally {
            setQueryLoading(false);
        }
    };

    const fetchNetworkData = async () => {
        setLoading(true);
        setError(null);
        try {
            const response = await fetch(`http://${seedNode.ip}:${seedNode.port}/status`);
            const data = await response.json();

            const nodes = new Map();
            const connections = new Set();

            nodes.set(data.nodeId, {
                id: data.nodeId,
                ip: data.ip,
                port: data.port,
                isRoot: true,
                isActive: true
            });

            data.allPeers.forEach(peer => {
                nodes.set(peer.nodeId, {
                    id: peer.nodeId,
                    ip: peer.ip,
                    port: peer.port,
                    isActive: peer.isActive
                });
            });

            data.connections.forEach(conn => {
                connections.add(JSON.stringify({
                    source: data.nodeId,
                    target: conn.nodeId
                }));
            });

            const nodesArray = Array.from(nodes.values());
            const nodesWithPositions = networkData
                ? nodesArray.map(node => ({
                    ...node,
                    x: networkData.nodes.find(n => n.id === node.id)?.x || 0,
                    y: networkData.nodes.find(n => n.id === node.id)?.y || 0
                }))
                : initializePositions(nodesArray);

            const groupStats = nodesWithPositions.reduce((acc, node) => {
                const group = node.id.charAt(0);
                if (!acc[group]) acc[group] = 0;
                acc[group]++;
                return acc;
            }, {});

            setDiscoveredConnections(new Set());
            setNetworkData({
                nodes: nodesWithPositions,
                connections: Array.from(connections).map(conn => JSON.parse(conn)),
                stats: {
                    totalNodes: nodes.size,
                    activeConnections: connections.size,
                    groupStats,
                    groups: Object.keys(groupStats).length
                }
            });

        } catch (err) {
            setError('Failed to fetch network data. Please check if the node is accessible.');
        } finally {
            setLoading(false);
        }
    };

    const handleNodeClick = (e, node) => {
        e.stopPropagation();
        setSelectedNode(node);
        fetchNodeDetails(node);
    };

    const handleMouseDown = (e, nodeId) => {
        if (e.button === 0) {
            setDraggingNode(nodeId);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        }
    };

    const handleMouseMove = useCallback((e) => {
        if (!draggingNode || !networkData) return;

        const svgRect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - svgRect.left;
        const y = e.clientY - svgRect.top;

        setNetworkData(prev => ({
            ...prev,
            nodes: prev.nodes.map(node =>
                node.id === draggingNode
                    ? { ...node, x, y }
                    : node
            )
        }));
    }, [draggingNode, networkData]);

    const handleMouseUp = useCallback(() => {
        setDraggingNode(null);
    }, []);

    useEffect(() => {
        window.addEventListener('mouseup', handleMouseUp);
        return () => {
            window.removeEventListener('mouseup', handleMouseUp);
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current);
            }
        };
    }, [handleMouseUp]);

    const getGroupColor = (group) => {
        const colors = {
            '0': '#FF6B6B',
            '1': '#4ECDC4',
            '2': '#45B7D1',
            '3': '#96CEB4',
            '4': '#FFEEAD',
            '5': '#D4A5A5',
            '6': '#9B59B6',
            '7': '#3498DB',
            '8': '#E67E22',
            '9': '#2ECC71',
            'a': '#FF69B4',
            'b': '#5D4037',
            'c': '#7986CB',
            'd': '#FFD700',
            'e': '#8E44AD',
            'f': '#16A085',
        };
        return colors[group.toLowerCase()] || '#9CA3AF';
    };

    const renderConnections = () => {
        return networkData.connections.map((conn, i) => {
            const sourceNode = networkData.nodes.find(n => n.id === conn.source);
            const targetNode = networkData.nodes.find(n => n.id === conn.target);
            if (!sourceNode || !targetNode) return null;

            const isDiscovered = discoveredConnections.has(JSON.stringify(conn));
            const isSelected = selectedNode &&
                (selectedNode.id === sourceNode.id || selectedNode.id === targetNode.id);

            return (
                <g key={`conn-${i}`}>
                    <line
                        x1={sourceNode.x}
                        y1={sourceNode.y}
                        x2={targetNode.x}
                        y2={targetNode.y}
                        stroke={isDiscovered ? "#4CAF50" : "#CBD5E0"}
                        strokeWidth={isSelected ? "2" : "1"}
                        strokeOpacity={isDiscovered ? "0.8" : "0.6"}
                    />
                    {isDiscovered && (
                        <path
                            d={`M ${(sourceNode.x + targetNode.x) / 2} ${(sourceNode.y + targetNode.y) / 2}
                               l -4 -4 l 4 4 l -4 4`}
                            stroke="#4CAF50"
                            fill="none"
                            strokeWidth="2"
                        />
                    )}
                </g>
            );
        });
    };

    return (
        <div className="w-full bg-white rounded-lg shadow-lg p-4">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">P2P Network Topology</h2>
                <div className="flex items-center space-x-2">
                    <input
                        type="text"
                        value={seedNode.ip}
                        onChange={(e) => setSeedNode(prev => ({ ...prev, ip: e.target.value }))}
                        placeholder="IP Address"
                        className="px-2 py-1 border rounded"
                    />
                    <input
                        type="text"
                        value={seedNode.port}
                        onChange={(e) => setSeedNode(prev => ({ ...prev, port: e.target.value }))}
                        placeholder="Port"
                        className="px-2 py-1 border rounded w-20"
                    />
                    <button
                        onClick={fetchNetworkData}
                        className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
                        disabled={loading}
                    >
                        <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </div>

            {error ? (
                <div className="p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                    {error}
                </div>
            ) : (
                <div className="flex space-x-4">
                    <div className="flex-1 space-y-4">
                        {networkData && (
                            <div className="bg-gray-50 p-4 rounded">
                                <div className="text-sm font-medium">Network Statistics</div>
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                    <div>
                                        <div className="text-gray-500">Total Nodes</div>
                                        <div className="text-lg">{networkData.stats.totalNodes}</div>
                                    </div>
                                    <div>
                                        <div className="text-gray-500">Active Connections</div>
                                        <div className="text-lg">{networkData.stats.activeConnections}</div>
                                    </div>
                                </div>
                                <div className="mt-4">
                                    <div className="text-sm font-medium mb-2">Groups Distribution</div>
                                    <div className="grid grid-cols-6 gap-2">
                                        {Object.entries(networkData.stats.groupStats).map(([group, count]) => (
                                            <div key={group} className="text-center">
                                                <div className="text-xs font-medium" style={{ color: getGroupColor(group) }}>
                                                    Group {group}
                                                </div>
                                                <div className="text-sm">{count} nodes</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        <svg
                            width={dimensions.width}
                            height={dimensions.height}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            className="border rounded bg-white"
                            style={{ touchAction: 'none', userSelect: 'none' }}
                        >
                            {networkData && (
                                <>
                                    {renderConnections()}
                                    {networkData.nodes.map((node) => {
                                        const groupColor = getGroupColor(node.id.charAt(0));
                                        const isSelected = selectedNode && selectedNode.id === node.id;

                                        return (
                                            <g
                                                key={node.id}
                                                transform={`translate(${node.x},${node.y})`}
                                                onMouseDown={(e) => handleMouseDown(e, node.id)}
                                                onClick={(e) => handleNodeClick(e, node)}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                {isSelected && (
                                                    <circle
                                                        r={25}
                                                        fill="none"
                                                        stroke="#3B82F6"
                                                        strokeWidth="2"
                                                        strokeDasharray="4,2"
                                                    />
                                                )}
                                                {node.isRoot && (
                                                    <circle
                                                        r={22}
                                                        fill="none"
                                                        stroke="#3B82F6"
                                                        strokeWidth="2"
                                                        strokeDasharray="4,2"
                                                    />
                                                )}
                                                <circle
                                                    r={node.isRoot ? 20 : 15}
                                                    fill={groupColor}
                                                    opacity={node.isActive ? 1 : 0.5}
                                                />
                                                {node.isRoot && (
                                                    <circle
                                                        r={5}
                                                        cx={0}
                                                        cy={0}
                                                        fill="white"
                                                        stroke={groupColor}
                                                        strokeWidth="2"
                                                    />
                                                )}
                                                <text
                                                    textAnchor="middle"
                                                    dy="30"
                                                    className="text-xs"
                                                    fill="#4B5563"
                                                >
                                                    {`${node.ip}:${node.port}`}
                                                </text>
                                            </g>
                                        );
                                    })}
                                </>
                            )}
                        </svg>
                    </div>

                    {selectedNode && (
                        <div className="w-80 bg-gray-50 p-4 rounded">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-medium">Node Details</h3>
                                <button
                                    onClick={() => setSelectedNode(null)}
                                    className="text-gray-500 hover:text-gray-700"
                                >
                                    ×
                                </button>
                            </div>

                            {queryLoading ? (
                                <div className="flex items-center justify-center p-4">
                                    <RefreshCw className="h-6 w-6 animate-spin text-blue-500" />
                                </div>
                            ) : nodeDetails ? (
                                <div className="space-y-4">
                                    <div>
                                        <div className="text-sm text-gray-500">Node ID</div>
                                        <div className="font-mono">{nodeDetails.nodeId}</div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-500">Address</div>
                                        <div>{`${selectedNode.ip}:${selectedNode.port}`}</div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-500">Status</div>
                                        <div className={`flex items-center ${selectedNode.isActive ? 'text-green-500' : 'text-red-500'}`}>
                                            <span className={`w-2 h-2 rounded-full mr-2 ${selectedNode.isActive ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                            {selectedNode.isActive ? 'Active' : 'Inactive'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-500">Direct Connections</div>
                                        <div className="text-2xl font-semibold">{nodeDetails.connections.length}</div>
                                    </div>
                                    <div>
                                        <div className="text-sm text-gray-500">Connected Peers</div>
                                        <div className="mt-2 space-y-2 max-h-40 overflow-y-auto">
                                            {nodeDetails.connections.map((peer, index) => (
                                                <div key={index} className="text-sm bg-white p-2 rounded">
                                                    {`${peer.ip}:${peer.port}`}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <div className="text-sm text-gray-500 mb-2">Connection Legend</div>
                                        <div className="space-y-2">
                                            <div className="flex items-center">
                                                <div className="w-8 h-0.5 bg-gray-300 mr-2"></div>
                                                <span className="text-sm text-gray-600">Initial Connection</span>
                                            </div>
                                            <div className="flex items-center">
                                                <div className="w-8 h-0.5 bg-green-500 mr-2"></div>
                                                <span className="text-sm text-gray-600">Discovered Connection</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-gray-500">Failed to load node details</div>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default NetworkVisualizer;