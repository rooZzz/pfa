import { useState } from "react";
import type { ReactNode } from "react";
import { Masthead } from "./branding.js";
import { Icon } from "./components.js";
import { EthereumConnector } from "./connectors/ethereum.js";
import { MonzoConnector } from "./connectors/monzo.js";
import { ConnectionError, LoadingScreen, mountScreen, usePfaApp } from "./screen.js";

function ConnectorCard({
  icon,
  title,
  sub,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button className="card row-between connector-card" onClick={onClick}>
      <span className="row row-2 grow">
        <span className="chip-ico chip-ico--muted">{icon}</span>
        <span className="connector-meta">
          <span className="connector-name">{title}</span>
          <span className="connector-sub">{sub}</span>
        </span>
      </span>
      <Icon
        name="chevron"
        size={16}
        className="chev"
        style={{ transform: "rotate(-90deg)" }}
      />
    </button>
  );
}

function Picker({ onPick }: { onPick: (c: "monzo" | "ethereum") => void }) {
  return (
    <div className="screen rise">
      <Masthead
        title="Connectors"
        sub="import balances and holdings"
        titleSize="var(--text-md)"
      />
      <div className="stack-2 mt-4">
        <ConnectorCard
          icon={<Icon name="bank" size={18} />}
          title="Monzo"
          sub="accounts, pots, transactions"
          onClick={() => onPick("monzo")}
        />
        <ConnectorCard
          icon={<Icon name="plug" size={18} />}
          title="Ethereum wallet"
          sub="ETH and ERC-20 holdings"
          onClick={() => onPick("ethereum")}
        />
      </div>
    </div>
  );
}

function ConnectorsApp() {
  const [connector, setConnector] = useState<"monzo" | "ethereum" | null>(null);
  const { app, error } = usePfaApp();

  if (error) return <ConnectionError message={error.message} />;
  if (!app) return <LoadingScreen rise label="Connecting" />;
  if (connector === "monzo")
    return <MonzoConnector app={app} onBack={() => setConnector(null)} />;
  if (connector === "ethereum")
    return <EthereumConnector app={app} onBack={() => setConnector(null)} />;
  return <Picker onPick={setConnector} />;
}

mountScreen(<ConnectorsApp />);
