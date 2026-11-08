import type { GetV1ConnectionLocationsCityIdServers200Item } from "../../generated/api/endpoints.schemas";

interface Props {
  servers: GetV1ConnectionLocationsCityIdServers200Item[];
  disabled: boolean;
  onSelect: (serverName: string) => void;
  onToggleFavorite: (serverName: string, favorite: boolean) => void;
}

/** Score順のサーバ行を表示し、選択とお気に入り操作を親へ渡す。 */
export function ServerList({ servers, disabled, onSelect, onToggleFavorite }: Props) {
  const orderedServers = [...servers].sort((left, right) => left.score - right.score || left.name.localeCompare(right.name));

  return (
    <div className="location-list">
      <div className="location-scroll">
        <ul aria-label="サーバ" className="location-items">
          {orderedServers.map((server) => (
            <li key={server.name} className="location-item">
              <label className="location-row">
                <input
                  type="radio"
                  name="server"
                  className="visually-hidden"
                  disabled={disabled}
                  checked={server.connected}
                  onChange={() => onSelect(server.name)}
                />
                <span className="location-name">
                  <span className="location-title">
                    <strong>{server.name}</strong>
                    {server.connected ? <span className="badge badge-ok">接続中</span> : null}
                  </span>
                </span>
                <span>{server.tier === "free" ? "無料" : "有料"}</span>
                <span>{server.load}%</span>
                <span>{server.score}</span>
              </label>
              <button
                type="button"
                className="star"
                aria-pressed={server.favorite}
                aria-label={server.favorite ? `${server.name}のお気に入りを解除` : `${server.name}をお気に入りに追加`}
                onClick={() => onToggleFavorite(server.name, !server.favorite)}
              >
                {server.favorite ? "★" : "☆"}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
