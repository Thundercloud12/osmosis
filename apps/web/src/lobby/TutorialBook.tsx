import { useCallback, useEffect, useRef, useState } from "react";
import HTMLFlipBook, { type BookSnapshot, type FlipBookHandle } from "@gullabs/react-flipbook";

interface TutorialBookProps {
  onClose: () => void;
}

const pages = [
  {
    chapter: "GET YOUR BEARINGS",
    title: "Find your way around.",
    description: "Move through the connected rooms and cargo lanes. You can only see the part of the arena around your crewmate, so stick with your team and keep exploring.",
    image: "/assets/tutorial/explore.png",
    alt: "A crewmate standing in a cargo room in the live Osmosis arena.",
    controls: [["W", "UP"], ["A", "LEFT"], ["S", "DOWN"], ["D", "RIGHT"], ["G", "ASK FOR HELP"]],
    note: "Press G for help; teammates see a marker above you and on their crew radar.",
  },
  {
    chapter: "PICK UP STARS",
    title: "Every star adds 200.",
    description: "Walk close to a star to collect it. Its points go to you and increase your crew's total. Each star is collected once and does not come back during the match.",
    image: "/assets/tutorial/stars.png",
    alt: "A crewmate approaching a glowing point star on the arena floor.",
    controls: [["+200", "POINTS EACH"]],
    note: "Only your crew sees your live score. The other crew's score stays hidden; the highest team total wins.",
  },
  {
    chapter: "LINK & TAG",
    title: "Back up your crewmates.",
    description: "Hold F near one active teammate to link up. You need to be within 120 units with a clear path between you. A link combines your points for a tag comparison, and can include two players total.",
    image: "/assets/tutorial/link-tag.png",
    alt: "Two crewmates meeting in the live arena before a team link or tag.",
    controls: [["HOLD F", "LINK"]],
    note: "Tag an active opponent. The higher-scoring side gains up to 500 total; the other side loses the same. Both sides can still move while inactive, but cannot tag, collect, link or raid until re-armed after 15 seconds or by entering their own base.",
  },
  {
    chapter: "RAID AN HQ",
    title: "Hold your nerve.",
    description: "Reach the opposing HQ and interact with E for three uninterrupted seconds. A completed raid adds 2,000 points to your own balance. Your crew can raid again after its 90-second cooldown.",
    image: "/assets/tutorial/raid.png",
    alt: "A crewmate charging a raid at the enemy HQ in the live arena.",
    controls: [["E", "INTERACT"]],
    note: "A battle interrupts the raid. The HQ itself does not prevent ordinary tags.",
  },
  {
    chapter: "HOLD YOUR POLE",
    title: "Protect your home base.",
    description: "One active crewmate can stand on your HQ pole at a time; teammates wait outside while it is occupied. If an opponent touches that pole-holder, the opponent is eliminated for the rest of the match and loses their remaining points. The holder stays in the game.",
    image: "/assets/tutorial/pole.png",
    alt: "The home pole and two crewmates in a live arena scene.",
    controls: [["ONE", "POLE HOLDER"]],
    note: "A player who reaches zero points is also eliminated. Eliminated crewmates spectate until the match ends.",
  },
] as const;

const initialPosition: BookSnapshot = {
  page: 0,
  pageCount: pages.length * 2,
  orientation: "landscape",
  visiblePages: [0, 1],
};

// Keep the leaf elements stable across progress and page-counter updates. The
// flipbook adopts these nodes and animates their actual clipped page surfaces.
const flipbookPages = pages.flatMap((page, index) => [
  <div className="tutorial-flip-leaf" key={`${page.chapter}-art`}>
    <figure className={`tutorial-illustration-page tutorial-chapter-art-${index}`}>
      <div className={`tutorial-image-frame tutorial-image-frame-${index}`}><img src={page.image} alt={page.alt} /></div>
      <figcaption><span>FIELD PHOTO</span><strong>{page.chapter}</strong></figcaption>
      <span className="tutorial-page-number">{String(index * 2 + 1).padStart(2, "0")}</span>
    </figure>
  </div>,
  <div className="tutorial-flip-leaf" key={`${page.chapter}-copy`}>
    <article className="tutorial-copy-page">
      <p className="tutorial-chapter"><span>{String(index + 1).padStart(2, "0")}</span>{page.chapter}</p>
      <h2>{page.title}</h2>
      <p className="tutorial-description">{page.description}</p>
      <div className="tutorial-controls" aria-label="Controls and key facts">
        {page.controls.map(([key, label]) => <div className="tutorial-control" key={key}><kbd>{key}</kbd><span>{label}</span></div>)}
      </div>
      <aside className="tutorial-field-note"><span className="field-note-star">✦</span><p>{page.note}</p></aside>
      <span className="tutorial-page-number">{String(index * 2 + 2).padStart(2, "0")}</span>
    </article>
  </div>,
]);

export function TutorialBook({ onClose }: TutorialBookProps) {
  const bookRef = useRef<FlipBookHandle>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const bookDialogRef = useRef<HTMLElement>(null);
  const [position, setPosition] = useState(initialPosition);
  const [isTurning, setIsTurning] = useState(false);
  const pageIndex = Math.min(Math.floor(position.page / 2), pages.length - 1);
  const firstVisiblePage = position.visiblePages[0] ?? position.page;
  const lastVisiblePage = position.visiblePages.at(-1) ?? position.page;
  const canGoPrevious = firstVisiblePage > 0;
  const canGoNext = position.pageCount > 0 && lastVisiblePage < position.pageCount - 1;

  const syncPosition = useCallback((snapshot: BookSnapshot) => setPosition(snapshot), []);
  const handleOrientation = useCallback(({ orientation }: { orientation: BookSnapshot["orientation"] }) => {
    const engine = bookRef.current?.pageFlip();
    if (!engine || engine.isDestroyed()) {
      setPosition((previous) => ({ ...previous, orientation }));
      return;
    }
    setPosition({
      page: engine.getCurrentPageIndex(),
      pageCount: engine.getPageCount(),
      orientation,
      visiblePages: engine.getVisiblePages(),
    });
  }, []);

  const flipToChapter = useCallback((index: number) => {
    bookRef.current?.flipToPage(index * 2);
  }, []);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") {
        event.preventDefault();
        bookRef.current?.flipNext();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        bookRef.current?.flipPrev();
      }
      if (event.key === "Tab") {
        const focusable = [...(bookDialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])];
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        const focusOutsideBook = !bookDialogRef.current?.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || focusOutsideBook)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || focusOutsideBook)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return <div className="tutorial-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={bookDialogRef} className="tutorial-book" role="dialog" aria-modal="true" aria-labelledby="tutorial-dialog-title">
      <header className="tutorial-book-header">
        <div className="tutorial-book-brand"><span className="brand-planet">✦</span><span id="tutorial-dialog-title">OSMOSIS FIELD GUIDE</span><small>CREW EDITION</small></div>
        <div className="tutorial-page-count">SECTION {String(pageIndex + 1).padStart(2, "0")} <span>/ {String(pages.length).padStart(2, "0")}</span></div>
        <button ref={closeRef} className="tutorial-close" onClick={onClose} aria-label="Close the field guide">×</button>
      </header>

      <div className="tutorial-book-spread">
        <HTMLFlipBook
          ref={bookRef}
          className="tutorial-flipbook"
          style={{ width: "100%", height: "100%" }}
          width={470}
          height={570}
          sizing="responsive"
          minWidth={270}
          maxWidth={480}
          minHeight={430}
          maxHeight={590}
          usePortrait
          drawShadow
          maxShadowOpacity={0.42}
          flippingTime={850}
          foldCornerOnHover
          flipOnClick="corners"
          respectReducedMotion
          useKeyboard={false}
          controls="none"
          liveRegion
          aria-label="Osmosis tutorial pages"
          onLoaded={syncPosition}
          onPageChange={syncPosition}
          onChangeOrientation={handleOrientation}
          onChangeState={({ state }) => setIsTurning(state === "flipping" || state === "user_fold")}
        >
          {flipbookPages}
        </HTMLFlipBook>
      </div>

      <footer className="tutorial-book-footer">
        <div className="tutorial-chapter-dots" aria-label="Choose a field guide chapter">
          {pages.map((item, index) => <button className={index === pageIndex ? "selected" : ""} key={item.chapter} disabled={index === pageIndex || isTurning} onClick={() => flipToChapter(index)} aria-label={`Section ${index + 1}: ${item.chapter}`} aria-current={index === pageIndex ? "page" : undefined} />)}
        </div>
        <span className="tutorial-key-hint">DRAG A CORNER OR USE ← →</span>
        <div className="tutorial-page-nav">
          <button className="tutorial-prev" disabled={!canGoPrevious || isTurning} onClick={() => bookRef.current?.flipPrev()}>← PREVIOUS</button>
          {canGoNext
            ? <button className="tutorial-next" disabled={isTurning} onClick={() => bookRef.current?.flipNext()}>NEXT PAGE <span>→</span></button>
            : <button className="tutorial-next" onClick={onClose}>LET'S PLAY <span>→</span></button>}
        </div>
      </footer>
    </section>
  </div>;
}
