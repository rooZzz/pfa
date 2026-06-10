import { useState } from "react";
import { Masthead } from "../branding.js";
import { ActionBar, Badge, Btn, Icon, TickerChip } from "../components.js";
import { LoadingScreen, toolText } from "../screen.js";
import type { App } from "../screen.js";

type EthStatus =
  | "form"
  | "discovering"
  | "select"
  | "connecting"
  | "syncing"
  | "connected"
  | "error";

type DiscoveredAsset = {
  kind: "native" | "token";
  symbol: string;
  name: string;
  contract_address: string | null;
  decimals: number;
  raw_balance: string;
  display_balance: string;
};

type WalletDiscovery = {
  address: string;
  assets: DiscoveredAsset[];
  transfers_capped: boolean;
};

function assetKey(asset: DiscoveredAsset): string {
  return asset.contract_address
    ? `token:${asset.contract_address}`
    : `native:${asset.symbol.toUpperCase()}`;
}

export function EthereumConnector({ app, onBack }: { app: App; onBack: () => void }) {
  const [status, setStatus] = useState<EthStatus>("form");
  const [address, setAddress] = useState("");
  const [discovery, setDiscovery] = useState<WalletDiscovery | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const canDiscover = address.trim() !== "";

  async function handleDiscover(preselect?: Set<string>) {
    if (!canDiscover) return;
    setStatus("discovering");
    setErrorMessage(null);
    try {
      const result = await app.callServerTool({
        name: "discover_ethereum_wallet",
        arguments: { address: address.trim() },
      });
      const parsed = JSON.parse(toolText(result) ?? "") as WalletDiscovery;
      setDiscovery(parsed);
      setSelected(preselect ?? new Set(parsed.assets.map(assetKey)));
      setStatus("select");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Could not read the wallet.");
    }
  }

  async function handleConnect() {
    if (!discovery) return;
    const selections = discovery.assets
      .filter((a) => selected.has(assetKey(a)))
      .map((a) => ({
        kind: a.kind,
        symbol: a.symbol,
        name: a.name,
        contract_address: a.contract_address,
        decimals: a.decimals,
      }));
    if (selections.length === 0) {
      setErrorMessage("Select at least one asset to track.");
      return;
    }
    setStatus("connecting");
    setErrorMessage(null);
    try {
      const result = await app.callServerTool({
        name: "connect_ethereum",
        arguments: { address: address.trim(), selections },
      });
      setMessage(toolText(result) ?? "Done.");
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Connection failed.");
    }
  }

  async function handleSync() {
    setStatus("syncing");
    setErrorMessage(null);
    try {
      const result = await app.callServerTool({ name: "sync_ethereum", arguments: {} });
      setMessage(toolText(result) ?? "Done.");
      setStatus("connected");
    } catch (err) {
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Sync failed.");
    }
  }

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function selectAll() {
    if (!discovery) return;
    setSelected(new Set(discovery.assets.map(assetKey)));
  }

  function clearAll() {
    setSelected(new Set());
  }

  if (status === "discovering" || status === "connecting" || status === "syncing") {
    const label =
      status === "discovering"
        ? "Reading wallet · discovering tokens"
        : status === "connecting"
          ? "Importing holdings"
          : "Syncing balances";
    return <LoadingScreen rise label={label} />;
  }

  if (status === "select" && discovery) {
    return (
      <div className="screen rise">
        <Masthead
          lead={
            <span className="chip-ico chip-ico--muted">
              <Icon name="plug" size={18} />
            </span>
          }
          title="Choose assets to track"
          sub={`${address.slice(0, 6)}…${address.slice(-4)}`}
          titleSize="var(--text-md)"
        />
        {discovery.transfers_capped && (
          <p className="caption mb-4">
            Token list built from the most recent transfers; very old, untouched tokens
            may not appear.
          </p>
        )}
        {errorMessage && <p className="note mb-4">{errorMessage}</p>}
        <div className="row-between asset-select-bar">
          <span className="asset-select-count">
            {selected.size} of {discovery.assets.length} selected
          </span>
          <div className="row-2">
            <Btn
              variant="ghost"
              size="sm"
              disabled={selected.size === discovery.assets.length}
              onClick={selectAll}
            >
              Select all
            </Btn>
            <Btn
              variant="ghost"
              size="sm"
              disabled={selected.size === 0}
              onClick={clearAll}
            >
              Clear
            </Btn>
          </div>
        </div>
        <div className="asset-list">
          {discovery.assets.map((asset) => {
            const key = assetKey(asset);
            return (
              <label key={key} className="card card-sunken asset-row">
                <input
                  type="checkbox"
                  checked={selected.has(key)}
                  onChange={() => toggle(key)}
                />
                <TickerChip ticker={asset.symbol} />
                <span className="asset-id">
                  <span className="asset-sym">{asset.symbol}</span>
                  {asset.kind === "token" && (
                    <span className="asset-name">{asset.name}</span>
                  )}
                </span>
                <span className="num asset-bal">{asset.display_balance}</span>
              </label>
            );
          })}
        </div>
        <ActionBar
          step="Step 2 of 2"
          secondary={
            <Btn
              variant="ghost"
              size="sm"
              onClick={() => {
                setStatus("form");
                setDiscovery(null);
              }}
            >
              Back
            </Btn>
          }
          primary={
            <Btn
              variant="primary"
              icon="check"
              disabled={selected.size === 0}
              onClick={() => void handleConnect()}
            >
              Import {selected.size} asset{selected.size === 1 ? "" : "s"}
            </Btn>
          }
        />
      </div>
    );
  }

  if (status === "connected") {
    return (
      <div className="screen rise">
        <Masthead
          lead={
            <span className="chip-ico chip-ico--accent">
              <Icon name="plug" size={18} />
            </span>
          }
          title="Ethereum wallet"
          sub="on-chain holdings · manual sync"
          titleSize="var(--text-md)"
          action={
            <Badge tone="ok" led>
              connected
            </Badge>
          }
        />
        <div className="card card-sunken mt-4">
          <p className="note">{message}</p>
        </div>
        <ActionBar
          secondary={
            <>
              <Btn variant="ghost" size="sm" onClick={onBack}>
                All connectors
              </Btn>
              <Btn variant="secondary" onClick={() => void handleDiscover(selected)}>
                Edit selection
              </Btn>
              <Btn
                variant="ghost"
                icon="plug"
                onClick={() => {
                  setStatus("form");
                  setAddress("");
                  setDiscovery(null);
                  setSelected(new Set());
                  setMessage(null);
                }}
              >
                Reconnect
              </Btn>
            </>
          }
          primary={
            <Btn variant="primary" icon="sync" onClick={() => void handleSync()}>
              Sync now
            </Btn>
          }
        />
      </div>
    );
  }

  return (
    <div className="screen rise">
      <Masthead
        lead={
          <span className="chip-ico chip-ico--muted">
            <Icon name="plug" size={18} />
          </span>
        }
        title="Connect Ethereum wallet"
        titleSize="var(--text-md)"
      />
      <p className="note mt-3 mb-4">
        Paste a public wallet address. The Etherscan key is read from server config.
      </p>
      {status === "error" && errorMessage && <p className="note mb-4">{errorMessage}</p>}
      <label className="field-label">Wallet address</label>
      <input
        className="input"
        spellCheck={false}
        placeholder="0x…"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <p className="caption row-2 mt-3" style={{ gap: "var(--space-1)" }}>
        <Icon name="info" size={12} /> on-chain, read-only
      </p>
      <ActionBar
        step="Step 1 of 2"
        secondary={
          <Btn variant="ghost" size="sm" onClick={onBack}>
            All connectors
          </Btn>
        }
        primary={
          <Btn
            variant="primary"
            icon="check"
            onClick={() => void handleDiscover()}
            disabled={!canDiscover}
          >
            Discover assets
          </Btn>
        }
      />
    </div>
  );
}
