import { useState } from 'react'
import NetworkVisualizer from './components/NetworkVisualizer'

function App() {
    return (
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-7xl mx-auto px-4 py-8">
                <header className="mb-8">
                    <h1 className="text-3xl font-bold text-gray-900">
                        P2P Network Visualizer
                    </h1>
                </header>
                <main>
                    <NetworkVisualizer />
                </main>
            </div>
        </div>
    )
}

export default App