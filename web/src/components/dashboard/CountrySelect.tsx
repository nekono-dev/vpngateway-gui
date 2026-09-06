// 責務: 接続国の選択のみを行う。管理者向け設定に定義された選択肢のみを提示し、自由入力は行わない
// （webserver/requirements.md「画面構成」参照）。

interface Props {
  countries: string[];
  value: string | undefined;
  onChange: (country: string) => void;
  disabled: boolean;
}

export function CountrySelect({ countries, value, onChange, disabled }: Props) {
  return (
    <select
      aria-label="接続国"
      value={value ?? ""}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="" disabled>
        国を選択
      </option>
      {countries.map((country) => (
        <option key={country} value={country}>
          {country.toUpperCase()}
        </option>
      ))}
    </select>
  );
}
