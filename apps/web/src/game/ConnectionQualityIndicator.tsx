import type { NetworkStatus } from "../net/MultiplayerClient";

interface ConnectionQualityIndicatorProps {
  networkStatus: NetworkStatus;
}

export function ConnectionQualityIndicator({ networkStatus }: ConnectionQualityIndicatorProps) {
  let quality: "good" | "fair" | "poor" | "checking" | "unresponsive" | "reconnecting" | "offline";
  let label: string;

  if (networkStatus.state === "connecting") {
    quality = "reconnecting";
    label = "RECONNECTING";
  } else if (networkStatus.state !== "connected") {
    quality = "offline";
    label = "OFFLINE";
  } else if (networkStatus.pingTimedOut) {
    quality = "unresponsive";
    label = "NO SIGNAL";
  } else if (networkStatus.latencyMs === undefined) {
    quality = "checking";
    label = "CHECKING";
  } else if (networkStatus.latencyMs <= 100) {
    quality = "good";
    label = "GOOD";
  } else if (networkStatus.latencyMs <= 200) {
    quality = "fair";
    label = "FAIR";
  } else {
    quality = "poor";
    label = "WEAK";
  }

  const latencyText = networkStatus.latencyMs === undefined ? undefined : `${networkStatus.latencyMs} ms`;
  const accessibleLabel = latencyText ? `Game connection ${label.toLowerCase()}, ${latencyText} round-trip` : `Game connection ${label.toLowerCase()}`;

  return <div className={`connection-quality quality-${quality}`} role="img" aria-label={accessibleLabel} title={accessibleLabel}>
    <span className="connection-quality-bars" aria-hidden="true"><i /><i /><i /><i /></span>
    <span>{label}</span>
    {latencyText && <small>{latencyText}</small>}
  </div>;
}
