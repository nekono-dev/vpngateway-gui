// 責務: 設定の「利用者の場所」タブの内容（現在の国の表示、国の選択、保存、既定値に戻す、ブラウザ由来の注記）。
// API は生成クライアントだけを使う。保存・既定へ戻すの結果は、応答の表示で反映する。

import { useEffect, useState } from "react";
import { deleteV1UserLocation, getV1UserLocation, putV1UserLocation } from "../../generated/api/default/default";
import { describeApiError } from "../../notifications/describe-api-error";

interface CountryOption {
  code: string;
  name: string;
}

interface View {
  saved?: string;
  effective?: string;
  source: "saved" | "browser" | "none";
  countries: CountryOption[];
}

/**
 * 目的: 応答（200）の本体を表示用の状態にする。
 */
function toView(data: unknown): View {
  const body = data as Partial<View>;
  return {
    saved: body.saved,
    effective: body.effective,
    source: body.source ?? "none",
    countries: body.countries ?? [],
  };
}

export function UserLocationPanel() {
  const [view, setView] = useState<View>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getV1UserLocation()
      .then((response) => {
        if (response.status !== 200) {
          setError(describeApiError(response.status, response.data, "利用者の場所の取得に失敗しました").summary);
          return;
        }
        const next = toView(response.data);
        setView(next);
        setSelected(next.saved ?? next.effective ?? "");
      })
      .catch(() => setError("利用者の場所の取得に失敗しました"));
  }, []);

  const applyResponse = (status: number, data: unknown, fallback: string): void => {
    if (status !== 200) {
      setError(describeApiError(status, data, fallback).summary);
      return;
    }
    const next = toView(data);
    setView(next);
    setSelected(next.saved ?? next.effective ?? "");
    setError(undefined);
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await putV1UserLocation({ country: selected });
      applyResponse(response.status, response.data, "利用者の場所の保存に失敗しました");
    } catch {
      setError("利用者の場所の保存に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  const resetToDefault = async (): Promise<void> => {
    setBusy(true);
    try {
      const response = await deleteV1UserLocation();
      applyResponse(response.status, response.data, "既定値への変更に失敗しました");
    } catch {
      setError("既定値への変更に失敗しました");
    } finally {
      setBusy(false);
    }
  };

  if (view === undefined) {
    return error === undefined ? null : <p role="alert" className="restriction">{error}</p>;
  }

  const current = view.countries.find((country) => country.code === view.effective);

  return (
    <div className="user-location-panel">
      <p>
        現在の場所: {current?.name ?? "未設定"}
      </p>
      {view.source === "browser" ? (
        <p className="hint">既定値はブラウザの言語設定から推定したもので、現在の場所と異なる場合があります</p>
      ) : null}
      <label htmlFor="user-location-country">利用者の国</label>
      <select
        id="user-location-country"
        aria-label="利用者の国"
        value={selected}
        onChange={(event) => setSelected(event.target.value)}
      >
        <option value="">選択してください</option>
        {view.countries.map((country) => (
          <option key={country.code} value={country.code}>
            {country.name}
          </option>
        ))}
      </select>
      <div className="maintenance-actions">
        <button type="button" disabled={busy || selected === ""} onClick={() => void save()}>
          保存
        </button>
        <button type="button" disabled={busy} onClick={() => void resetToDefault()}>
          既定値に戻す
        </button>
      </div>
      {error === undefined ? null : <p role="alert" className="restriction">{error}</p>}
    </div>
  );
}
