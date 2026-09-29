/* The widget's React components. Display only: graph access goes through
 * load.ts (reads) and roam.ts (writes).
 *
 * These are real components with state, mounted in their own React root
 * (see mount.ts). The roam/render version could not re-render itself, so it
 * painted checkbox changes straight into the DOM; here a toggle is ordinary
 * state, and every widget on the page hears about it. */
import React from "react";
import type { WidgetArgs } from "~/args";
import { logError, MAX_REF_HOPS } from "~/config";
import { loadWidget, readRefTexts, type Loaded } from "~/load";
import type { Row } from "~/model";
import { graphName, openInSidebar, writeString } from "~/roam";
import { displayText, isDone, withDone } from "~/text";

/* ── cross-widget sync ─────────────────────────────────────────────────── */

// A task often shows in two widgets at once (the page-level one and a
// meeting's "last meeting" slot). A toggle in one is announced to all.
const WRITTEN = "roam-meeting-tasks:written";
type Written = { uid: string; string: string };

const announce = (detail: Written): void => {
  window.dispatchEvent(new CustomEvent<Written>(WRITTEN, { detail }));
};

const useWrittenStrings = (): [Record<string, string>, (w: Written) => void] => {
  const [strings, setStrings] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    const onWritten = (e: Event) => {
      const { uid, string } = (e as CustomEvent<Written>).detail;
      setStrings((prev) => ({ ...prev, [uid]: string }));
    };
    window.addEventListener(WRITTEN, onWritten);
    return () => window.removeEventListener(WRITTEN, onWritten);
  }, []);
  return [strings, announce];
};

/* ── rows ──────────────────────────────────────────────────────────────── */

const dateLabel = (time: number): string =>
  new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const TaskRow = ({
  row,
  string,
  text,
  onToggle,
}: {
  row: Row;
  string: string;
  text: string;
  onToggle: (row: Row, done: boolean) => void;
}) => {
  const done = isDone(string);
  const uid = row.task.uid;
  return (
    <div className="rmt-row" data-done={done ? "true" : "false"}>
      <input
        type="checkbox"
        className="rmt-check"
        checked={done}
        onChange={(e) => onToggle(row, e.target.checked)}
      />
      {row.meeting ? (
        <span className="rmt-date">{dateLabel(row.meeting.time)}</span>
      ) : (
        <span className="rmt-date" data-inbox="true">
          inbox
        </span>
      )}
      <a
        className="rmt-text"
        href={`#/app/${graphName()}/page/${uid}`}
        title="click to open · shift-click to open in the right sidebar"
        onClick={(e) => {
          // Shift-click means "right sidebar" everywhere else in Roam. On a
          // plain link the browser would open a new window instead, so the
          // default is cancelled first. A plain click keeps the link.
          if (!e.shiftKey) return;
          e.preventDefault();
          e.stopPropagation();
          openInSidebar(uid).catch((error) => logError("could not open the sidebar", error));
        }}
      >
        {text}
      </a>
    </div>
  );
};

type RowsProps = {
  rows: Row[];
  texts: Map<string, string>;
  strings: Record<string, string>;
  onToggle: (row: Row, done: boolean) => void;
};

const Rows = ({ rows, texts, strings, onToggle }: RowsProps) => (
  <>
    {rows.map((row) => {
      const string = strings[row.task.uid] ?? row.task.string;
      return (
        <TaskRow
          key={row.task.uid}
          row={row}
          string={string}
          text={displayText(string, (u) => texts.get(u), MAX_REF_HOPS)}
          onToggle={onToggle}
        />
      );
    })}
  </>
);

/* The collapsed section. Its rows, and the refs inside them, are only read
 * and rendered once someone opens it. */
const LazyRows = (props: Omit<RowsProps, "texts">) => {
  const [texts, setTexts] = React.useState<Map<string, string> | null>(null);
  React.useEffect(() => {
    let live = true;
    readRefTexts(props.rows.map((r) => r.task.string))
      .then((t) => live && setTexts(t))
      .catch((error) => {
        logError("could not read block references", error);
        if (live) setTexts(new Map());
      });
    return () => {
      live = false;
    };
  }, [props.rows]);
  if (!texts) return <div className="rmt-muted">…</div>;
  return <Rows {...props} texts={texts} />;
};

/* ── the widget ────────────────────────────────────────────────────────── */

type State = { status: "loading" } | { status: "done"; loaded: Loaded } | { status: "failed" };

export const MeetingTasks = ({ args }: { args: WidgetArgs }) => {
  const [state, setState] = React.useState<State>({ status: "loading" });
  const [open, setOpen] = React.useState(false);
  const [strings, announceWrite] = useWrittenStrings();

  const argsKey = JSON.stringify(args);
  React.useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    loadWidget(args)
      .then((loaded) => live && setState({ status: "done", loaded }))
      .catch((error) => {
        logError("could not load", error);
        if (live) setState({ status: "failed" });
      });
    return () => {
      live = false;
    };
    // argsKey stands in for args, which is a fresh object on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [argsKey]);

  const onToggle = React.useCallback(
    (row: Row, done: boolean) => {
      const uid = row.task.uid;
      const before = strings[uid] ?? row.task.string;
      const next = withDone(before, done);
      if (next === before) return;
      announceWrite({ uid, string: next });
      writeString(uid, next).catch((error) => {
        logError("could not save the checkbox", error);
        announceWrite({ uid, string: before });
      });
    },
    [strings, announceWrite],
  );

  if (state.status === "loading") return <div className="rmt-muted">Loading tasks…</div>;
  if (state.status === "failed")
    return args.debug ? <div className="rmt-debug">meeting-tasks: failed to load (see console)</div> : null;
  const { loaded } = state;
  if (loaded.kind === "empty")
    return args.debug ? (
      <div className="rmt-debug">
        meeting-tasks: {loaded.reason} load={loaded.ms}ms
      </div>
    ) : null;

  const { view, texts } = loaded;
  const current = (r: Row) => strings[r.task.uid] ?? r.task.string;
  const openCount = view.primary.concat(view.secondary).filter((r) => !isDone(current(r))).length;

  return (
    <div className="rmt">
      <div className="rmt-count">
        {openCount} {openCount === 1 ? "open item" : "open items"}
      </div>
      {view.primary.length > 0 && (
        <>
          <div className="rmt-heading">{view.primaryLabel}</div>
          <div data-section="primary">
            <Rows rows={view.primary} texts={texts} strings={strings} onToggle={onToggle} />
          </div>
        </>
      )}
      {view.secondary.length > 0 && (
        <>
          {/* Collapsed by default: on a long-lived page this section is dozens
              of items, which would bury the carried-over next actions. */}
          <div className="rmt-heading rmt-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? "▾" : "▸"} {view.secondary.length} {view.secondaryLabel}
          </div>
          {open && (
            <div data-section="secondary">
              <LazyRows rows={view.secondary} strings={strings} onToggle={onToggle} />
            </div>
          )}
        </>
      )}
      {view.olderCount > 0 && (
        <div className="rmt-footer">
          window {view.lookbackDays}d · {view.olderCount}{" "}
          {view.olderCount === 1 ? "older meeting" : "older meetings"} not shown
        </div>
      )}
      {args.debug && (
        <div className="rmt-debug">
          {view.debug} load={loaded.ms}ms
        </div>
      )}
    </div>
  );
};
