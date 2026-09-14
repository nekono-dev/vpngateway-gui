// 責務: 「1行1値」の複数行テキスト入力を文字列配列として編集するための汎用UI部品。
// `excludedDomains`・`explicitProxyAllowedCidrs`など、値の妥当性検証は持たず表示・編集のみを行う
// （webserver/requirements.md「設定ダイアログの入力項目」参照。保存時に呼び出し元が配列へ変換する）。

interface Props {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function LineListEditor({ label, value, onChange, disabled, placeholder }: Props) {
  return (
    <label>
      {label}
      <textarea
        rows={4}
        disabled={disabled}
        placeholder={placeholder}
        value={value.join("\n")}
        onChange={(event) => onChange(event.target.value.split("\n"))}
      />
    </label>
  );
}
