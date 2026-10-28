/** Server-renderable faceted fallback while the desktop scene loads. */
export function CoreFallback({ description }: { description: string }) {
  return <div className="core-object" role="img" aria-label={description}>
    <svg viewBox="0 0 480 480" aria-hidden="true" focusable="false">
      <defs><linearGradient id="landing-core-face" x1=".1" y1="0" x2=".9" y2="1"><stop offset="0" stopColor="#e6eaff" /><stop offset=".45" stopColor="#8798ed" /><stop offset="1" stopColor="#344381" /></linearGradient></defs>
      <path className="core-shadow" d="M240 52 363 103 424 226 382 349 263 427 130 395 54 286 75 157 169 68Z" />
      <path className="facet facet-back" d="M240 52 363 103 424 226 382 349 263 427 130 395 54 286 75 157 169 68Z" />
      <path className="facet facet-a" d="M240 52 363 103 296 170 240 210 169 68Z" />
      <path className="facet facet-b" d="M363 103 424 226 345 250 296 170Z" />
      <path className="facet facet-c" d="M424 226 382 349 286 315 345 250Z" />
      <path className="facet facet-d" d="M382 349 263 427 240 352 286 315Z" />
      <path className="facet facet-e" d="M263 427 130 395 168 309 240 352Z" />
      <path className="facet facet-f" d="M130 395 54 286 136 242 168 309Z" />
      <path className="facet facet-g" d="M54 286 75 157 143 182 136 242Z" />
      <path className="facet facet-h" d="M75 157 169 68 240 210 143 182Z" />
      <path className="facet facet-center" d="M240 210 296 170 345 250 286 315 240 352 168 309 136 242 143 182Z" />
      <path className="facet-aperture" d="M240 210 296 170 345 250 286 315Z" /><circle className="facet-aperture-rim" cx="284" cy="246" r="27" /><circle className="facet-aperture-eye" cx="284" cy="246" r="11" />
      <path className="facet-line" d="M240 52 240 210M363 103 296 170M424 226 345 250M382 349 286 315M263 427 240 352M130 395 168 309M54 286 136 242M75 157 143 182M169 68 143 182M240 210 345 250M240 210 168 309M240 352 240 210" />
      <path className="facet-rim" d="M240 52 363 103 424 226 382 349 263 427 130 395 54 286 75 157 169 68Z" />
    </svg>
  </div>;
}

export function CorePoster() {
  return <div className="core-column">
    <div className="core-display" data-state="idle" data-renderer="fallback">
      <div className="core-topline"><span>Vaani Core</span><span>VOICE / INTENT / VERIFIED PREVIEW</span></div>
      <div className="core-orbit">
        <div className="orbit orbit-outer" /><div className="orbit orbit-inner" />
        <span className="orbit-node node-stock">Stock</span><span className="orbit-node node-khata">Khata</span><span className="orbit-node node-sales">Sales</span><div className="core-halo" />
        <CoreFallback description="Faceted Vaani Core at rest" />
        <div className="voice-bars" aria-hidden="true">{Array.from({ length: 9 }, (_, i) => <i key={i} />)}</div>
      </div>
      <div className="core-readout">
        <div className="demo-command"><span>SIMULATED MERCHANT COMMAND</span><strong>“Maggi ke 20 packet add karo”</strong></div>
        <div className="core-demo-response"><div className="demo-status"><span className="readout-dot" aria-hidden="true" /><strong>Ready for a request</strong></div><p>An illustrative command is queued. Your microphone is off.</p></div>
      </div>
    </div>
    <div className="core-sequence" aria-label="Illustrative sequence: voice, understanding, validated preview, simulated result"><div className="sequence-track" aria-hidden="true">{Array.from({ length: 4 }, (_, i) => <i key={i} />)}</div><span>Voice</span><span>Understand</span><span>Preview</span><span>Illustrate</span></div>
  </div>;
}
