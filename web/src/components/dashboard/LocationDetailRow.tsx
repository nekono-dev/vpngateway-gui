// 責務: 接続先の国・都市行とサーバ行に、階層に応じた項目と距離を表示する。

import type { GetV1ConnectionLocationsCityIdServers200Item } from "../../generated/api/endpoints.schemas";
import { formatDistance } from "../../locations/format-distance";

type LocationProps = {
  kind: "location";
  name: string;
  country: string;
  countryName: string;
  city?: string;
  distanceKm?: number;
  pingMs?: number;
};

type ServerProps = {
  kind: "server";
  name: string;
  tier: GetV1ConnectionLocationsCityIdServers200Item["tier"];
  load: number;
  score: number;
};

type Props = LocationProps | ServerProps;


export function LocationDetailRow(props: Props) {
  if (props.kind === "server") {
    return (
      <li className="location-item">
        <div className="location-row location-row-static">
          <span className="location-name">
            <span className="location-title"><strong>{props.name}</strong></span>
          </span>
          <span>{props.tier === "free" ? "無料" : "有料"}</span>
          <span>{props.load}%</span>
          <span>{props.score}</span>
        </div>
      </li>
    );
  }

  const label = props.city ?? props.name;
  return (
    <li className="location-item">
      <div className="location-row location-row-static">
        <span className="location-iso">{props.country.toUpperCase()}</span>
        <span className="location-name">
          <span className="location-title"><strong>{label}</strong></span>
        </span>
        {props.city === undefined || props.pingMs === undefined ? null : <span className="location-ping">{props.pingMs} ms</span>}
        {props.distanceKm === undefined ? null : <span className="location-distance">約 {formatDistance(props.distanceKm)}</span>}
      </div>
    </li>
  );
}
