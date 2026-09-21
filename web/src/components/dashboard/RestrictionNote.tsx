// 責務: 操作が実行できない理由（APIが返した理由文）を表示するだけの部品。無効化した部品の
// `aria-describedby`の参照先になり、支援技術からも理由を辿れるようにする
// （webserver/requirements.md「操作の制限表示」）。表示するかどうかの判断は呼び出し側が行う。

interface Props {
  // 無効化した部品からaria-describedbyで参照するためのid。
  id?: string;
  // 理由文。undefinedなら何も表示しない。
  message: string | undefined;
}

export function RestrictionNote({ id, message }: Props) {
  if (message === undefined) return null;
  return (
    <p id={id} role="note" className="restriction">
      {message}
    </p>
  );
}
