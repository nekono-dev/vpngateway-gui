// 責務: 横にスクロールする列（タブ列）を、ブラウザ標準のスクロールバーを使わず自前のバーで描画する。
// 標準のバーは、Safariで表示の有無や太さが初回レイアウト後に変わり、内容（ボタン）に被ったり高さが崩れたりして不安定なため、
// バーを通常のレイアウトに置く（高さが常に確定する）。縦ホイールは横スクロールへ変換する。

import {
  useEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent,
} from "react";

type Props = HTMLAttributes<HTMLDivElement> & {
  /** 外枠（列とバーを包む要素）へ付けるクラス。 */
  wrapperClassName?: string;
};

interface ThumbState {
  /** 内容が表示幅を超えていて、バーを出すか。 */
  overflowing: boolean;
  /** つまみの左端・幅（トラック幅に対する割合、0〜1）。 */
  start: number;
  size: number;
}

const HIDDEN: ThumbState = { overflowing: false, start: 0, size: 1 };

/**
 * 目的: 子要素を横スクロールする列として表示し、自前のスクロールバーを下に付ける。
 * 入力: 子要素と、列の要素（`role`・`aria-label`・`className`等）へ渡す属性。
 * 出力: 列（スクロール領域）と、はみ出したときだけ表示するバー。
 * 副作用: 縦ホイールを横スクロールへ変換する（これ以上動かせない向きではページ側へ譲る）。
 */
export function HorizontalScroll({
  className,
  wrapperClassName,
  children,
  ...rest
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<ThumbState>(HIDDEN);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const update = () => {
      const { scrollWidth, clientWidth, scrollLeft } = viewport;
      if (scrollWidth <= clientWidth + 1) {
        setThumb((current) => (current.overflowing ? HIDDEN : current));
        return;
      }
      const start = scrollLeft / scrollWidth;
      const size = clientWidth / scrollWidth;
      // 値が同じなら更新しない（毎回のレンダリング後に呼ばれるため、更新すると再レンダリングが止まらなくなる）。
      setThumb((current) =>
        current.overflowing && current.start === start && current.size === size
          ? current
          : { overflowing: true, start, size },
      );
    };

    const onWheel = (event: WheelEvent) => {
      // 横の動き（トラックパッド等）が主ならブラウザ標準に任せ、縦が主のときだけ横へ変換する。
      if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = viewport.scrollWidth - viewport.clientWidth;
      if (max <= 0) return;
      const next = viewport.scrollLeft + event.deltaY;
      // 端まで来て動かせないときは、ページの縦スクロールへ譲る。
      if (
        (event.deltaY < 0 && viewport.scrollLeft <= 0) ||
        (event.deltaY > 0 && viewport.scrollLeft >= max)
      ) {
        return;
      }
      event.preventDefault();
      viewport.scrollLeft = Math.min(max, Math.max(0, next));
    };

    update();
    viewport.addEventListener("scroll", update, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: false });
    const observer = new ResizeObserver(update);
    observer.observe(viewport);
    // 子（タブ）の増減・文字幅の変化でも再計算する。
    for (const child of Array.from(viewport.children)) observer.observe(child);
    return () => {
      viewport.removeEventListener("scroll", update);
      viewport.removeEventListener("wheel", onWheel);
      observer.disconnect();
    };
  });

  // つまみのドラッグ: 押した位置と、そのときのscrollLeftを覚え、動いた分をスクロール量へ換算する。
  const dragRef = useRef<{ x: number; left: number } | null>(null);

  const onThumbDown = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, left: viewport.scrollLeft };
  };

  const onThumbMove = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    const drag = dragRef.current;
    if (!viewport || !track || !drag) return;
    viewport.scrollLeft =
      drag.left +
      ((event.clientX - drag.x) / track.clientWidth) * viewport.scrollWidth;
  };

  const onThumbUp = () => {
    dragRef.current = null;
  };

  // トラックの押下: つまみの中心がその位置へ来るようにスクロールする。
  const onTrackDown = (event: PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track || event.target !== track) return;
    const rect = track.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    viewport.scrollLeft =
      ratio * viewport.scrollWidth - viewport.clientWidth / 2;
  };

  return (
    <div
      className={["hscroll", wrapperClassName].filter(Boolean).join(" ")}
    >
      <div
        ref={viewportRef}
        className={["hscroll-viewport", className].filter(Boolean).join(" ")}
        {...rest}
      >
        {children}
      </div>
      {thumb.overflowing ? (
        <div
          ref={trackRef}
          className="hscroll-track"
          aria-hidden="true"
          onPointerDown={onTrackDown}
        >
          <div
            className="hscroll-thumb"
            style={{
              left: `${thumb.start * 100}%`,
              width: `${thumb.size * 100}%`,
            }}
            onPointerDown={onThumbDown}
            onPointerMove={onThumbMove}
            onPointerUp={onThumbUp}
            onPointerCancel={onThumbUp}
          />
        </div>
      ) : null}
    </div>
  );
}
