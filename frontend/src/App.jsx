import TerminalUI from "./components/TerminalUI";
import PixelBlast from "./components/PixelBlast";

function App() {
  return (
    <div className="min-h-screen bg-terminal-bg text-terminal-green flex items-center justify-center p-4 relative">
      {/* Full-screen PixelBlast background */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none" }}>
        <PixelBlast
          variant="square"
          pixelSize={4}
          color="#00ff41"
          patternScale={2.5}
          patternDensity={0.85}
          enableRipples={true}
          rippleIntensityScale={0.8}
          rippleSpeed={0.25}
          rippleThickness={0.08}
          edgeFade={0}
          speed={0.3}
          transparent={true}
          pixelSizeJitter={0.3}
          antialias={false}
        />
      </div>

      {/* Chat window on top */}
      <div
        className="w-full max-w-6xl h-[90vh] border border-terminal-green/50 rounded-md p-1 shadow-[0_0_15px_rgba(0,255,0,0.2)] bg-black/80 backdrop-blur"
        style={{ position: "relative", zIndex: 1 }}
      >
        <TerminalUI />
      </div>
    </div>
  );
}

export default App;
