import { Cpu, Thermometer, Activity } from 'lucide-react'

export function HardwareWidget() {
  return (
    <div className="border border-terminal-dim p-4 rounded-md bg-black/60 font-mono text-xs">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-terminal-dim text-terminal-green/80">
        <Cpu size={14} />
        <span className="uppercase tracking-widest font-bold">Node Status : ONLINE</span>
      </div>
      
      <div className="space-y-2 text-terminal-green/60">
        <div className="flex justify-between">
          <span>Model:</span>
          <span className="text-terminal-green">Llama-3-8B-Instruct</span>
        </div>
        <div className="flex justify-between">
          <span>GPU Name:</span>
          <span className="text-terminal-green">RTX 4090 (24GB)</span>
        </div>
        <div className="flex justify-between">
          <span>VRAM Usage:</span>
          <span className="text-terminal-green">14.2 GB / 24.0 GB</span>
        </div>
        <div className="flex justify-between">
          <span className="flex items-center gap-1"><Thermometer size={12}/> Core Temp:</span>
          <span className="text-terminal-green">64°C</span>
        </div>
        <div className="flex justify-between">
          <span className="flex items-center gap-1"><Activity size={12}/> Load:</span>
          <span className="text-terminal-green">89%</span>
        </div>
      </div>
      
      <div className="mt-4 flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-terminal-green animate-pulse"></div>
        <span className="text-terminal-green/50">Settling on Citrea block...</span>
      </div>
    </div>
  )
}
