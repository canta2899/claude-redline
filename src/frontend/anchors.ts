import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export interface AnchorItem {
  id: string;
  quote?: string;
}

const GAP = 12;
const HL_NAME = "redline-quote";
const HL_ACTIVE = "redline-quote-active";

// Not in every TS DOM lib yet.
type HighlightCtor = new (...ranges: Range[]) => object;
const win = window as unknown as { Highlight?: HighlightCtor };
const cssHighlights = (CSS as unknown as { highlights?: Map<string, object> }).highlights;

export interface Placement {
  tops: Record<string, number>;
  layerHeight: number;
  order: string[];
}

export function useAnchoredThreads(
  pageRef: RefObject<HTMLElement | null>,
  marginRef: RefObject<HTMLElement | null>,
  threads: AnchorItem[],
  activeId: string | null,
  contentKey: string
): {
  placement: Placement;
  registerCard: (id: string) => (el: HTMLDivElement | null) => void;
  orphaned: Set<string>;
} {
  const cardEls = useRef<Map<string, HTMLDivElement>>(new Map());
  const [placement, setPlacement] = useState<Placement>({ tops: {}, layerHeight: 0, order: [] });
  const [orphaned, setOrphaned] = useState<Set<string>>(new Set());
  const [tick, setTick] = useState(0);

  const registerCard = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) cardEls.current.set(id, el);
      else cardEls.current.delete(id);
    },
    []
  );

  const signature = threads.map((t) => `${t.id}:${t.quote ?? ""}`).join("|");

  useLayoutEffect(() => {
    const page = pageRef.current;
    const margin = marginRef.current;
    if (!page || !margin) return;

    const marginTop = margin.getBoundingClientRect().top;

    // A quote no longer found in the document (edited away) anchors to the top,
    // same as an unquoted comment, but is flagged so the card can say so.
    const orphanIds = new Set<string>();
    const anchors = threads.map((t) => {
      const range = t.quote ? findQuoteRange(page, t.quote) : null;
      if (t.quote && !range) orphanIds.add(t.id);
      const top = range ? range.getBoundingClientRect().top - marginTop : 0;
      return { id: t.id, top: Math.max(0, top), range };
    });
    setOrphaned((prev) => (sameSet(prev, orphanIds) ? prev : orphanIds));

    paintHighlights(anchors, activeId);

    const ordered = [...anchors].sort((a, b) => a.top - b.top);
    const tops: Record<string, number> = {};
    let cursor = 0;
    for (const a of ordered) {
      const top = Math.max(a.top, cursor);
      tops[a.id] = top;
      const h = cardEls.current.get(a.id)?.offsetHeight ?? 0;
      cursor = top + h + GAP;
    }

    const next: Placement = { tops, layerHeight: Math.max(0, cursor - GAP), order: ordered.map((a) => a.id) };
    setPlacement((prev) => (samePlacement(prev, next) ? prev : next));
  }, [signature, activeId, contentKey, tick, pageRef, marginRef, threads]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return;
    const bump = () => setTick((n) => n + 1);
    const ro = new ResizeObserver(bump);
    ro.observe(page);
    window.addEventListener("resize", bump);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", bump);
    };
  }, [pageRef]);

  return { placement, registerCard, orphaned };
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

function paintHighlights(anchors: { id: string; range: Range | null }[], activeId: string | null): void {
  if (!cssHighlights || !win.Highlight) return;
  const base: Range[] = [];
  const active: Range[] = [];
  for (const a of anchors) {
    if (!a.range) continue;
    (a.id === activeId ? active : base).push(a.range);
  }
  if (base.length) cssHighlights.set(HL_NAME, new win.Highlight(...base));
  else cssHighlights.delete(HL_NAME);
  if (active.length) cssHighlights.set(HL_ACTIVE, new win.Highlight(...active));
  else cssHighlights.delete(HL_ACTIVE);
}

// Matches on whitespace-collapsed text so markdown reflow (line wraps, indent)
// doesn't defeat the lookup.
function findQuoteRange(root: HTMLElement, quote: string): Range | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chars: { node: Text; offset: number }[] = [];
  let full = "";
  let node = walker.nextNode() as Text | null;
  while (node) {
    const data = node.data;
    for (let i = 0; i < data.length; i++) {
      chars.push({ node, offset: i });
      full += data[i];
    }
    node = walker.nextNode() as Text | null;
  }

  const { norm, back } = collapse(full);
  const needle = quote.replace(/\s+/g, " ").trim();
  if (!needle) return null;

  const at = norm.indexOf(needle);
  if (at === -1) return null;

  const start = chars[back[at]!]!;
  const end = chars[back[at + needle.length - 1]!]!;
  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset + 1);
  return range;
}

function collapse(full: string): { norm: string; back: number[] } {
  let norm = "";
  const back: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < full.length; i++) {
    const ch = full[i]!;
    if (/\s/.test(ch)) {
      if (prevSpace) continue;
      norm += " ";
      back.push(i);
      prevSpace = true;
    } else {
      norm += ch;
      back.push(i);
      prevSpace = false;
    }
  }
  return { norm, back };
}

function samePlacement(a: Placement, b: Placement): boolean {
  if (a.layerHeight !== b.layerHeight) return false;
  if (a.order.length !== b.order.length) return false;
  for (let i = 0; i < a.order.length; i++) if (a.order[i] !== b.order[i]) return false;
  for (const id of a.order) if (a.tops[id] !== b.tops[id]) return false;
  return true;
}
